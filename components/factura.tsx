"use client";

import { useMemo, useState } from "react";
import { Download, FileCheck, Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Stop } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  IRPF,
  IVA,
  calcularTotales,
  euros,
  parseImporte,
  fechaCorta,
  formatearNumero,
  paginar,
  clientePara,
  type ClienteFacturacion,
  type DatosFacturacion,
  type LineaFactura,
} from "@/lib/factura";
import type { FacturaEmitida } from "@/lib/types";
import {
  A4_ALTO,
  A4_ANCHO,
  FILETE,
  componerHoja,
  type HojaOpciones,
} from "@/lib/factura-hoja";
import { descargarPdf } from "@/lib/pdf";

/**
 * Factura del mes en el formato de FactuSOL.
 *
 * Dos partes: la pantalla de repaso, que es la que se usa en el móvil, y la
 * hoja A4, que vive fuera de la pantalla y solo aparece al imprimir (ver
 * `.factura-full` en globals.css).
 *
 * Las medidas de la hoja están en puntos y salen de medir la factura
 * 1-000029 con `pdftotext -bbox`: posiciones de cada caja y de cada texto,
 * los dos moradas (#800080 y #6767B4) y los grises de los recuadros. Por eso
 * son números "raros" y no múltiplos de 4: son los del documento original.
 */

/* ── La hoja A4 ─────────────────────────────────────────────────────────── */

/**
 * Pinta en la pantalla la maqueta que describe `lib/factura-hoja.ts`.
 *
 * Es un dibujante tonto a propósito: no sabe dónde va nada, solo traduce
 * cajas y textos a `<div>` colocados en absoluto. El otro dibujante de la
 * misma maqueta es `lib/pdf.ts`. Si hay que mover algo de sitio, se mueve
 * allí y los dos cambian a la vez.
 *
 * En pantalla vive fuera del viewport y solo se ve al imprimir (ver
 * `.factura-full` en globals.css).
 */
export function Hoja(opciones: HojaOpciones) {
  return (
    <div
      className="factura-hoja"
      style={{
        position: "relative",
        width: `${A4_ANCHO}pt`,
        height: `${A4_ALTO}pt`,
        overflow: "hidden",
        background: "#fff",
        color: "#000",
        // Calibri es la de FactuSOL. Donde no esté (el móvil), cae en la del
        // sistema: cambia la letra, no la maqueta.
        fontFamily: "Calibri, Carlito, system-ui, sans-serif",
      }}
    >
      {componerHoja(opciones).map((el, i) =>
        el.tipo === "caja" ? (
          <div
            key={i}
            style={{
              position: "absolute",
              boxSizing: "border-box",
              top: `${el.top}pt`,
              left: `${el.left}pt`,
              width: `${el.ancho}pt`,
              height: `${el.alto}pt`,
              background: el.fondo,
              border: el.borde ? `${FILETE}pt solid ${el.borde}` : undefined,
            }}
          />
        ) : (
          <div
            key={i}
            style={{
              position: "absolute",
              // El desfase vertical está calibrado contra el PDF original:
              // sitúa la línea base donde la pone FactuSOL.
              top: `${el.top + 0.1112 * el.cuerpo}pt`,
              left: `${el.left}pt`,
              fontSize: `${el.cuerpo}pt`,
              lineHeight: 1,
              whiteSpace: "pre",
              fontWeight: el.negrita ? 700 : 400,
              color: el.color,
              width: el.ancho ? `${el.ancho}pt` : undefined,
              textAlign: el.alinear,
            }}
          >
            {el.valor}
          </div>
        ),
      )}
    </div>
  );
}

/* ── La pantalla de repaso ──────────────────────────────────────────────── */



export default function Factura({
  entregats,
  mes,
  datos,
  online,
  onImporte,
  onEmesa,
  onTancar,
}: {
  /** Pedidos entregados del mes, tal cual salen de la hoja. */
  entregats: Stop[];
  /** Nombre de la pestaña del Sheet, que es el mes de trabajo. */
  mes: string;
  datos: DatosFacturacion;
  online: boolean;
  /** Guarda el importe de un pedido. Reescribe la misma celda del Sheet. */
  onImporte: (orderId: string, importe: number | null) => void;
  /** Avisa de que ya hay una factura nueva, para refrescar el listado. */
  onEmesa?: () => void;
  onTancar: () => void;
}) {
  /**
   * Lo que hay escrito en cada campo de importe, por comanda.
   *
   * Se guarda el texto y no el número: mientras escribes "12," eso no es un
   * número todavía, y convertirlo a cada tecla te borra la coma según la
   * pones. El número solo aparece al confirmar el campo.
   */
  const [esborranys, setEsborranys] = useState<Record<string, string>>({});
  const [emitida, setEmitida] = useState<FacturaEmitida | null>(null);
  const [emitiendo, setEmitiendo] = useState(false);
  const [errorEmision, setErrorEmision] = useState<string | null>(null);
  /**
   * Qué comandas se dejan FUERA de la factura.
   *
   * Se guarda lo excluido y no lo incluido a propósito: los pedidos llegan
   * de IndexedDB y pueden aparecer más mientras la pantalla está abierta.
   * Guardando lo excluido, lo que llega nuevo entra solo; guardando lo
   * incluido, se quedaría fuera sin que nadie lo hubiera decidido.
   */
  const [exclosos, setExclosos] = useState<Set<string>>(() => new Set());
  /** Índice del cliente al que se le factura. El primero es el de por defecto. */
  const [iClient, setIClient] = useState(0);

  const client: ClienteFacturacion = datos.clientes[iClient] ?? datos.clientes[0];

  /**
   * Las comandas que le tocan a este cliente.
   *
   * Una comanda sin cliente asignado sale siempre: hoy la columna "Client
   * facturació" del full está vacía en todas, así que con un solo cliente
   * esto no filtra nada y la pantalla se comporta igual que antes. En cuanto
   * alguien empieza a rellenarla, las de OTRO cliente desaparecen de aquí.
   */
  const delClient = useMemo(
    () =>
      entregats.filter(
        (s) =>
          !s.billingClient ||
          clientePara(datos, s.billingClient).codigo === client.codigo,
      ),
    [entregats, datos, client.codigo],
  );

  const conImporte = useMemo(
    () => delClient.filter((s) => s.price !== null && s.price > 0),
    [delClient],
  );
  const sinImporte = useMemo(
    () => delClient.filter((s) => s.price === null || s.price === 0),
    [delClient],
  );
  const seleccionades = useMemo(
    () => conImporte.filter((s) => !exclosos.has(s.id)),
    [conImporte, exclosos],
  );

  const lineas: LineaFactura[] = useMemo(
    () => seleccionades.map((s) => ({ comanda: s.id, importe: s.price as number })),
    [seleccionades],
  );
  const totales = useMemo(() => calcularTotales(lineas), [lineas]);
  const paginas = useMemo(() => paginar(lineas), [lineas]);
  const hoy = new Date().toISOString().slice(0, 10);

  /** Las hojas ya compuestas, listas para el dibujante que sea. */
  const hojasPdf = (numero: string) =>
    paginas.map((lineasPagina, i) =>
      componerHoja({
        datos,
        cliente: client,
        numero,
        lineas: lineasPagina,
        pagina: i + 1,
        paginas: paginas.length,
        fecha: fechaCorta(hoy),
        totales: i === paginas.length - 1 ? totales : null,
      }),
    );

  const alternar = (id: string) => {
    setExclosos((previo) => {
      const seguent = new Set(previo);
      if (seguent.has(id)) seguent.delete(id);
      else seguent.add(id);
      return seguent;
    });
  };

  /**
   * Emite la factura: el servidor le pone número y la registra en el Sheet.
   *
   * Necesita cobertura, y es la única pantalla de la app que lo necesita. Es
   * el precio de que la serie no tenga saltos ni repetidos: el número no se
   * puede repartir desde el móvil.
   */
  const emitir = async () => {
    setEmitiendo(true);
    setErrorEmision(null);
    try {
      const respuesta = await fetch("/api/facturas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha: hoy,
          periodo: mes,
          client: client.codigo,
          lineas,
          base: totales.base,
          iva: totales.iva,
          irpf: totales.irpf,
          total: totales.total,
          primerNumero: datos.primerNumero,
        }),
      });
      const cuerpo = await respuesta.json().catch(() => null);
      if (!respuesta.ok) {
        throw new Error(cuerpo?.error ?? "No s'ha pogut emetre la factura");
      }
      setEmitida(cuerpo.factura as FacturaEmitida);
      onEmesa?.();
    } catch (error) {
      setErrorEmision(error instanceof Error ? error.message : "Error desconegut");
    } finally {
      setEmitiendo(false);
    }
  };

  /** Confirma el importe de una comanda. No hace nada si no ha cambiado. */
  const desar = (stop: Stop) => {
    const cru = esborranys[stop.id];
    if (cru === undefined) return; // no se ha tocado
    const valor = parseImporte(cru);

    // Un valor imposible se queda en el campo, marcado en rojo, en vez de
    // desaparecer: quien lo ha escrito tiene que poder verlo y corregirlo.
    if (valor === undefined) return;

    // Vaciar el campo NO borra el importe de la hoja. En toda la cadena
    // —cola local, `applyOutbox`, escritura en el Sheet— un importe nulo
    // significa "no lo toques", que es lo que permite marcar una entrega sin
    // precio sin pisar el que ya hubiera. Así que el campo vuelve a lo que
    // hay guardado en vez de quedarse en blanco fingiendo que se ha borrado.
    // Para corregir un importe se escribe el bueno encima.
    if (valor === null) {
      setEsborranys((previo) => ({
        ...previo,
        [stop.id]: stop.price !== null && stop.price > 0 ? euros(stop.price) : "",
      }));
      return;
    }

    // Se deja escrito el importe ya formateado en vez de borrar el borrador:
    // el campo enseña "12,50" en el acto, sin el parpadeo al valor anterior
    // que habría mientras la escritura llega a la base local.
    setEsborranys((previo) => ({ ...previo, [stop.id]: euros(valor) }));
    if (valor !== stop.price) onImporte(stop.id, valor);
  };

  /**
   * Salta al siguiente campo de importe.
   *
   * Se busca en el DOM en vez de guardar una lista de refs: los campos ya
   * están en el orden en que se ven, que es justo el orden en que se quiere
   * ir. El Tab del navegador ya hace esto solo; esto es para el Intro, que
   * en un teclado numérico cae más a mano.
   */
  const seguentImport = (actual: HTMLInputElement) => {
    const camps = [...document.querySelectorAll<HTMLInputElement>("input[data-import]")];
    const seguent = camps[camps.indexOf(actual) + 1];
    seguent?.focus();
  };

  /** Lleva el foco al primer importe que falte. */
  const anarAlPrimerBuit = () => {
    const camps = [...document.querySelectorAll<HTMLInputElement>("input[data-import]")];
    (camps.find((c) => c.value.trim() === "") ?? camps[0])?.focus();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background lg:left-64">
      <div className="mx-auto max-w-lg space-y-6 px-4 pb-28 pt-6 lg:max-w-4xl lg:px-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight">Factura</h2>
            <p className="text-sm text-muted-foreground">
              {mes} · {seleccionades.length} de {conImporte.length}{" "}
              {conImporte.length === 1 ? "comanda" : "comandes"} amb import
            </p>
          </div>
          <Button variant="ghost" size="touch" onClick={onTancar} aria-label="Tancar">
            <X />
          </Button>
        </div>

        {/* Con un solo cliente esto sobra y no sale: es el caso de siempre. */}
        {datos.clientes.length > 1 ? (
          <label className="soft-card block p-4">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              A qui es factura
            </span>
            <select
              value={iClient}
              onChange={(e) => {
                setIClient(Number(e.target.value));
                // Lo desmarcado era de otro cliente: no tiene sentido
                // arrastrarlo a una factura distinta.
                setExclosos(new Set());
              }}
              className="w-full rounded-lg bg-muted px-3 py-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {datos.clientes.map((c, i) => (
                <option key={i} value={i}>
                  {c.nombre.trim() || `Client ${i + 1}`}
                  {c.codigo.trim() && ` · ${c.codigo}`}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="px-1 text-sm text-muted-foreground">
            A: <strong className="text-foreground">{client.nombre}</strong>
          </p>
        )}

        {/*
          Una sola lista con TODAS las entregas del mes, cada una con su
          casilla y su importe editable ahí mismo.

          Antes había dos listas —las que tenían importe y las que no— y una
          comanda saltaba de una a otra en cuanto le ponías precio: la fila
          desaparecía de debajo del cursor y el siguiente Tab caía en
          cualquier sitio. Con una sola lista el orden no se mueve, así que
          se pueden rellenar veinte importes seguidos a base de teclear y
          tabular sin levantar la vista.
        */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 px-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Comandes a facturar
            </h3>
            {conImporte.length > 0 && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={exclosos.size === 0}
                  onClick={() => setExclosos(new Set())}
                >
                  Totes
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={seleccionades.length === 0}
                  onClick={() => setExclosos(new Set(conImporte.map((s) => s.id)))}
                >
                  Cap
                </Button>
              </div>
            )}
          </div>

          {sinImporte.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-warning-surface px-4 py-2.5">
              <p className="text-sm text-warning-foreground">
                <strong className="font-semibold">
                  {sinImporte.length}{" "}
                  {sinImporte.length === 1 ? "entrega sense import" : "entregues sense import"}
                </strong>
                : no entren a la factura fins que no els posis preu.
              </p>
              <Button variant="secondary" size="sm" onClick={anarAlPrimerBuit}>
                Omplir imports
              </Button>
            </div>
          )}

          <div className="soft-card divide-y divide-border">
            {delClient.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Cap entrega aquest mes.
              </p>
            ) : (
              delClient.map((stop) => {
                const teImport = stop.price !== null && stop.price > 0;
                const dins = teImport && !exclosos.has(stop.id);
                const valor = esborranys[stop.id] ?? (teImport ? euros(stop.price as number) : "");
                const malament = valor.trim() !== "" && parseImporte(valor) === undefined;

                return (
                  // El <label> envuelve solo la casilla y el texto: si
                  // envolviera también el importe, escribir en él
                  // desmarcaría la comanda de propina.
                  <div
                    key={stop.id}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2",
                      teImport && !dins && "opacity-50",
                    )}
                  >
                    <label
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-3",
                        teImport ? "cursor-pointer" : "cursor-not-allowed",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={dins}
                        disabled={!teImport}
                        onChange={() => alternar(stop.id)}
                        className="size-[18px] shrink-0 accent-[var(--primary)]"
                        aria-label={`Incloure la comanda ${stop.id} a la factura`}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        <span className="tabular-nums">{stop.id}</span>
                        {stop.customer && (
                          <span className="text-muted-foreground"> · {stop.customer}</span>
                        )}
                      </span>
                    </label>
                    <div className="flex shrink-0 items-center gap-1">
                      <input
                        data-import
                        value={valor}
                        onChange={(e) =>
                          setEsborranys((previo) => ({ ...previo, [stop.id]: e.target.value }))
                        }
                        onBlur={() => desar(stop)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          desar(stop);
                          seguentImport(e.currentTarget);
                        }}
                        onFocus={(e) => e.currentTarget.select()}
                        type="text"
                        inputMode="decimal"
                        placeholder="0,00"
                        aria-label={`Import de la comanda ${stop.id}`}
                        aria-invalid={malament || undefined}
                        className={cn(
                          "w-24 rounded-lg px-2 py-1.5 text-right text-base tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                          malament
                            ? "bg-[color-mix(in_srgb,var(--destructive)_14%,transparent)] text-destructive"
                            : teImport
                              ? "bg-muted"
                              : "bg-warning-surface",
                        )}
                      />
                      <span className="w-3 text-sm text-muted-foreground">€</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="soft-card space-y-2 p-4 text-sm lg:ml-auto lg:max-w-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Base imposable</span>
            <span className="tabular-nums font-medium">{euros(totales.base)} €</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">I.V.A. {IVA}%</span>
            <span className="tabular-nums font-medium">{euros(totales.iva)} €</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">I.R.P.F. {IRPF}%</span>
            <span className="tabular-nums font-medium">−{euros(totales.irpf)} €</span>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{euros(totales.total)} €</span>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {emitida
            ? `Emesa amb el número ${formatearNumero(emitida.numero)}. Queda registrada a la pestanya "Factures" del full.`
            : "En emetre-la se li assigna el número següent de la sèrie i queda registrada al full. Això no es pot desfer."}
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-0 lg:left-64 space-y-2 border-t border-border bg-background/95 p-4 backdrop-blur">
        <div className="mx-auto max-w-lg space-y-2 lg:max-w-4xl">
          {errorEmision && (
            <p className="text-center text-sm text-status-incidencia">{errorEmision}</p>
          )}
          {!online && !emitida && (
            <p className="text-center text-xs text-muted-foreground">
              Necessites cobertura per emetre-la: el número el reparteix el servidor.
            </p>
          )}
          {emitida ? (
            <div className="flex gap-2">
              <Button size="touch" className="flex-1" onClick={() => window.print()}>
                <Printer strokeWidth={2.2} />
                Imprimir la {formatearNumero(emitida.numero)}
              </Button>
              <Button
                size="touch"
                variant="secondary"
                onClick={() =>
                  descargarPdf(
                    hojasPdf(formatearNumero(emitida.numero)),
                    `factura-${formatearNumero(emitida.numero)}`,
                  )
                }
              >
                <Download strokeWidth={2.2} />
                PDF
              </Button>
            </div>
          ) : (
            <Button
              size="touch"
              className="w-full"
              disabled={lineas.length === 0 || !online || emitiendo}
              onClick={() => void emitir()}
            >
              <FileCheck strokeWidth={2.2} />
              {emitiendo
                ? "Emetent…"
                : `Emetre factura · ${lineas.length} ${lineas.length === 1 ? "comanda" : "comandes"} · ${euros(totales.total)} €`}
            </Button>
          )}
        </div>
      </div>

      {/* Fuera de la pantalla; solo se ve al imprimir. */}
      <div className="factura-full" aria-hidden>
        {paginas.map((lineasPagina, i) => (
          <Hoja
            key={i}
            datos={datos}
            cliente={client}
            numero={emitida ? formatearNumero(emitida.numero) : ""}
            lineas={lineasPagina}
            pagina={i + 1}
            paginas={paginas.length}
            fecha={fechaCorta(hoy)}
            totales={i === paginas.length - 1 ? totales : null}
          />
        ))}
      </div>
    </div>
  );
}
