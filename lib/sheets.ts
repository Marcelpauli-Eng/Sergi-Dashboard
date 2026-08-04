import "server-only";
import { googleAccessToken } from "./google-auth";
import { env } from "./env";
import { parseSheetDate, formatSheetTimestamp } from "./dates";
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
function range(a1: string): string {
  return `${env.google.sheetTab.replace(/'/g, "''")}!${a1}`;
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

function parseStatus(raw: unknown): DeliveryStatus {
  const text = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (text === "") return "pendiente";
  if (["entregado", "entregada", "si", "sí", "ok", "x", "true", "1"].includes(text)) {
    return "entregado";
  }
  if (["incidencia", "ausente", "rechazado", "no entregado", "ko"].includes(text)) {
    return "incidencia";
  }
  return "pendiente";
}

function parseNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  return Number.isFinite(value) ? value : null;
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
}

/**
 * Lee la hoja entera y la normaliza.
 *
 * Se piden los valores sin formatear y las fechas como número de serie:
 * así el parseo no depende del locale con el que esté configurada la hoja.
 */
export async function readSheet(): Promise<SheetSnapshot> {
  const data = (await sheetsFetch(
    `/values/${encodeURIComponent(range("A1:ZZ"))}` +
      `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
  )) as { values?: unknown[][] };

  const rows = data.values ?? [];
  if (rows.length === 0) {
    throw new Error(
      `La pestaña "${env.google.sheetTab}" está vacía. Comprueba GOOGLE_SHEET_TAB.`,
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

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNumber = i + 1; // Sheets numera desde 1 y la fila 1 es la cabecera.

    const id = text(cell(row, "id"));
    const address = text(cell(row, "address"));
    const driverId = text(cell(row, "driverId")).toLowerCase();
    const date = parseSheetDate(cell(row, "date"));

    // Filas completamente vacías: se ignoran sin ruido.
    if (!id && !address && !driverId) continue;

    if (!id) {
      skipped.push({ rowNumber, reason: "sin ID de pedido" });
      continue;
    }
    if (seenIds.has(id)) {
      skipped.push({ rowNumber, reason: `ID duplicado "${id}"` });
      continue;
    }
    if (!date) {
      skipped.push({ rowNumber, reason: "fecha ilegible" });
      continue;
    }
    if (!address) {
      skipped.push({ rowNumber, reason: "sin dirección" });
      continue;
    }

    seenIds.add(id);
    orders.push({
      id,
      driverId,
      date,
      priority: parseNumber(cell(row, "priority")) ?? Number.MAX_SAFE_INTEGER,
      customer: text(cell(row, "customer")),
      address,
      phone: text(cell(row, "phone")) || null,
      notes: text(cell(row, "notes")) || null,
      status: parseStatus(cell(row, "status")),
      lat: parseNumber(cell(row, "lat")),
      lng: parseNumber(cell(row, "lng")),
      rowNumber,
    });
  }

  return { orders, headerMap, skipped };
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
): Promise<Partial<Record<ColumnKey, number>>> {
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
    `/values/${encodeURIComponent(range(`${startCell}:${endCell}`))}` +
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
): Promise<void> {
  const data = updates
    .map((update) => {
      const columnIndex = headerMap[update.column];
      if (columnIndex === undefined) return null;
      const a1 = `${columnLetter(columnIndex)}${update.rowNumber}`;
      return { range: range(a1), values: [[update.value]] };
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
): Promise<WriteResult> {
  if (records.length === 0) return { applied: [], notFound: [] };

  const snapshot = await readSheet();
  const headerMap = await ensureManagedColumns(snapshot.headerMap);
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

    updates.push({
      rowNumber: order.rowNumber,
      column: "status",
      value: record.status === "entregado" ? "Entregado" : "Incidencia",
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

    applied.push(record.orderId);
  }

  await writeCells(updates, headerMap);
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

  const headerMap = await ensureManagedColumns(snapshot.headerMap);
  const byId = new Map(snapshot.orders.map((order) => [order.id, order]));

  const updates: CellUpdate[] = [];
  for (const coord of coords) {
    const order = byId.get(coord.orderId);
    if (!order) continue;
    updates.push({ rowNumber: order.rowNumber, column: "lat", value: coord.lat });
    updates.push({ rowNumber: order.rowNumber, column: "lng", value: coord.lng });
  }

  await writeCells(updates, headerMap);
}
