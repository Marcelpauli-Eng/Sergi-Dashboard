"use client";

import { useEffect, useState } from "react";
import { Download, FileCheck, Printer, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import Factura, { Hoja } from "@/components/factura";
import type { FacturaEmitida, Stop } from "@/lib/types";
import {
  clientePara,
  euros,
  fechaCorta,
  formatearNumero,
  paginar,
  type DatosFacturacion,
} from "@/lib/factura";
import { componerHoja } from "@/lib/factura-hoja";
import { descargarPdf } from "@/lib/pdf";

/** Las hojas de una factura ya emitida, compuestas para imprimir o exportar. */
function hojasDe(factura: FacturaEmitida, datos: DatosFacturacion) {
  const paginas = paginar(factura.lineas);
  return paginas.map((lineasPagina, i) =>
    componerHoja({
      datos,
      cliente: clientePara(datos, factura.client),
      numero: formatearNumero(factura.numero),
      lineas: lineasPagina,
      pagina: i + 1,
      paginas: paginas.length,
      fecha: fechaCorta(factura.fecha),
      totales:
        i === paginas.length - 1
          ? {
              base: factura.base,
              iva: factura.iva,
              irpf: factura.irpf,
              total: factura.total,
            }
          : null,
    }),
  );
}

/**
 * ¿Es la última de la serie?
 *
 * Cambia lo que pasa al borrarla: si lo es, su número vuelve a quedar libre
 * —`emitirFactura` coge el mayor más uno— y no se nota nada. Si no lo es,
 * queda un hueco para siempre, y eso hay que decirlo antes.
 */
function esUltimaEmesa(
  factura: FacturaEmitida,
  totes: FacturaEmitida[] | null,
): boolean {
  return (totes ?? []).every((f) => f.numero <= factura.numero);
}

/**
 * Las facturas ya emitidas.
 *
 * Salen de la pestaña "Factures" del mismo Google Sheet, que es donde las
 * registra el servidor al emitirlas. Cada una guarda sus propias líneas, así
 * que reimprimir una de hace tres meses da exactamente el mismo papel aunque
 * la hoja de pedidos haya cambiado desde entonces.
 *
 * Los datos de emisor y cliente sí salen de los ajustes actuales: si cambia
 * el domicilio, las reimpresiones lo llevan. Para facturas ya entregadas a
 * Hacienda eso no debería pasar, pero cambiar de domicilio y reimprimir una
 * antigua es raro, y guardar una copia de los datos en cada fila del Sheet
 * costaba más de lo que resuelve.
 */
export default function Factures({
  entregats,
  mes,
  datos,
  online,
  onImporte,
}: {
  /** Entregados de la hoja que esté seleccionada ahora mismo. */
  entregats: Stop[];
  mes: string;
  datos: DatosFacturacion;
  online: boolean;
  onImporte: (orderId: string, importe: number | null) => void;
}) {
  const [facturas, setFacturas] = useState<FacturaEmitida[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aImprimir, setAImprimir] = useState<FacturaEmitida | null>(null);
  /** La factura que se está a punto de borrar, mientras se confirma. */
  const [aEsborrar, setAEsborrar] = useState<FacturaEmitida | null>(null);
  const [esborrant, setEsborrant] = useState(false);
  const [errorEsborrar, setErrorEsborrar] = useState<string | null>(null);
  const [facturant, setFacturant] = useState(false);
  // Cambia al emitir una factura: fuerza a releer el listado.
  const [recarrega, setRecarrega] = useState(0);

  const pendentsDeFacturar = entregats.filter((s) => s.price !== null && s.price > 0);
  // Lo que se va a facturar, en euros. El recuento de comandas no dice si
  // son cuatro portales o el mes entero, y es lo primero que se mira.
  const aFacturar = pendentsDeFacturar.reduce((total, s) => total + (s.price ?? 0), 0);

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      try {
        const respuesta = await fetch("/api/facturas");
        const cuerpo = await respuesta.json().catch(() => null);
        if (!respuesta.ok) throw new Error(cuerpo?.error ?? "No s'han pogut carregar");
        if (!cancelado) setFacturas(cuerpo.facturas as FacturaEmitida[]);
      } catch (e) {
        if (!cancelado) setError(e instanceof Error ? e.message : "Error desconegut");
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [recarrega]);

  const paginas = aImprimir ? paginar(aImprimir.lineas) : [];

  /**
   * Borra la factura que se estaba confirmando.
   *
   * La lista se arregla aquí en vez de volver a pedirla: la respuesta ya dice
   * que ha desaparecido de la hoja, y releer son otros dos segundos mirando
   * una factura que ya no existe.
   */
  const esborrar = async () => {
    if (!aEsborrar) return;
    setEsborrant(true);
    setErrorEsborrar(null);
    try {
      const respuesta = await fetch("/api/facturas", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero: aEsborrar.numero }),
      });
      if (!respuesta.ok) {
        const cuerpo = await respuesta.json().catch(() => null);
        throw new Error(cuerpo?.error ?? "No s'ha pogut esborrar");
      }
      setFacturas((previas) =>
        (previas ?? []).filter((f) => f.numero !== aEsborrar.numero),
      );
      // La que se estuviera imprimiendo, si era esta, deja de existir.
      setAImprimir((previa) =>
        previa?.numero === aEsborrar.numero ? null : previa,
      );
      setAEsborrar(null);
    } catch (e) {
      setErrorEsborrar(e instanceof Error ? e.message : "Error desconegut");
    } finally {
      setEsborrant(false);
    }
  };

  return (
    <div className="space-y-6 lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0">
      {/* Facturar el mes que esté seleccionado, no solo el de hoy: si cambias
          de hoja desde el menú, aquí se factura esa. */}
      <div className="soft-card space-y-3 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Per facturar
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight">
            {euros(aFacturar)}
            <span className="ml-1 align-middle text-base font-medium text-muted-foreground">
              €
            </span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {mes || "Cap full seleccionat"} ·{" "}
            {pendentsDeFacturar.length}{" "}
            {pendentsDeFacturar.length === 1
              ? "entrega amb import"
              : "entregues amb import"}
          </p>
          {entregats.length > pendentsDeFacturar.length && (
            <p className="mt-1.5 text-sm text-warning-foreground">
              {entregats.length - pendentsDeFacturar.length} sense import: no hi
              entraran.
            </p>
          )}
        </div>
        <Button
          size="touch"
          className="w-full"
          disabled={entregats.length === 0}
          onClick={() => setFacturant(true)}
        >
          <FileCheck strokeWidth={2.2} />
          Generar factura
        </Button>
      </div>

      {facturant && (
        <Factura
          entregats={entregats}
          mes={mes}
          datos={datos}
          online={online}
          onImporte={onImporte}
          onEmesa={() => setRecarrega((n) => n + 1)}
          onTancar={() => setFacturant(false)}
        />
      )}

      <div>
        <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Emeses
        </h3>
        <p className="mb-3 px-1 text-xs text-muted-foreground">
          Registrades en el teu document de factures, a part del full de
          repartiment que comparteix l&apos;empresa.
        </p>

        {error && <p className="text-sm text-status-incidencia">{error}</p>}

        {facturas === null && !error && (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregant…</p>
        )}

        {facturas?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Encara no has emès cap factura des de l&apos;app.
          </p>
        )}

        {facturas && facturas.length > 0 && (
          <ul className="soft-card divide-y divide-border">
            {/*
              En el móvil la factura es una ficha: arriba número e importe,
              debajo de cuándo y de qué, y al final los dos botones con su
              nombre. Todo en una fila dejaba el "3 comandes" cortado por la
              mitad y dos iconos sin etiqueta de 44x32 px. De `sm` en
              adelante vuelve a caber de lado.
            */}
            {facturas.map((factura) => (
              <li key={factura.numero} className="px-4 py-4 sm:flex sm:items-center sm:gap-3 sm:py-3">
                <div className="flex items-baseline justify-between gap-3 sm:flex-1 sm:items-center">
                  <div className="min-w-0">
                    <p className="text-base font-semibold tabular-nums sm:text-sm">
                      {formatearNumero(factura.numero)}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground sm:truncate">
                      {fechaCorta(factura.fecha)} · {factura.periodo} ·{" "}
                      {factura.lineas.length}{" "}
                      {factura.lineas.length === 1 ? "comanda" : "comandes"}
                    </p>
                  </div>
                  <span className="shrink-0 text-base font-semibold tabular-nums sm:text-sm sm:font-medium">
                    {euros(factura.total)} €
                  </span>
                </div>

                <div className="mt-3 flex gap-2 sm:mt-0 sm:shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-h-10 flex-1 sm:min-h-0 sm:flex-none"
                    aria-label={`Descarregar en PDF la factura ${formatearNumero(factura.numero)}`}
                    onClick={() =>
                      descargarPdf(
                        hojasDe(factura, datos),
                        `factura-${formatearNumero(factura.numero)}`,
                      )
                    }
                  >
                    <Download />
                    <span className="sm:hidden">PDF</span>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-h-10 flex-1 sm:min-h-0 sm:flex-none"
                    aria-label={`Imprimir la factura ${formatearNumero(factura.numero)}`}
                    onClick={() => {
                      setAImprimir(factura);
                      // Un respiro para que la hoja esté en el DOM antes de que
                      // el navegador congele la página con el diálogo de imprimir.
                      setTimeout(() => window.print(), 100);
                    }}
                  >
                    <Printer />
                    <span className="sm:hidden">Imprimir</span>
                  </Button>
                  {/* Sin etiqueta y sin crecer: es el que no se pulsa nunca
                      por error, y al lado de los otros dos se distingue por
                      el color, no por el tamaño. */}
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-h-10 shrink-0 text-destructive sm:min-h-0"
                    aria-label={`Esborrar la factura ${formatearNumero(factura.numero)}`}
                    onClick={() => {
                      setErrorEsborrar(null);
                      setAEsborrar(factura);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Confirmación de borrado ───────────────────────────────────
          Emitir es la única acción de la app que no se puede corregir
          escribiendo encima, así que borrar una factura tampoco se hace de
          un toque: hay que confirmarlo viendo de cuál se trata y qué pasa
          con su número. */}
      {aEsborrar && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="esborrar-titol"
          className="fixed inset-0 z-[110] flex animate-fade-in items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
        >
          <div className="soft-card w-full max-w-md">
            <div className="flex items-start gap-3 p-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                <Trash2 className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 id="esborrar-titol" className="text-lg font-semibold">
                  Esborrar la factura {formatearNumero(aEsborrar.numero)}?
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {fechaCorta(aEsborrar.fecha)} · {aEsborrar.periodo} ·{" "}
                  {aEsborrar.lineas.length}{" "}
                  {aEsborrar.lineas.length === 1 ? "comanda" : "comandes"} ·{" "}
                  <span className="font-semibold text-foreground">
                    {euros(aEsborrar.total)} €
                  </span>
                </p>
              </div>
            </div>

            <div className="space-y-2 border-t border-border px-5 py-4 text-sm">
              <p>
                Desapareix del teu document de factures i{" "}
                <span className="font-semibold">no es pot desfer</span>.
              </p>

              {esUltimaEmesa(aEsborrar, facturas) ? (
                <p className="text-muted-foreground">
                  És l&apos;última de la sèrie: el número{" "}
                  {formatearNumero(aEsborrar.numero)} tornarà a quedar lliure i
                  el farà servir la pròxima que emetis.
                </p>
              ) : (
                /* Un hueco en una serie de facturas no es un detalle: hay que
                   poder explicarlo. La app no lo impide —la decisión es de
                   quien factura— pero no deja que pase sin saberlo. */
                <p className="flex gap-2 rounded-xl bg-warning-surface px-3 py-2 text-warning-foreground">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    No és l&apos;última: la sèrie quedarà amb un buit al número{" "}
                    {formatearNumero(aEsborrar.numero)}. Les altres no es
                    renumeren.
                  </span>
                </p>
              )}

              {!online && (
                <p className="rounded-xl bg-warning-surface px-3 py-2 text-warning-foreground">
                  Sense cobertura no es pot esborrar: les factures viuen al
                  document de Google.
                </p>
              )}

              {errorEsborrar && (
                <p className="text-destructive">{errorEsborrar}</p>
              )}
            </div>

            <div className="flex gap-2 border-t border-border p-3">
              <Button
                variant="ghost"
                className="flex-1"
                disabled={esborrant}
                onClick={() => setAEsborrar(null)}
              >
                Cancel·lar
              </Button>
              <Button
                /* El rojo del sistema oscurecido: en blanco sobre el rojo tal
                   cual no hay contraste suficiente para leer un botón. */
                className="flex-1 bg-[color-mix(in_srgb,var(--destructive)_80%,black)] font-semibold text-white"
                disabled={esborrant || !online}
                onClick={() => void esborrar()}
              >
                <Trash2 />
                {esborrant ? "Esborrant…" : "Sí, esborrar"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Fuera de la pantalla; solo se ve al imprimir. */}
      {aImprimir && (
        <div className="factura-full" aria-hidden>
          {paginas.map((lineasPagina, i) => (
            <Hoja
              key={i}
              datos={datos}
              cliente={clientePara(datos, aImprimir.client)}
              numero={formatearNumero(aImprimir.numero)}
              lineas={lineasPagina}
              pagina={i + 1}
              paginas={paginas.length}
              fecha={fechaCorta(aImprimir.fecha)}
              totales={
                i === paginas.length - 1
                  ? {
                      base: aImprimir.base,
                      iva: aImprimir.iva,
                      irpf: aImprimir.irpf,
                      total: aImprimir.total,
                    }
                  : null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
