/**
 * Cómo se lee y se escribe UNA celda del Google Sheet.
 *
 * Aparte de `lib/sheets.ts` porque aquello habla con Google —y arrastra
 * `server-only`, que fuera de un componente de servidor revienta al
 * importarlo— y esto es interpretación de texto y nada más. Separarlo
 * permite comprobarlo sin red y sin servidor: ver `scripts/check-cells.mts`.
 *
 * Es donde se decide si una fila se lee bien o se lee mal, así que cada
 * variante que acepta está aquí escrita a propósito: la oficina rellena la
 * hoja a mano y escribe "Entregat", "ENTREGADO", "x" o "Sí" según el día.
 */

import type { ColumnKey } from "./sheet-schema.ts";
import type { DeliveryStatus, Order } from "./types.ts";

/** Índice de columna (0-based) a letra de columna: 0 → A, 26 → AA. */
export function columnLetter(index: number): string {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

/** El contenido de una celda como texto limpio. */
export function text(raw: unknown): string {
  return String(raw ?? "").trim();
}

/**
 * Texto de celda listo para comparar: sin espacios, sin acentos y en
 * minúsculas. Lo que hace que "Incidència" y "INCIDENCIA" sean lo mismo.
 */
function clave(raw: unknown): string {
  return text(raw)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacríticos
    .toLowerCase();
}

/**
 * Un número de celda. Acepta la coma decimal, que es como escribe la
 * oficina, y devuelve `null` para lo que no sea un número.
 */
export function parseNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

/** Sin prioridad: al final de la ruta, pero antes de desbordar el número. */
export const NO_PRIORITY = Number.MAX_SAFE_INTEGER;

/**
 * Prioridad como número, donde menor = antes.
 *
 * La hoja la escribe como texto ("Urgent", "Normal") tanto como en número,
 * así que se traduce. Se dejan huecos entre los valores para poder
 * intercalar niveles nuevos sin renumerar.
 */
export function parsePriority(raw: unknown): number {
  const numeric = parseNumber(raw);
  if (numeric !== null) return numeric;

  const k = clave(raw);
  if (k === "") return NO_PRIORITY;
  if (["urgent", "urgente", "alta", "alt", "prioritario", "alta prioridad"].includes(k)) {
    return 10;
  }
  if (["normal", "media", "mitja", "estandar", "standard"].includes(k)) return 20;
  if (["baja", "baixa", "baix", "bajo"].includes(k)) return 30;

  // Un texto que no reconocemos no debe colarse por delante de nada.
  return NO_PRIORITY;
}

/** Valores de la celda de estado que significan "entregado". */
const ENTREGADO = ["entregado", "entregada", "entregat", "si", "ok", "x", "true", "1"];

/** Los que significan que algo ha ido mal. */
const INCIDENCIA = [
  "incidencia",
  "ausente",
  "rechazado",
  "rebutjat",
  "no entregado",
  "no entregat",
  "ko",
];

/** Los que significan que el reparto está empezado pero sin cerrar. */
const EN_CURSO = ["en curs", "en curso", "en camino", "en ruta"];

/**
 * El estado de la entrega: los tres valores que la app sabe escribir.
 *
 * Una celda vacía es un pedido pendiente, y cualquier cosa que no
 * reconozcamos también: es preferible que una parada salga en la ruta de más
 * a que desaparezca sin que nadie se entere.
 */
export function parseStatus(raw: unknown): DeliveryStatus {
  const k = clave(raw);
  if (k === "") return "pendiente";
  if (ENTREGADO.includes(k)) return "entregado";
  if (INCIDENCIA.includes(k)) return "incidencia";
  return "pendiente";
}

/**
 * La categoría con la que la pantalla reparte los pedidos.
 *
 * Es más fina que `parseStatus`: distingue el reparto ya empezado
 * ("en curs"), que para el Sheet sigue siendo un pendiente porque no hay
 * nada que escribir todavía.
 */
export function parseStatusCategory(
  raw: unknown,
): "pendent" | "en_curs" | "entregat" | "incidencia" {
  const k = clave(raw);
  if (k === "") return "pendent";
  if (ENTREGADO.includes(k)) return "entregat";
  if (INCIDENCIA.includes(k)) return "incidencia";
  if (EN_CURSO.includes(k)) return "en_curs";
  return "pendent";
}

/**
 * Junta a una comanda otra fila suya: un bulto más.
 *
 * La oficina escribe un bulto por fila. Todas llevan el mismo nº de comanda
 * y solo la primera trae dirección, cliente y teléfono; las demás solo las
 * medidas. Son UNA entrega en UNA dirección, así que se fusionan en una
 * parada sola.
 *
 * Antes se descartaban por "ID duplicado": en la hoja real eso son entre el
 * 10 % y el 27 % de las filas de cada mes, y con ellas se perdían las
 * medidas de los otros bultos —una comanda de cuatro paquetes enseñaba uno—
 * y a veces el dato bueno, porque la fila que ganaba era la primera aunque
 * fuera la más vacía.
 *
 * Manda siempre lo que ya tuviera la comanda; el bulto solo rellena huecos.
 * El estado no se toca a propósito: si la primera fila dice "Pendent" y otra
 * dice "Entregat", la parada sigue en la ruta. Salir de más es recuperable;
 * que una entrega desaparezca de la pantalla, no.
 */
export function fusionarBulto(base: Order, bulto: Order): Order {
  return {
    ...base,
    customer: base.customer || bulto.customer,
    creationDate: base.creationDate ?? bulto.creationDate,
    date: base.date || bulto.date,
    // Un "Urgent" en cualquier bulto sube la comanda entera: es el mismo
    // camión y el mismo viaje.
    priority: Math.min(base.priority, bulto.priority),
    city: base.city ?? bulto.city,
    phone: base.phone ?? bulto.phone,
    notes: base.notes ?? bulto.notes,
    billingClient: base.billingClient ?? bulto.billingClient,
    incidentNote: base.incidentNote ?? bulto.incidentNote,
    deliveredTime: base.deliveredTime ?? bulto.deliveredTime,
    lat: base.lat ?? bulto.lat,
    lng: base.lng ?? bulto.lng,
    measures: [base.measures, bulto.measures].filter(Boolean).join(" · ") || null,
    bultos: base.bultos + bulto.bultos,
    rowNumbers: [...base.rowNumbers, ...bulto.rowNumbers],
  };
}

/**
 * La fila que se añade al crear una comanda a mano.
 *
 * Cada dato va a la columna que le toca según la cabecera de ESA pestaña, no
 * en un orden fijo: en la hoja real el nº de comanda es la G y el cliente la
 * B, y en otra hoja serían otras. Por eso se construye por posición.
 *
 * Los huecos entre columnas tienen que salir como celda vacía y no como
 * agujero: `append` cuenta posiciones, y un hueco correría todo lo de la
 * derecha una columna a la izquierda —el teléfono acabaría en la columna del
 * estado de la entrega—.
 */
export function filaNovaComanda(
  valores: Partial<Record<ColumnKey, string>>,
  headerMap: Partial<Record<ColumnKey, number>>,
): string[] {
  const fila: string[] = [];

  for (const [columna, valor] of Object.entries(valores) as [ColumnKey, string][]) {
    const i = headerMap[columna];
    if (i === undefined || valor.trim() === "") continue;
    fila[i] = valor.trim();
  }

  return Array.from(fila, (celda) => celda ?? "");
}
