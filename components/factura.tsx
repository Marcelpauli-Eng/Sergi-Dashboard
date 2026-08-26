"use client";

import { useMemo, useState } from "react";
import { FileCheck, Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Stop } from "@/lib/types";
import {
  IRPF,
  IVA,
  calcularTotales,
  euros,
  fechaCorta,
  formatearNumero,
  paginar,
  type DatosFacturacion,
  type LineaFactura,
  type TotalesFactura,
} from "@/lib/factura";
import type { FacturaEmitida } from "@/lib/types";

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

const MORADO = "#800080";
const LILA = "#6767B4";
const GRIS = "#DFDFDF";
const FONDO = "#EFEFEF";
const BORDE = "#0F0F0F";
const GRIS_BORDE = "#8F8F8F";
const AZUL = "#E6F2FF";
const AZUL_BORDE = "#004080";

/** Cuerpo de la cabecera y del pie. */
const S = 9.75;
/** Cuerpo de las tablas. */
const s = 8.25;

function caja(
  clave: string,
  top: number,
  left: number,
  width: number,
  height: number,
  fondo?: string,
  borde?: string,
) {
  return (
    <div
      key={clave}
      style={{
        position: "absolute",
        boxSizing: "border-box",
        top: `${top}pt`,
        left: `${left}pt`,
        width: `${width}pt`,
        height: `${height}pt`,
        background: fondo,
        border: borde ? `0.36pt solid ${borde}` : undefined,
      }}
    />
  );
}

function texto(
  clave: string,
  top: number,
  left: number,
  cuerpo: number,
  valor: string | number | null | undefined,
  opciones: { negrita?: boolean; color?: string; ancho?: number; alinear?: "left" | "center" | "right" } = {},
) {
  if (valor === null || valor === undefined || valor === "") return null;
  const { negrita, color, ancho, alinear } = opciones;
  return (
    <div
      key={clave}
      style={{
        position: "absolute",
        // El desfase vertical está calibrado contra el PDF original: sitúa la
        // línea base donde la pone FactuSOL.
        top: `${top + 0.1112 * cuerpo}pt`,
        left: `${left}pt`,
        fontSize: `${cuerpo}pt`,
        lineHeight: 1,
        whiteSpace: "pre",
        fontWeight: negrita ? 700 : 400,
        color,
        width: ancho ? `${ancho}pt` : undefined,
        textAlign: alinear,
      }}
    >
      {valor}
    </div>
  );
}

/** Texto pegado a un borde derecho, como todos los importes de la factura. */
function derecha(
  clave: string,
  top: number,
  x: number,
  cuerpo: number,
  valor: string | null,
  opciones: { negrita?: boolean } = {},
) {
  return texto(clave, top, x - 260, cuerpo, valor, { ...opciones, ancho: 260, alinear: "right" });
}

function centrado(
  clave: string,
  top: number,
  left: number,
  ancho: number,
  cuerpo: number,
  valor: string,
  opciones: { negrita?: boolean; color?: string } = {},
) {
  return texto(clave, top, left, cuerpo, valor, { ...opciones, ancho, alinear: "center" });
}

const COLUMNAS: [number, number, string][] = [
  [14.2, 73.7, "ARTÍCULO"],
  [90.7, 153, "DESCRIPCIÓN"],
  [246.6, 53.8, "CANTIDAD"],
  [303.3, 59.5, "PRECIO UD."],
  [365.6, 65.2, "SUBTOTAL"],
  [433.6, 51, "DTO."],
  [487.5, 82.2, "TOTAL"],
];

const BANDA_TOTALES: [number, number, string][] = [
  [14.2, 53.8, "TIPO"],
  [53.8, 121.8, "IMPORTE"],
  [121.8, 189.8, "DESCUENTO"],
  [189.8, 257.9, "PRONTO PAGO"],
  [257.9, 320.3, "PORTES"],
  [320.3, 393.9, "FINANCIACIÓN"],
  [393.9, 453.4, "BASE"],
  [453.4, 515.8, "I.V.A."],
  [515.8, 569.6, "I.R.P.F."],
];

export function Hoja({
  datos,
  numero,
  lineas,
  pagina,
  paginas,
  fecha,
  totales,
}: {
  datos: DatosFacturacion;
  /** Ya formateado. Vacío mientras la factura no se haya emitido. */
  numero: string;
  lineas: LineaFactura[];
  pagina: number;
  paginas: number;
  fecha: string;
  /** Solo en la última hoja: es donde FactuSOL imprime los totales. */
  totales: TotalesFactura | null;
}) {
  const { emisor: EMISOR, cliente: CLIENTE } = datos;
  const e: React.ReactNode[] = [];

  // ── Emisor ──
  e.push(texto("em1", 29.7, 31.2, S, EMISOR.nombre, { negrita: true }));
  e.push(texto("em2", 46.7, 31.2, S, EMISOR.direccion));
  e.push(texto("em3", 60.9, 31.2, S, EMISOR.cp));
  e.push(texto("em4", 60.9, 87.8, S, EMISOR.poblacion));
  e.push(texto("em5", 75, 31.2, S, EMISOR.provincia));
  e.push(texto("em6", 89.2, 31.2, S, EMISOR.nif));
  e.push(texto("em7", 103.4, 31.2, S, EMISOR.telefono));

  // ── Cliente ──
  e.push(caja("cl0", 76.6, 291.9, 277.7, 85, AZUL, AZUL_BORDE));
  e.push(texto("cl1", 92.1, 311.7, S, CLIENTE.nombre, { negrita: true }));
  e.push(texto("cl2", 106.2, 311.7, S, CLIENTE.direccion));
  e.push(texto("cl3", 120.4, 311.7, S, CLIENTE.cp));
  e.push(texto("cl4", 120.4, 365.6, S, CLIENTE.poblacion));
  e.push(texto("cl5", 134.6, 311.7, S, CLIENTE.provincia));
  e.push(texto("cl6", 134.6, 422.4, S, CLIENTE.codigo));

  // ── Documento / número / página / fecha ──
  e.push(caja("db", 161.5, 14.2, 246.6, 16.9, MORADO, MORADO));
  const cabecera: [number, string, string][] = [
    [14.2, "Documento", "Factura"],
    [76.6, "Número", numero],
    [138.8, "Página", `${pagina}`],
    [201.2, "Fecha", fecha],
  ];
  for (const [x, etiqueta, valor] of cabecera) {
    e.push(centrado(`cab-l-${x}`, 165.6, x, 59.5, s, etiqueta, { negrita: true, color: "#fff" }));
    e.push(caja(`cab-c-${x}`, 184.2, x, 59.5, 16.9, GRIS, BORDE));
    e.push(centrado(`cab-v-${x}`, 188.3, x, 59.5, s, valor));
  }

  // ── N.I.F. / agente / forma de pago ──
  const fila: [number, number, string, string, number][] = [
    [14.2, 73.7, "N.I.F.", CLIENTE.nif, 31.2],
    [90.7, 272, "AGENTE", "", 201.2],
    [365.6, 204, "FORMA DE PAGO", "", 0],
  ];
  for (const [x, ancho, etiqueta, valor, lx] of fila) {
    e.push(caja(`f-b-${x}`, 206.9, x, ancho, 16.9, LILA, BORDE));
    e.push(
      lx
        ? texto(`f-l-${x}`, 211, lx, s, etiqueta, { negrita: true, color: "#fff" })
        : centrado(`f-l-${x}`, 211, x, ancho, s, etiqueta, { negrita: true, color: "#fff" }),
    );
    e.push(caja(`f-c-${x}`, 229.6, x, ancho, 16.9, GRIS, BORDE));
    e.push(texto(`f-v-${x}`, 233.6, x + 11.4, s, valor));
  }

  // ── Tabla de líneas ──
  for (const [x, ancho, etiqueta] of COLUMNAS) {
    e.push(caja(`th-${x}`, 252.2, x, ancho, 19.8, MORADO, MORADO));
    e.push(centrado(`tl-${x}`, 259.2, x, ancho, s, etiqueta, { negrita: true, color: "#fff" }));
  }
  for (const [x, ancho] of [
    [14.2, 73.7],
    [246.6, 53.8],
    [306.1, 59.5],
    [365.6, 65.2],
    [433.6, 51],
    [487.5, 82.2],
  ]) {
    e.push(caja(`tb-${x}`, 274.9, x, ancho, 274.9, FONDO, GRIS_BORDE));
  }
  e.push(caja("tb-desc", 277.8, 99.2, 153, 274.9, FONDO, GRIS_BORDE));

  let y = 284.6;
  for (const linea of lineas) {
    e.push(texto(`a-${linea.comanda}`, y, 22.7, s, datos.articulo));
    e.push(texto(`d-${linea.comanda}`, y, 99.2, s, `Pedido numero ${linea.comanda}`));
    e.push(derecha(`c-${linea.comanda}`, y, 291.9, s, euros(1)));
    e.push(derecha(`p-${linea.comanda}`, y, 351.6, s, euros(linea.importe)));
    e.push(derecha(`s-${linea.comanda}`, y, 419.5, s, euros(linea.importe)));
    e.push(derecha(`t-${linea.comanda}`, y, 561.2, s, euros(linea.importe)));
    y += 10.77;
  }

  // ── Banda de bases e impuestos ──
  e.push(caja("bt-h", 572.6, 14.2, 555.4, 16.9, LILA, BORDE));
  e.push(caja("bt-b", 592.4, 14.2, 555.4, 51, FONDO, BORDE));
  for (const x of [53.8, 121.8, 189.8, 257.9, 320.3, 393.9, 453.4, 515.8]) {
    e.push(caja(`bt-d-${x}`, 572.6, x, 0.36, 70.8, "#000"));
  }
  for (const [x0, x1, etiqueta] of BANDA_TOTALES) {
    e.push(centrado(`bt-l-${x0}`, 576.6, x0, x1 - x0, s, etiqueta, { negrita: true, color: "#fff" }));
  }
  [21, 10, 4].forEach((tipo, i) => {
    const ty = 596.5 + i * 11.3;
    e.push(derecha(`bt-t-${tipo}`, ty, 45.3, s, `${tipo}`));
    if (totales && tipo === IVA) {
      e.push(derecha(`bt-i-${tipo}`, ty, 113.4, s, euros(totales.base)));
      e.push(derecha(`bt-ba-${tipo}`, ty, 444.9, s, euros(totales.base)));
      e.push(derecha(`bt-iv-${tipo}`, ty, 507.4, s, euros(totales.iva)));
    }
  });
  if (totales) {
    e.push(derecha("bt-irpf", 596.5, 561.2, s, euros(totales.irpf)));
    e.push(derecha("bt-irpf-pct", 607.8, 561.2, s, `${euros(IRPF)}%`));
  }

  // ── Observaciones y total ──
  e.push(caja("ob-b", 649.1, 14.2, 107.6, 16.9, LILA, BORDE));
  e.push(texto("ob-l", 653.2, 25.6, s, "OBSERVACIONES:", { negrita: true, color: "#fff" }));
  e.push(caja("to-b", 649.1, 393.9, 175.7, 16.9, "#fff", MORADO));
  if (totales) {
    e.push(texto("to-l", 653.3, 405.3, S, "TOTAL:", { negrita: true }));
    e.push(derecha("to-v", 653.3, 561.2, S, euros(totales.total), { negrita: true }));
  }
  e.push(caja("ob-c", 671.7, 2.9, 555.4, 31.1, "#fff", BORDE));
  if (paginas > 1) {
    e.push(texto("ob-t", 676.5, 10, s, `Full ${pagina} de ${paginas}`));
  }

  // ── Vencimientos ──
  e.push(caja("ve-b", 708.7, 14.2, 555.4, 16.9, LILA, BORDE));
  for (const [x, etiqueta] of [
    [22.7, "Vencimientos"],
    [99.2, "Importe"],
    [158.8, "Domiciliación"],
    [311.7, "Oficina"],
    [453.6, "Número de cuenta"],
  ] as [number, string][]) {
    e.push(texto(`ve-l-${x}`, 712.7, x, s, etiqueta, { negrita: true, color: "#fff" }));
  }
  for (const [x, ancho] of [
    [14.2, 62.3],
    [79.3, 67.9],
    [150.2, 419.5],
  ]) {
    e.push(caja(`ve-c-${x}`, 731.3, x, ancho, 82.2, AZUL, AZUL_BORDE));
  }

  return (
    <div
      className="factura-hoja"
      style={{
        position: "relative",
        width: "595.3pt",
        height: "841.9pt",
        overflow: "hidden",
        background: "#fff",
        color: "#000",
        // Calibri es la de FactuSOL. Donde no esté (el móvil), cae en la del
        // sistema: cambia la letra, no la maqueta.
        fontFamily: "Calibri, Carlito, system-ui, sans-serif",
      }}
    >
      {e}
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
  const [editando, setEditando] = useState<string | null>(null);
  const [borrador, setBorrador] = useState("");
  const [emitida, setEmitida] = useState<FacturaEmitida | null>(null);
  const [emitiendo, setEmitiendo] = useState(false);
  const [errorEmision, setErrorEmision] = useState<string | null>(null);

  const conImporte = useMemo(
    () => entregats.filter((s) => s.price !== null && s.price > 0),
    [entregats],
  );
  const sinImporte = useMemo(
    () => entregats.filter((s) => s.price === null || s.price === 0),
    [entregats],
  );

  const lineas: LineaFactura[] = useMemo(
    () => conImporte.map((s) => ({ comanda: s.id, importe: s.price as number })),
    [conImporte],
  );
  const totales = useMemo(() => calcularTotales(lineas), [lineas]);
  const paginas = useMemo(() => paginar(lineas), [lineas]);
  const hoy = new Date().toISOString().slice(0, 10);

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

  const guardar = (orderId: string) => {
    const limpio = borrador.trim().replace(",", ".");
    const valor = limpio === "" ? null : Number(limpio);
    if (valor !== null && (!Number.isFinite(valor) || valor < 0)) return;
    onImporte(orderId, valor);
    setEditando(null);
    setBorrador("");
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background lg:left-64">
      <div className="mx-auto max-w-lg space-y-6 px-4 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Factura</h2>
            <p className="text-sm text-muted-foreground">
              {mes} · {conImporte.length}{" "}
              {conImporte.length === 1 ? "comanda" : "comandes"}
            </p>
          </div>
          <Button variant="ghost" size="touch" onClick={onTancar} aria-label="Tancar">
            <X />
          </Button>
        </div>

        {sinImporte.length > 0 && (
          <div className="soft-card space-y-3 p-4">
            <p className="text-sm font-semibold text-status-incidencia">
              {sinImporte.length}{" "}
              {sinImporte.length === 1 ? "entrega sense import" : "entregues sense import"}
            </p>
            <p className="text-xs text-muted-foreground">
              No entren a la factura fins que no els posis preu.
            </p>
            <ul className="space-y-2">
              {sinImporte.map((stop) => (
                <li key={stop.id} className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm">
                    <span className="tabular-nums">{stop.id}</span>
                    {stop.customer && (
                      <span className="text-muted-foreground"> · {stop.customer}</span>
                    )}
                  </span>
                  {editando === stop.id ? (
                    <>
                      <input
                        value={borrador}
                        onChange={(e) => setBorrador(e.target.value)}
                        type="text"
                        inputMode="decimal"
                        autoFocus
                        placeholder="0,00"
                        className="w-20 rounded-lg bg-muted px-2 py-1.5 text-right text-base tabular-nums outline-none"
                      />
                      <Button size="sm" onClick={() => guardar(stop.id)}>
                        Desar
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditando(stop.id);
                        setBorrador("");
                      }}
                    >
                      Posar import
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="soft-card divide-y divide-border">
          {conImporte.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Cap entrega amb import aquest mes.
            </p>
          ) : (
            conImporte.map((stop) => (
              <div key={stop.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex-1 truncate text-sm">
                  <span className="tabular-nums">{stop.id}</span>
                  {stop.customer && (
                    <span className="text-muted-foreground"> · {stop.customer}</span>
                  )}
                </span>
                <span className="tabular-nums text-sm font-medium">
                  {euros(stop.price as number)} €
                </span>
              </div>
            ))
          )}
        </div>

        <div className="soft-card space-y-2 p-4 text-sm">
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
        <div className="mx-auto max-w-lg space-y-2">
          {errorEmision && (
            <p className="text-center text-sm text-status-incidencia">{errorEmision}</p>
          )}
          {!online && !emitida && (
            <p className="text-center text-xs text-muted-foreground">
              Necessites cobertura per emetre-la: el número el reparteix el servidor.
            </p>
          )}
          {emitida ? (
            <Button size="touch" className="w-full" onClick={() => window.print()}>
              <Printer strokeWidth={2.2} />
              Imprimir la {formatearNumero(emitida.numero)}
            </Button>
          ) : (
            <Button
              size="touch"
              className="w-full"
              disabled={lineas.length === 0 || !online || emitiendo}
              onClick={() => void emitir()}
            >
              <FileCheck strokeWidth={2.2} />
              {emitiendo ? "Emetent…" : "Emetre factura"}
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
