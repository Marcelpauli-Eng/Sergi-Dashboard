import { IRPF, IVA, euros } from "./factura.ts";
import type {
  ClienteFacturacion,
  DatosFacturacion,
  LineaFactura,
  TotalesFactura,
} from "./factura.ts";

/**
 * La maqueta de la hoja A4 de la factura, en puntos.
 *
 * Aquí no se pinta nada: se describe DÓNDE va cada caja y cada texto, y de
 * eso se encargan dos dibujantes distintos —la pantalla (`components/
 * factura.tsx`) y el PDF (`lib/pdf.ts`)—. Separarlo es lo que evita tener
 * la misma factura maquetada dos veces y que se vayan separando con los
 * años: quien mueva una caja la mueve en los dos sitios a la vez.
 *
 * Las medidas salen de medir la factura 1-000029 de FactuSOL con
 * `pdftotext -bbox`. Por eso son números "raros" y no múltiplos de 4: son
 * los del documento original. El punto es la unidad del PDF, así que el
 * dibujante de PDF las copia tal cual.
 *
 * El origen es la esquina SUPERIOR izquierda, como en CSS. El PDF cuenta al
 * revés y ya se ocupa él de darle la vuelta.
 */

export const A4_ANCHO = 595.3;
export const A4_ALTO = 841.9;

export const MORADO = "#800080";
export const LILA = "#6767B4";
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

/** Grosor de los filetes de FactuSOL. Fino, casi un pelo. */
export const FILETE = 0.36;

export type Alineacion = "left" | "center" | "right";

export type Elemento =
  | {
      tipo: "caja";
      top: number;
      left: number;
      ancho: number;
      alto: number;
      fondo?: string;
      borde?: string;
    }
  | {
      tipo: "texto";
      top: number;
      left: number;
      cuerpo: number;
      valor: string;
      negrita?: boolean;
      color?: string;
      /** Ancho de la caja de texto, solo cuando hay que alinear dentro. */
      ancho?: number;
      alinear?: Alineacion;
    };

function caja(
  top: number,
  left: number,
  ancho: number,
  alto: number,
  fondo?: string,
  borde?: string,
): Elemento {
  return { tipo: "caja", top, left, ancho, alto, fondo, borde };
}

function texto(
  top: number,
  left: number,
  cuerpo: number,
  valor: string | number | null | undefined,
  opciones: {
    negrita?: boolean;
    color?: string;
    ancho?: number;
    alinear?: Alineacion;
  } = {},
): Elemento | null {
  if (valor === null || valor === undefined || valor === "") return null;
  return { tipo: "texto", top, left, cuerpo, valor: String(valor), ...opciones };
}

/**
 * Texto pegado a un borde derecho, como todos los importes de la factura.
 *
 * La caja se extiende 260 pt hacia la izquierda desde `x`. Es más de lo que
 * mide cualquier importe, así que el texto siempre queda pegado a `x` sin
 * tener que saber cuánto ocupa.
 */
function derecha(
  top: number,
  x: number,
  cuerpo: number,
  valor: string | null,
  opciones: { negrita?: boolean } = {},
): Elemento | null {
  return texto(top, x - 260, cuerpo, valor, { ...opciones, ancho: 260, alinear: "right" });
}

function centrado(
  top: number,
  left: number,
  ancho: number,
  cuerpo: number,
  valor: string,
  opciones: { negrita?: boolean; color?: string } = {},
): Elemento | null {
  return texto(top, left, cuerpo, valor, { ...opciones, ancho, alinear: "center" });
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

export interface HojaOpciones {
  datos: DatosFacturacion;
  /** A quién se le factura ESTA factura. */
  cliente: ClienteFacturacion;
  /** Ya formateado. Vacío mientras la factura no se haya emitido. */
  numero: string;
  lineas: LineaFactura[];
  pagina: number;
  paginas: number;
  fecha: string;
  /** Solo en la última hoja: es donde FactuSOL imprime los totales. */
  totales: TotalesFactura | null;
}

/** Todo lo que hay que dibujar en una hoja, en orden de pintado. */
export function componerHoja({
  datos,
  cliente: CLIENTE,
  numero,
  lineas,
  pagina,
  paginas,
  fecha,
  totales,
}: HojaOpciones): Elemento[] {
  const EMISOR = datos.emisor;
  const e: (Elemento | null)[] = [];

  // ── Emisor ──
  e.push(texto(29.7, 31.2, S, EMISOR.nombre, { negrita: true }));
  e.push(texto(46.7, 31.2, S, EMISOR.direccion));
  e.push(texto(60.9, 31.2, S, EMISOR.cp));
  e.push(texto(60.9, 87.8, S, EMISOR.poblacion));
  e.push(texto(75, 31.2, S, EMISOR.provincia));
  e.push(texto(89.2, 31.2, S, EMISOR.nif));
  e.push(texto(103.4, 31.2, S, EMISOR.telefono));

  // ── Cliente ──
  e.push(caja(76.6, 291.9, 277.7, 85, AZUL, AZUL_BORDE));
  e.push(texto(92.1, 311.7, S, CLIENTE.nombre, { negrita: true }));
  e.push(texto(106.2, 311.7, S, CLIENTE.direccion));
  e.push(texto(120.4, 311.7, S, CLIENTE.cp));
  e.push(texto(120.4, 365.6, S, CLIENTE.poblacion));
  e.push(texto(134.6, 311.7, S, CLIENTE.provincia));
  e.push(texto(134.6, 422.4, S, CLIENTE.codigo));

  // ── Documento / número / página / fecha ──
  e.push(caja(161.5, 14.2, 246.6, 16.9, MORADO, MORADO));
  const cabecera: [number, string, string][] = [
    [14.2, "Documento", "Factura"],
    [76.6, "Número", numero],
    [138.8, "Página", `${pagina}`],
    [201.2, "Fecha", fecha],
  ];
  for (const [x, etiqueta, valor] of cabecera) {
    e.push(centrado(165.6, x, 59.5, s, etiqueta, { negrita: true, color: "#fff" }));
    e.push(caja(184.2, x, 59.5, 16.9, GRIS, BORDE));
    e.push(centrado(188.3, x, 59.5, s, valor));
  }

  // ── N.I.F. / agente / forma de pago ──
  const fila: [number, number, string, string, number][] = [
    [14.2, 73.7, "N.I.F.", CLIENTE.nif, 31.2],
    [90.7, 272, "AGENTE", "", 201.2],
    [365.6, 204, "FORMA DE PAGO", "", 0],
  ];
  for (const [x, ancho, etiqueta, valor, lx] of fila) {
    e.push(caja(206.9, x, ancho, 16.9, LILA, BORDE));
    e.push(
      lx
        ? texto(211, lx, s, etiqueta, { negrita: true, color: "#fff" })
        : centrado(211, x, ancho, s, etiqueta, { negrita: true, color: "#fff" }),
    );
    e.push(caja(229.6, x, ancho, 16.9, GRIS, BORDE));
    e.push(texto(233.6, x + 11.4, s, valor));
  }

  // ── Tabla de líneas ──
  for (const [x, ancho, etiqueta] of COLUMNAS) {
    e.push(caja(252.2, x, ancho, 19.8, MORADO, MORADO));
    e.push(centrado(259.2, x, ancho, s, etiqueta, { negrita: true, color: "#fff" }));
  }
  for (const [x, ancho] of [
    [14.2, 73.7],
    [246.6, 53.8],
    [306.1, 59.5],
    [365.6, 65.2],
    [433.6, 51],
    [487.5, 82.2],
  ]) {
    e.push(caja(274.9, x, ancho, 274.9, FONDO, GRIS_BORDE));
  }
  e.push(caja(277.8, 99.2, 153, 274.9, FONDO, GRIS_BORDE));

  let y = 284.6;
  for (const linea of lineas) {
    e.push(texto(y, 22.7, s, datos.articulo));
    e.push(texto(y, 99.2, s, `Pedido numero ${linea.comanda}`));
    e.push(derecha(y, 291.9, s, euros(1)));
    e.push(derecha(y, 351.6, s, euros(linea.importe)));
    e.push(derecha(y, 419.5, s, euros(linea.importe)));
    e.push(derecha(y, 561.2, s, euros(linea.importe)));
    y += 10.77;
  }

  // ── Banda de bases e impuestos ──
  e.push(caja(572.6, 14.2, 555.4, 16.9, LILA, BORDE));
  e.push(caja(592.4, 14.2, 555.4, 51, FONDO, BORDE));
  for (const x of [53.8, 121.8, 189.8, 257.9, 320.3, 393.9, 453.4, 515.8]) {
    e.push(caja(572.6, x, FILETE, 70.8, "#000"));
  }
  for (const [x0, x1, etiqueta] of BANDA_TOTALES) {
    e.push(centrado(576.6, x0, x1 - x0, s, etiqueta, { negrita: true, color: "#fff" }));
  }
  [21, 10, 4].forEach((tipo, i) => {
    const ty = 596.5 + i * 11.3;
    e.push(derecha(ty, 45.3, s, `${tipo}`));
    if (totales && tipo === IVA) {
      e.push(derecha(ty, 113.4, s, euros(totales.base)));
      e.push(derecha(ty, 444.9, s, euros(totales.base)));
      e.push(derecha(ty, 507.4, s, euros(totales.iva)));
    }
  });
  if (totales) {
    e.push(derecha(596.5, 561.2, s, euros(totales.irpf)));
    e.push(derecha(607.8, 561.2, s, `${euros(IRPF)}%`));
  }

  // ── Observaciones y total ──
  e.push(caja(649.1, 14.2, 107.6, 16.9, LILA, BORDE));
  e.push(texto(653.2, 25.6, s, "OBSERVACIONES:", { negrita: true, color: "#fff" }));
  e.push(caja(649.1, 393.9, 175.7, 16.9, "#fff", MORADO));
  if (totales) {
    e.push(texto(653.3, 405.3, S, "TOTAL:", { negrita: true }));
    e.push(derecha(653.3, 561.2, S, euros(totales.total), { negrita: true }));
  }
  e.push(caja(671.7, 2.9, 555.4, 31.1, "#fff", BORDE));
  if (paginas > 1) {
    e.push(texto(676.5, 10, s, `Full ${pagina} de ${paginas}`));
  }

  // ── Vencimientos ──
  e.push(caja(708.7, 14.2, 555.4, 16.9, LILA, BORDE));
  for (const [x, etiqueta] of [
    [22.7, "Vencimientos"],
    [99.2, "Importe"],
    [158.8, "Domiciliación"],
    [311.7, "Oficina"],
    [453.6, "Número de cuenta"],
  ] as [number, string][]) {
    e.push(texto(712.7, x, s, etiqueta, { negrita: true, color: "#fff" }));
  }
  for (const [x, ancho] of [
    [14.2, 62.3],
    [79.3, 67.9],
    [150.2, 419.5],
  ]) {
    e.push(caja(731.3, x, ancho, 82.2, AZUL, AZUL_BORDE));
  }

  return e.filter((x): x is Elemento => x !== null);
}
