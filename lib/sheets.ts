import "server-only";
import { googleAccessToken } from "./google-auth";
import { env } from "./env";
import { parseSheetDate, formatSheetTimestamp, today } from "./dates";
import { findMonthTab, findLatestTabUpTo, noTabFoundMessage } from "./sheet-tab";
import {
  mapHeaders,
  canonicalHeader,
  REQUIRED_COLUMNS,
  MANAGED_COLUMNS,
  MissingColumnsError,
  type ColumnKey,
} from "./sheet-schema";
import type { DeliveryRecord, DeliveryStatus, Order } from "./types";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

/** Índice de columna (0-based) a letra de columna: 0 → A, 26 → AA. */
function columnLetter(index: number): string {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

/** Rango A1 con el nombre de pestaña escapado (puede llevar espacios). */
function range(a1: string, sheetTab?: string | null): string {
  const tab = sheetTab ?? env.google.sheetTab;
  if (!tab) return a1;
  // Las comillas simples en el nombre de pestaña se escapan duplicándolas.
  // Envolvemos siempre en comillas simples para que funcionen tabs con espacios.
  return `'${tab.replace(/'/g, "''")}'!${a1}`;
}

async function sheetsFetch(path: string, init?: RequestInit): Promise<unknown> {
  const token = await googleAccessToken();
  const response = await fetch(`${API}/${env.google.sheetId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    // Los datos del Sheet cambian constantemente; nunca los cachea Next.
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Google Sheets respondió ${response.status} en ${path}: ${body.slice(0, 500)}`,
    );
  }

  return response.json();
}

/**
 * Devuelve los nombres de todas las pestañas (hojas) del Google Sheet.
 */
export async function listSheetTabs(): Promise<string[]> {
  const data = (await sheetsFetch(
    `?fields=sheets.properties.title`,
  )) as {
    sheets?: { properties?: { title?: string } }[];
  };

  return (data.sheets ?? [])
    .map((s) => s.properties?.title ?? "")
    .filter((title) => title.length > 0);
}

function parseStatus(raw: unknown): DeliveryStatus {
  const text = String(raw ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // diacríticos
    .toLowerCase();
  // Si la celda está vacía, el pedido está pendiente.
  if (text === "") return "pendiente";
  if (["entregado", "entregada", "entregat", "si", "sí", "ok", "x", "true", "1"].includes(text)) {
    return "entregado";
  }
  if (["pendent", "pendiente", "pendent de recollir"].includes(text)) {
    return "pendiente";
  }
  if (
    [
      "incidencia",
      "incidència",
      "ausente",
      "rechazado",
      "rebutjat",
      "no entregado",
      "no entregat",
      "ko",
    ].includes(text)
  ) {
    return "incidencia";
  }
  // Cualquier otro valor (ej: "Entregat -", "Recollir") se trata como pendiente.
  return "pendiente";
}

function parseStatusCategory(raw: unknown): "pendent" | "en_curs" | "entregat" | "incidencia" {
  const t = String(raw ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (t === "") return "pendent";
  if (["entregado", "entregada", "entregat", "si", "ok", "x", "true", "1"].includes(t)) return "entregat";
  if (["incidencia", "ausente", "rechazado", "rebutjat", "no entregado", "no entregat", "ko"].includes(t)) return "incidencia";
  if (["en curs", "en curso", "en camino", "en ruta"].includes(t)) return "en_curs";
  return "pendent";
}

function parseNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

/** Sin prioridad: al final de la ruta, pero antes de desbordar el número. */
const NO_PRIORITY = Number.MAX_SAFE_INTEGER;

/**
 * Prioridad como número, donde menor = antes.
 *
 * La hoja la escribe como texto ("Urgent", "Normal"), no como número, así
 * que se traduce. Se dejan huecos entre los valores para poder intercalar
 * niveles nuevos sin renumerar.
 */
function parsePriority(raw: unknown): number {
  const numeric = parseNumber(raw);
  if (numeric !== null) return numeric;

  const textStr = text(raw);
  if (textStr === "") return NO_PRIORITY;
  if (["urgent", "urgente", "alta", "alt", "prioritario", "alta prioridad"].includes(textStr)) {
    return 10;
  }
  if (["normal", "media", "mitja", "estandar", "standard"].includes(textStr)) return 20;
  if (["baja", "baixa", "baix", "bajo"].includes(textStr)) return 30;

  // Un texto que no reconocemos no debe colarse por delante de nada.
  return NO_PRIORITY;
}

function text(raw: unknown): string {
  return String(raw ?? "").trim();
}

export interface SheetSnapshot {
  /** Todos los pedidos válidos de la hoja. */
  orders: Order[];
  /** Índice de cada columna del modelo dentro de la hoja. */
  headerMap: Partial<Record<ColumnKey, number>>;
  /** Filas que se descartaron y por qué, para poder avisar en logs. */
  skipped: { rowNumber: number; reason: string }[];
  /** Nombre de la pestaña que se leyó. */
  sheetTab: string | null;
}

/**
 * Lee la hoja entera y la normaliza.
 *
 * Se piden los valores sin formatear y las fechas como número de serie:
 * así el parseo no depende del locale con el que esté configurada la hoja.
 *
 * @param sheetTab - Nombre de la pestaña a leer. Si no se pasa, usa la de env.
 */
export async function readSheet(sheetTab?: string | null): Promise<SheetSnapshot> {
  const tab = sheetTab ?? env.google.sheetTab;

  const data = (await sheetsFetch(
    `/values/${encodeURIComponent(range("A1:ZZ", tab))}` +
      `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
  )) as { values?: unknown[][] };

  const rows = data.values ?? [];
  if (rows.length === 0) {
    throw new Error(
      `La pestaña "${tab}" está vacía. Comprueba el nombre de la pestaña.`,
    );
  }

  const headerRow = (rows[0] ?? []).map((cell) => String(cell ?? ""));
  const headerMap = mapHeaders(headerRow);

  const missing = REQUIRED_COLUMNS.filter((key) => headerMap[key] === undefined);
  if (missing.length > 0) throw new MissingColumnsError(missing);

  const cell = (row: unknown[], key: ColumnKey): unknown => {
    const index = headerMap[key];
    return index === undefined ? undefined : row[index];
  };

  const orders: Order[] = [];
  const skipped: SheetSnapshot["skipped"] = [];
  const seenIds = new Set<string>();

  // Comprobar si hay columna driverId y date
  const hasDriverId = headerMap["driverId"] !== undefined;
  const hasDate = headerMap["date"] !== undefined;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNumber = i + 1; // Sheets numera desde 1 y la fila 1 es la cabecera.

    const id = text(cell(row, "id"));
    const address = text(cell(row, "address"));
    const driverId = hasDriverId ? text(cell(row, "driverId")).toLowerCase() : "";
    const date = hasDate ? parseSheetDate(cell(row, "date")) : null;

    // Filas completamente vacías: se ignoran sin ruido.
    if (!id && !address) continue;

    if (!id) {
      skipped.push({ rowNumber, reason: "sin ID de pedido (Nº Comanda)" });
      continue;
    }
    if (seenIds.has(id)) {
      skipped.push({ rowNumber, reason: `ID duplicado "${id}"` });
      continue;
    }
    // Solo requerimos fecha si la columna existe
    if (hasDate && !date) {
      skipped.push({ rowNumber, reason: "fecha ilegible" });
      continue;
    }
    if (!address) {
      skipped.push({ rowNumber, reason: "sin dirección" });
      continue;
    }

    seenIds.add(id);

    // Construir dirección completa con la ciudad si existe
    const city = text(cell(row, "city")) || null;

    orders.push({
      id,
      driverId,
      date: date ?? "",
      priority: parseNumber(cell(row, "priority")) ?? Number.MAX_SAFE_INTEGER,
      customer: text(cell(row, "customer")),
      address,
      city,
      phone: text(cell(row, "phone")) || null,
      measures: text(cell(row, "measures")) || null,
      notes: text(cell(row, "notes")) || null,
      status: parseStatus(cell(row, "status")),
      rawStatus: text(cell(row, "status")),
      statusCategory: parseStatusCategory(cell(row, "status")),
      lat: parseNumber(cell(row, "lat")),
      lng: parseNumber(cell(row, "lng")),
      rowNumber,
    });
  }

  return { orders, headerMap, skipped, sheetTab: tab };
}

/**
 * Crea en la hoja las columnas que la app gestiona (Estado, Hora Entrega,
 * _lat, _lng…) si el usuario no las tiene. Así el Sheet original de la
 * oficina no necesita preparación previa.
 *
 * Devuelve el headerMap actualizado.
 */
export async function ensureManagedColumns(
  headerMap: Partial<Record<ColumnKey, number>>,
  sheetTab?: string | null,
): Promise<Partial<Record<ColumnKey, number>>> {
  const tab = sheetTab ?? env.google.sheetTab;
  const missing = MANAGED_COLUMNS.filter((key) => headerMap[key] === undefined);
  if (missing.length === 0) return headerMap;

  // Se añaden a continuación de la última columna existente.
  const usedIndexes = Object.values(headerMap).filter(
    (v): v is number => v !== undefined,
  );
  let nextIndex = usedIndexes.length > 0 ? Math.max(...usedIndexes) + 1 : 0;

  const updated = { ...headerMap };
  const newHeaders: string[] = [];
  const startIndex = nextIndex;

  for (const key of missing) {
    newHeaders.push(canonicalHeader(key));
    updated[key] = nextIndex;
    nextIndex++;
  }

  const startCell = `${columnLetter(startIndex)}1`;
  const endCell = `${columnLetter(nextIndex - 1)}1`;

  await sheetsFetch(
    `/values/${encodeURIComponent(range(`${startCell}:${endCell}`, tab))}` +
      `?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: [newHeaders] }) },
  );

  return updated;
}

/** Una celda concreta a escribir. */
interface CellUpdate {
  rowNumber: number;
  column: ColumnKey;
  value: string | number;
}

async function writeCells(
  updates: CellUpdate[],
  headerMap: Partial<Record<ColumnKey, number>>,
  sheetTab?: string | null,
): Promise<void> {
  const tab = sheetTab ?? env.google.sheetTab;
  const data = updates
    .map((update) => {
      const columnIndex = headerMap[update.column];
      if (columnIndex === undefined) return null;
      const a1 = `${columnLetter(columnIndex)}${update.rowNumber}`;
      return { range: range(a1, tab), values: [[update.value]] };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (data.length === 0) return;

  await sheetsFetch(`/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
  });
}

export interface WriteResult {
  /** IDs de pedido escritos correctamente. */
  applied: string[];
  /** IDs que no se encontraron en la hoja (borrados por la oficina, típicamente). */
  notFound: string[];
}

/**
 * Escribe las entregas en el Sheet.
 *
 * Relee la hoja justo antes de escribir para localizar la fila actual de
 * cada pedido por su ID. Es imprescindible: la oficina puede haber insertado
 * o borrado filas desde que el transportista descargó su ruta esta mañana,
 * y escribir por número de fila cacheado machacaría el pedido equivocado.
 */
export async function writeDeliveries(
  records: DeliveryRecord[],
  sheetTab?: string | null,
): Promise<WriteResult> {
  if (records.length === 0) return { applied: [], notFound: [] };

  const snapshot = await readSheet(sheetTab);
  const headerMap = await ensureManagedColumns(snapshot.headerMap, sheetTab);
  const byId = new Map(snapshot.orders.map((order) => [order.id, order]));

  const updates: CellUpdate[] = [];
  const applied: string[] = [];
  const notFound: string[] = [];

  for (const record of records) {
    const order = byId.get(record.orderId);
    if (!order) {
      notFound.push(record.orderId);
      continue;
    }

    const type = record.type || "status";

    if (type === "status") {
      updates.push({
        rowNumber: order.rowNumber,
        column: "status",
        value: record.status === "entregado" ? "Entregat" : "Incidència",
      });
      updates.push({
        rowNumber: order.rowNumber,
        column: "deliveredAt",
        value: formatSheetTimestamp(record.recordedAt, env.timezone),
      });
      if (record.note) {
        updates.push({
          rowNumber: order.rowNumber,
          column: "incidentNote",
          value: record.note,
        });
      }
    } else if (type === "date") {
      updates.push({
        rowNumber: order.rowNumber,
        column: "date",
        value: record.date ? record.date : "",
      });
    }

    applied.push(record.orderId);
  }

  await writeCells(updates, headerMap, sheetTab);
  return { applied, notFound };
}

/**
 * Persiste en el Sheet las coordenadas recién geocodificadas, para no volver
 * a pagar geocoding por la misma dirección nunca más.
 */
export async function cacheCoordinates(
  coords: { orderId: string; lat: number; lng: number }[],
  snapshot: SheetSnapshot,
): Promise<void> {
  if (coords.length === 0) return;

  const headerMap = await ensureManagedColumns(snapshot.headerMap, snapshot.sheetTab);
  const byId = new Map(snapshot.orders.map((order) => [order.id, order]));

  const updates: CellUpdate[] = [];
  for (const coord of coords) {
    const order = byId.get(coord.orderId);
    if (!order) continue;
    updates.push({ rowNumber: order.rowNumber, column: "lat", value: coord.lat });
    updates.push({ rowNumber: order.rowNumber, column: "lng", value: coord.lng });
  }

  await writeCells(updates, headerMap, snapshot.sheetTab);
}
