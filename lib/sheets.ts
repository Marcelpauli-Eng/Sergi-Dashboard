import "server-only";
import { googleAccessToken } from "./google-auth";
import { env } from "./env";
import { parseSheetDate, formatSheetTimestamp, today } from "./dates";
import { findMonthTab, findLatestTabUpTo, noTabFoundMessage } from "./sheet-tab";
import {
  CABECERA_IMPORTS,
  TAB_IMPORTS,
  parseImportes,
  planImportes,
  type ImporteEntrada,
} from "./importes.ts";
import {
  columnLetter,
  parseNumber,
  parsePriority,
  parseStatus,
  parseStatusCategory,
  text,
} from "./sheet-cells.ts";
import {
  mapHeaders,
  canonicalHeader,
  REQUIRED_COLUMNS,
  MANAGED_COLUMNS,
  MissingColumnsError,
  type ColumnKey,
} from "./sheet-schema";
import type {
  DeliveryRecord,
  EstatFactura,
  FacturaEmitida,
  Order,
} from "./types";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

/** Rango A1 con el nombre de pestaña escapado (puede llevar espacios). */
function range(a1: string, sheetTab?: string | null): string {
  const tab = sheetTab ?? env.google.sheetTab;
  if (!tab) return a1;
  // Las comillas simples en el nombre de pestaña se escapan duplicándolas.
  // Envolvemos siempre en comillas simples para que funcionen tabs con espacios.
  return `'${tab.replace(/'/g, "''")}'!${a1}`;
}

/**
 * Una llamada a la API de Sheets.
 *
 * `spreadsheetId` existe porque las facturas viven en OTRO documento que los
 * repartos: el de repartos lo comparte la empresa y lo que factura el
 * transportista no es asunto suyo. Ver `env.google.facturasSheetId`.
 */
async function sheetsFetch(
  path: string,
  init?: RequestInit,
  spreadsheetId: string = env.google.sheetId,
): Promise<unknown> {
  const token = await googleAccessToken();
  const response = await fetch(`${API}/${spreadsheetId}${path}`, {
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
export async function listSheetTabs(spreadsheetId?: string): Promise<string[]> {
  const data = (await sheetsFetch(
    `?fields=sheets.properties.title`,
    undefined,
    spreadsheetId,
  )) as {
    sheets?: { properties?: { title?: string } }[];
  };

  return (data.sheets ?? [])
    .map((s) => s.properties?.title ?? "")
    .filter((title) => title.length > 0);
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
 * Qué pestaña leer cuando nadie ha dicho una en concreto.
 *
 * La hoja de la oficina tiene una pestaña por mes, así que "la de siempre"
 * es la de hoy. Se pregunta a Google qué pestañas hay y se busca la del mes
 * en curso; si aún no existe —a principios de mes, o si nadie la ha creado
 * todavía— se tira de la última anterior, que es donde están los pedidos que
 * quedan por entregar.
 *
 * `GOOGLE_SHEET_TAB` sigue mandando por encima de todo: es la vía de escape
 * para apuntar a una pestaña concreta. Si no está puesta, esto se encarga.
 */
async function resolverPestanya(): Promise<string> {
  if (env.google.sheetTab) return env.google.sheetTab;

  const tabs = await listSheetTabs();
  const mes = today(env.timezone).slice(0, 7);

  const delMes = findMonthTab(tabs, mes);
  if (delMes) return delMes;

  const anterior = findLatestTabUpTo(tabs, mes);
  if (anterior) return anterior;

  throw new Error(noTabFoundMessage(tabs, mes));
}

/**
 * Lee la hoja entera y la normaliza.
 *
 * Se piden los valores sin formatear y las fechas como número de serie:
 * así el parseo no depende del locale con el que esté configurada la hoja.
 *
 * @param sheetTab - Nombre de la pestaña a leer. Si no se pasa, se elige la
 *                   del mes en curso (ver `resolverPestanya`).
 */
export async function readSheet(sheetTab?: string | null): Promise<SheetSnapshot> {
  const tab = sheetTab ?? (await resolverPestanya());

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
    const rawCreation = cell(row, "creationDate");
    const parsedCreation = parseSheetDate(rawCreation);
    const creationDate = parsedCreation ?? (text(rawCreation) || null);
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
    // Las órdenes sin fecha de reparto son totalmente válidas (se quedan en la bolsa de pendientes).
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
      creationDate,
      date: date ?? "",
      priority: parsePriority(cell(row, "priority")),
      customer: text(cell(row, "customer")),
      address,
      city,
      billingClient: text(cell(row, "billingClient")) || null,
      phone: text(cell(row, "phone")) || null,
      measures: text(cell(row, "measures")) || null,
      notes: text(cell(row, "notes")) || null,
      status: parseStatus(cell(row, "status")),
      rawStatus: text(cell(row, "status")),
      statusCategory: parseStatusCategory(cell(row, "status")),
      /*
        El importe NO se lee de aquí.

        La columna "Import" de la hoja de repartos ya no es de la app: los
        precios viven en el documento privado. Y leerla "por si acaso" no es
        gratis — la oficina escribe en esa hoja lo que quiere. En la hoja
        real había dos celdas con formato de fecha y un "18/08/2026 13:41"
        dentro, que Google devuelve como el número 46252,57: la app las leía
        como 46.252,57 € y se habrían ido a una factura tal cual.

        Los importes que quedaran escritos aquí se mudan con
        `npm run migrar:imports`, que sí mira el formato de la celda y avisa
        de las que no son un importe en vez de tragárselas.
      */
      price: null,
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

  // Dos campos del modelo pueden compartir cabecera —`date` y `deliveredAt`
  // apuntan los dos a "Data entrega"—, así que se crea una sola columna y
  // ambos la comparten. Sin esto saldrían dos columnas con el mismo nombre.
  const createdAt = new Map<string, number>();
  for (const key of missing) {
    const header = canonicalHeader(key);
    const yaCreada = createdAt.get(header);
    if (yaCreada !== undefined) {
      updated[key] = yaCreada;
      continue;
    }
    newHeaders.push(header);
    createdAt.set(header, nextIndex);
    updated[key] = nextIndex;
    nextIndex++;
  }

  if (newHeaders.length === 0) return updated;

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
  /* Los importes no van a la hoja de repartos: la comparte la empresa. Se
     juntan aquí y se escriben en el documento privado, junto a las facturas. */
  const importes: ImporteEntrada[] = [];
  const applied: string[] = [];
  const notFound: string[] = [];

  for (const record of records) {
    const order = byId.get(record.orderId);
    if (!order) {
      notFound.push(record.orderId);
      continue;
    }

    const type = record.type || "status";

    if (type === "status" && record.status === "pendiente") {
      /*
        Deshacer.

        Es el ÚNICO sitio donde se vacían celdas, y por eso aquí un importe
        nulo sí significa "bórralo" en vez del "no lo toques" que significa
        en el resto de la función: deshacer tiene que dejar la fila como
        estaba antes de marcarla, y el importe se escribió en ese mismo
        momento. El valor anterior, si lo había, viaja en `record.price`.
      */
      updates.push({ rowNumber: order.rowNumber, column: "status", value: "" });
      updates.push({ rowNumber: order.rowNumber, column: "deliveredAt", value: "" });
      updates.push({ rowNumber: order.rowNumber, column: "incidentNote", value: "" });
      importes.push({
        orderId: record.orderId,
        price: record.price ?? null,
        sheetTab: snapshot.sheetTab,
      });
    } else if (type === "status") {
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
      if (record.price !== null && record.price !== undefined) {
        importes.push({
          orderId: record.orderId,
          price: record.price,
          sheetTab: snapshot.sheetTab,
        });
      }
    } else if (type === "date") {
      updates.push({
        rowNumber: order.rowNumber,
        column: "date",
        value: record.date ? record.date : "",
      });
    } else if (type === "price") {
      // Solo el importe. Ni estado ni hora de entrega: corregir un precio no
      // puede cambiar cuándo se entregó. Aquí un nulo sí borra, porque es lo
      // que se ha pedido explícitamente.
      importes.push({
        orderId: record.orderId,
        price: record.price ?? null,
        sheetTab: snapshot.sheetTab,
      });
    }

    applied.push(record.orderId);
  }

  /*
    El estado va primero y el importe después, y en ese orden a propósito.

    Si guardar el importe falla —el documento privado sin configurar, o sin
    compartir— la entrega ya está escrita en la hoja y el error sube, así que
    la cola lo reintenta. Reintentar es seguro porque reescribe las mismas
    celdas con los mismos valores, incluida la hora, que viaja en el propio
    registro y no se recalcula.

    Al revés, un fallo al escribir el importe dejaría sin marcar una entrega
    ya hecha, que es el peor error posible en esta app.
  */
  await writeCells(updates, headerMap, sheetTab);
  await writeImportes(importes);
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

/* ── Registro de facturas emitidas ──────────────────────────────────────── */

/**
 * Las facturas emitidas viven en una pestaña con este nombre.
 *
 * En un Sheet y no en el móvil a propósito: es lo que permite que el número
 * correlativo no dependa del dispositivo y que un cambio de teléfono no se
 * lleve por delante la serie. En cuál, lo decide `docFacturas()`.
 */
export const TAB_FACTURAS = "Factures";

/**
 * Dónde vive el registro de facturas: un documento aparte, obligatorio.
 *
 * Google Sheets no sabe ocultar una pestaña a quien tiene acceso al
 * documento, así que separar el archivo es la única manera de que la empresa
 * no vea lo que factura el transportista. Sin la variable no se factura: el
 * apaño de caer en el documento de repartos convertía un olvido de
 * configuración en la fuga que esto viene a evitar.
 */
function docFacturas(): string {
  const doc = env.google.facturasSheetId;
  if (!doc) {
    throw new Error(
      "Falta la variable de entorno GOOGLE_SHEET_ID_FACTURAS. Las facturas " +
        "necesitan un documento aparte: el de repartos lo ve la empresa " +
        "entero. Crea uno, compártelo como Editor con la cuenta de servicio " +
        "y pon aquí su ID (el trozo de la URL entre /d/ y /edit).",
    );
  }
  return doc;
}

/**
 * Las pestañas del documento de facturas.
 *
 * Traduce el error más probable de toda la puesta en marcha: crear el
 * documento aparte y olvidarse de compartirlo con la cuenta de servicio.
 * Google contesta un 403 que no dice qué hacer.
 */
async function tabsFacturas(doc: string): Promise<string[]> {
  try {
    return await listSheetTabs(doc);
  } catch (error) {
    const mensaje = String(error);
    if (doc !== env.google.sheetId && /respondió (403|404)/.test(mensaje)) {
      throw new Error(
        `No se puede abrir el documento de facturas (GOOGLE_SHEET_ID_FACTURAS). ` +
          `Compártelo con ${env.google.serviceAccountEmail} dándole permiso de Editor, ` +
          `y comprueba que el ID es el trozo de la URL entre /d/ y /edit.`,
      );
    }
    throw error;
  }
}

const CABECERA_FACTURAS = [
  "Número",
  "Data",
  "Període",
  "Comandes",
  "Imports",
  "Base",
  "IVA",
  "IRPF",
  "Total",
  // Añadidas después: en las hojas que ya existían se rellenan al vuelo
  // (ver `asegurarTabFacturas`) y las filas antiguas se quedan vacías, que
  // es lo correcto — cuando se emitieron solo había un cliente y nadie
  // llevaba el cobro desde aquí.
  "Client",
  "Estat",
];

/** Última columna de la pestaña de facturas. Va con `CABECERA_FACTURAS`. */
const ULTIMA_COLUMNA_FACTURAS = "K";

/** Cómo se escribe cada estado de cobro en la hoja, para que se lea a ojo. */
const ESTAT_FACTURA_SHEET: Record<EstatFactura, string> = {
  emesa: "Emesa",
  enviada: "Enviada",
  cobrada: "Cobrada",
};

function parseEstatFactura(valor: unknown): EstatFactura {
  const texto = text(valor)
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (["cobrada", "cobrado", "pagada", "pagado"].includes(texto)) return "cobrada";
  if (["enviada", "enviado", "presentada"].includes(texto)) return "enviada";
  // Una celda vacía es una factura emitida y nada más: es el estado de
  // partida y el de todas las que se emitieron antes de que esto existiera.
  return "emesa";
}

/**
 * Crea la pestaña con su cabecera, o le completa las columnas que le falten.
 *
 * Lo segundo es por las hojas que ya existían cuando la factura solo tenía
 * nueve columnas: se les añaden "Client" y "Estat" sin tocar ni una fila de
 * las que ya hay. Reescribir la cabecera entera es seguro porque los nombres
 * de las columnas viejas no cambian, solo se añaden detrás.
 */
async function asegurarTabFacturas(): Promise<void> {
  const doc = docFacturas();
  const tabs = await tabsFacturas(doc);

  if (!tabs.includes(TAB_FACTURAS)) {
    await sheetsFetch(
      ":batchUpdate",
      {
        method: "POST",
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: TAB_FACTURAS } } }],
        }),
      },
      doc,
    );
  } else {
    const actual = (await sheetsFetch(
      `/values/${encodeURIComponent(range(`A1:${ULTIMA_COLUMNA_FACTURAS}1`, TAB_FACTURAS))}`,
      undefined,
      doc,
    )) as { values?: unknown[][] };
    const cabecera = (actual.values?.[0] ?? []).map((c) => text(c));
    // Ya está completa: no se toca nada.
    if (cabecera.length >= CABECERA_FACTURAS.length) return;
  }

  await sheetsFetch(
    `/values/${encodeURIComponent(range(`A1:${ULTIMA_COLUMNA_FACTURAS}1`, TAB_FACTURAS))}` +
      `?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values: [CABECERA_FACTURAS] }) },
    doc,
  );
}

/** Número con coma decimal, como el resto de importes de la hoja. */
function importeSheet(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
}

function filaAFactura(fila: unknown[]): FacturaEmitida | null {
  const numero = parseNumber(fila[0]);
  if (numero === null) return null;

  const comandas = text(fila[3]).split(",").map((c) => c.trim()).filter(Boolean);
  const importes = text(fila[4]).split(",").map((i) => parseNumber(i.trim()) ?? 0);

  return {
    numero,
    fecha: text(fila[1]),
    periodo: text(fila[2]),
    lineas: comandas.map((comanda, i) => ({ comanda, importe: importes[i] ?? 0 })),
    base: parseNumber(fila[5]) ?? 0,
    iva: parseNumber(fila[6]) ?? 0,
    irpf: parseNumber(fila[7]) ?? 0,
    total: parseNumber(fila[8]) ?? 0,
    // Las facturas de antes de que existieran estas columnas no las tienen:
    // sin cliente (solo había uno) y recién emitidas por defecto.
    client: text(fila[9]),
    estat: parseEstatFactura(fila[10]),
  };
}

/** Todas las facturas emitidas, de la más reciente a la más antigua. */
export async function readFacturas(): Promise<FacturaEmitida[]> {
  const doc = docFacturas();
  const tabs = await tabsFacturas(doc);
  if (!tabs.includes(TAB_FACTURAS)) return [];

  const data = (await sheetsFetch(
    `/values/${encodeURIComponent(range(`A2:${ULTIMA_COLUMNA_FACTURAS}`, TAB_FACTURAS))}` +
      `?valueRenderOption=UNFORMATTED_VALUE`,
    undefined,
    doc,
  )) as { values?: unknown[][] };

  return (data.values ?? [])
    .map(filaAFactura)
    .filter((f): f is FacturaEmitida => f !== null)
    .sort((a, b) => b.numero - a.numero);
}

/**
 * Emite una factura: le asigna el siguiente número de la serie y la registra.
 *
 * El número se calcula aquí, en el servidor, leyendo la hoja justo antes de
 * escribir. Hacerlo en el móvil daría números repetidos en cuanto haya dos
 * dispositivos o dos pestañas abiertas.
 *
 * ponytail: sin bloqueo. Dos emisiones simultáneas podrían coger el mismo
 * número. Con un transportista no pasa; si algún día son varios, hace falta
 * un candado de verdad (o mover la serie a una base de datos).
 */
export async function emitirFactura(datos: {
  fecha: string;
  periodo: string;
  lineas: { comanda: string; importe: number }[];
  base: number;
  iva: number;
  irpf: number;
  total: number;
  /** Código del cliente al que se emite. Vacío si solo hay uno. */
  client?: string;
  /** Número con el que arranca la serie si todavía no hay ninguna factura. */
  primerNumero: number;
}): Promise<FacturaEmitida> {
  await asegurarTabFacturas();

  const emitidas = await readFacturas();
  const numero =
    emitidas.length > 0
      ? Math.max(...emitidas.map((f) => f.numero)) + 1
      : datos.primerNumero;

  const fila = [
    numero,
    datos.fecha,
    datos.periodo,
    datos.lineas.map((l) => l.comanda).join(", "),
    datos.lineas.map((l) => importeSheet(l.importe)).join(", "),
    importeSheet(datos.base),
    importeSheet(datos.iva),
    importeSheet(datos.irpf),
    importeSheet(datos.total),
    datos.client ?? "",
    ESTAT_FACTURA_SHEET.emesa,
  ];

  await sheetsFetch(
    `/values/${encodeURIComponent(range(`A:${ULTIMA_COLUMNA_FACTURAS}`, TAB_FACTURAS))}:append` +
      `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [fila] }) },
    docFacturas(),
  );

  return { ...datos, client: datos.client ?? "", estat: "emesa", numero };
}

/* ── Los importes de cada comanda ───────────────────────────────────────── */

/**
 * Lee y escribe la pestaña privada de importes.
 *
 * Aquí solo está el transporte: qué fila se actualiza y cuál se añade lo
 * decide `lib/importes.ts`, que no depende de la red y se puede comprobar.
 */

/** Crea la pestaña de importes la primera vez que hace falta. */
async function asegurarTabImports(): Promise<void> {
  const doc = docFacturas();
  const tabs = await tabsFacturas(doc);
  if (tabs.includes(TAB_IMPORTS)) return;

  await sheetsFetch(
    ":batchUpdate",
    {
      method: "POST",
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: TAB_IMPORTS } } }],
      }),
    },
    doc,
  );

  await sheetsFetch(
    `/values/${encodeURIComponent(range("A1:D1", TAB_IMPORTS))}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values: [CABECERA_IMPORTS] }) },
    doc,
  );
}

/**
 * El importe de cada comanda, por número de comanda.
 *
 * Si la pestaña no existe todavía devuelve un mapa vacío en vez de fallar:
 * una instalación recién puesta en marcha no tiene ningún importe puesto, y
 * eso no es un error.
 */
export async function readImportes(): Promise<Map<string, number>> {
  const doc = docFacturas();
  const tabs = await tabsFacturas(doc);
  if (!tabs.includes(TAB_IMPORTS)) return new Map();

  const data = (await sheetsFetch(
    `/values/${encodeURIComponent(range("A2:B", TAB_IMPORTS))}` +
      `?valueRenderOption=UNFORMATTED_VALUE`,
    undefined,
    doc,
  )) as { values?: unknown[][] };

  return parseImportes(data.values ?? []);
}

/**
 * Guarda los importes en el documento privado.
 *
 * Se relee la columna de comandas justo antes de escribir por lo mismo que
 * en la hoja de repartos: puede haber crecido desde la última vez.
 */
export async function writeImportes(entradas: ImporteEntrada[]): Promise<void> {
  if (entradas.length === 0) return;
  await asegurarTabImports();

  const doc = docFacturas();
  const data = (await sheetsFetch(
    `/values/${encodeURIComponent(range("A2:A", TAB_IMPORTS))}`,
    undefined,
    doc,
  )) as { values?: unknown[][] };

  const plan = planImportes(
    entradas,
    (data.values ?? []).map((fila) => text(fila[0])),
    formatSheetTimestamp(new Date().toISOString(), env.timezone),
  );

  if (plan.actualizar.length > 0) {
    await sheetsFetch(
      `/values:batchUpdate`,
      {
        method: "POST",
        body: JSON.stringify({
          valueInputOption: "USER_ENTERED",
          data: plan.actualizar.map(({ fila, valores }) => ({
            range: range(`A${fila}:D${fila}`, TAB_IMPORTS),
            values: [valores],
          })),
        }),
      },
      doc,
    );
  }

  if (plan.nuevas.length > 0) {
    await sheetsFetch(
      `/values/${encodeURIComponent(range("A:D", TAB_IMPORTS))}:append` +
        `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: "POST", body: JSON.stringify({ values: plan.nuevas }) },
      doc,
    );
  }
}

/**
 * Mueve una factura por los estados del cobro: emesa → enviada → cobrada.
 *
 * Se escribe en la hoja y no en el móvil a propósito, igual que la propia
 * factura: así el estado del cobro sigue estando ahí desde cualquier
 * dispositivo, y se puede repasar el mes entero de un vistazo.
 *
 * Busca la fila por el número de factura releyendo la pestaña, no por una
 * posición cacheada: la serie no cambia de orden, pero alguien puede haber
 * insertado una fila a mano.
 */
export async function actualizarEstadoFactura(
  numero: number,
  estat: EstatFactura,
): Promise<FacturaEmitida | null> {
  await asegurarTabFacturas();

  const data = (await sheetsFetch(
    `/values/${encodeURIComponent(range("A2:A", TAB_FACTURAS))}` +
      `?valueRenderOption=UNFORMATTED_VALUE`,
    undefined,
    docFacturas(),
  )) as { values?: unknown[][] };

  const indice = (data.values ?? []).findIndex((fila) => parseNumber(fila[0]) === numero);
  if (indice === -1) return null;

  // +2: la fila 1 es la cabecera y el rango empieza en la 2.
  const fila = indice + 2;
  await sheetsFetch(
    `/values/${encodeURIComponent(range(`K${fila}`, TAB_FACTURAS))}` +
      `?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values: [[ESTAT_FACTURA_SHEET[estat]]] }) },
    docFacturas(),
  );

  const todas = await readFacturas();
  return todas.find((f) => f.numero === numero) ?? null;
}
