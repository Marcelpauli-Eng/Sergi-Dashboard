import "server-only";
import { googleAccessToken } from "./google-auth";
import { env, ErrorAccionable } from "./env";
import { parseSheetDate, parseSheetTime, formatSheetTimestamp, today } from "./dates";
import { findMonthTab, findLatestTabUpTo, noTabFoundMessage } from "./sheet-tab";
import { parseImportesFactura } from "./factura.ts";
import {
  CABECERA_CLIENTS,
  TAB_CLIENTS,
  clientAFila,
  parseClients,
} from "./clients.ts";
import type { ClienteFacturacion } from "./factura.ts";
import {
  CABECERA_EMISSOR,
  TAB_EMISSOR,
  emissorAFila,
  filaAEmissor,
  type Emissor,
} from "./emissor.ts";
import {
  CABECERA_IMPORTS,
  TAB_IMPORTS,
  parseImportes,
  planImportes,
  type ImporteEntrada,
} from "./importes.ts";
import {
  columnLetter,
  filaNovaComanda,
  fusionarBulto,
  parseGeoLevel,
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
  /** Dónde está cada comanda dentro de `orders`, para juntarle sus bultos. */
  const porId = new Map<string, number>();

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

    // Construir dirección completa con la ciudad si existe
    const city = text(cell(row, "city")) || null;

    const fila: Order = {
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
      // La celda del día trae también la hora cuando la comanda se entregó:
      // es la misma columna. Aquí solo se separa lo que ya hay escrito.
      deliveredTime: hasDate ? parseSheetTime(cell(row, "date")) : null,
      incidentNote: text(cell(row, "incidentNote")) || null,
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
      placeId: text(cell(row, "placeId")) || null,
      geoLevel: parseGeoLevel(cell(row, "geoLevel")),
      bultos: 1,
      rowNumber,
      rowNumbers: [rowNumber],
    };

    const yaEsta = porId.get(id);
    if (yaEsta !== undefined) {
      /*
        Otra fila con el mismo nº de comanda. Si no trae dirección es un
        bulto más de la misma entrega —así escribe la oficina las comandas
        de varios paquetes— y se fusiona. Ver `fusionarBulto`.

        Si SÍ trae dirección son dos entregas distintas compartiendo número,
        que es un error de la hoja y no hay forma de adivinar cuál vale: en
        la hoja real pasa con las comandas escritas a mano, como "RODES".
        Esa se descarta, pero diciendo dónde está la otra, que es lo que
        hace falta para arreglarlo.
      */
      if (address) {
        skipped.push({
          rowNumber,
          reason: `nº de comanda "${id}" repetido con otra dirección (ya está en la fila ${orders[yaEsta].rowNumber})`,
        });
        continue;
      }
      orders[yaEsta] = fusionarBulto(orders[yaEsta], fila);
      continue;
    }

    /*
      Sin dirección también entra.

      Antes se descartaba —"no se puede ir a ningún sitio"— y eso se comía
      justo las comandas que se crean desde la app: allí el único campo
      obligatorio es el número, así que una comanda apuntada al vuelo se
      escribía en la hoja y no volvía nunca a la pantalla. Aparecía en el
      Google Sheet y no en la bossa, que es lo peor de los dos mundos.

      Una comanda sin dirección es trabajo pendiente igual: se le pone día,
      se le pone importe y se factura. Lo único que no se puede es navegar
      hasta ella, y de eso ya se encarga la tarjeta, que esconde el botón.

      La fila vacía del todo sigue fuera, y los bultos —misma comanda sin
      dirección— los ha cogido la rama de arriba antes de llegar aquí.
    */

    porId.set(id, orders.length);
    orders.push(fila);
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

/** Cuál de los dos documentos. Solo para etiquetar comprobaciones. */
export type SheetDoc = "repartos" | "privado";

/**
 * ¿Se puede ESCRIBIR en ese documento?
 *
 * Leer y escribir son permisos distintos, y compartir como Lector en vez de
 * como Editor es el descuido más fácil de cometer: todo parece bien hasta
 * que marcas la primera entrega. Escribe una celda con su propio valor, así
 * que no cambia nada.
 */
export async function puedeEscribir(
  spreadsheetId: string,
): Promise<{ ok: true } | { ok: false; detalle: string }> {
  try {
    const leido = (await sheetsFetch(
      `/values/${encodeURIComponent("A1")}`,
      undefined,
      spreadsheetId,
    )) as { values?: unknown[][] };

    await sheetsFetch(
      `/values/${encodeURIComponent("A1")}?valueInputOption=USER_ENTERED`,
      { method: "PUT", body: JSON.stringify({ values: leido.values ?? [[""]] }) },
      spreadsheetId,
    );
    return { ok: true };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    return { ok: false, detalle: mensaje.slice(0, 300) };
  }
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

    /*
      Lo mismo en TODAS las filas de la comanda, no solo en la primera.

      Una comanda de cuatro bultos son cuatro filas en la hoja. Marcando solo
      la primera, la oficina ve una comanda a medias —dos "Pendent" y una
      "Entregat"—, que es exactamente lo que hay hoy en la hoja real y no hay
      forma de saber desde fuera si está entregada o no. Ver `rowNumbers`.
    */
    const enTodasLasFilas = (column: ColumnKey, value: string | number) => {
      for (const rowNumber of order.rowNumbers) {
        updates.push({ rowNumber, column, value });
      }
    };

    if (type === "status" && record.status === "pendiente") {
      /*
        Deshacer.

        Es el ÚNICO sitio donde se vacían celdas, y por eso aquí un importe
        nulo sí significa "bórralo" en vez del "no lo toques" que significa
        en el resto de la función: deshacer tiene que dejar la fila como
        estaba antes de marcarla, y el importe se escribió en ese mismo
        momento. El valor anterior, si lo había, viaja en `record.price`.
      */
      enTodasLasFilas("status", "");
      enTodasLasFilas("deliveredAt", "");
      enTodasLasFilas("incidentNote", "");
      importes.push({
        orderId: record.orderId,
        price: record.price ?? null,
        sheetTab: snapshot.sheetTab,
      });
    } else if (type === "status") {
      enTodasLasFilas("status", record.status === "entregado" ? "Entregat" : "Incidència");
      enTodasLasFilas(
        "deliveredAt",
        formatSheetTimestamp(record.recordedAt, env.timezone),
      );
      if (record.note) enTodasLasFilas("incidentNote", record.note);
      if (record.price !== null && record.price !== undefined) {
        importes.push({
          orderId: record.orderId,
          price: record.price,
          sheetTab: snapshot.sheetTab,
        });
      }
    } else if (type === "date") {
      enTodasLasFilas("date", record.date ? record.date : "");
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

/** Lo que hace falta para crear una comanda a mano. Solo el número lo es. */
export interface NovaComanda {
  id: string;
  /** Código del transportista, para las hojas que tengan esa columna. */
  driverId?: string;
  customer?: string;
  address?: string;
  city?: string;
  phone?: string;
  measures?: string;
  notes?: string;
}

/**
 * Añade una comanda al full, al final.
 *
 * La oficina apunta las comandas en su hoja, pero no siempre: un porte que
 * sale al momento, una recogida que se pacta por teléfono. Eso se anotaba en
 * un papel y se perdía, o había que abrir el Google Sheet en el móvil con
 * los dedos en una cuadrícula de veinte columnas.
 *
 * Solo el número es obligatorio, porque es la clave de todo —los importes,
 * la factura y la propia fila se buscan por él— y lo demás se puede
 * completar después desde la ficha. La fecha de creación la pone el
 * servidor: es el día de hoy y nadie tiene que teclearla.
 *
 * Se escribe en la columna que le toque a cada dato según la cabecera de esa
 * pestaña, no en un orden fijo: cada hoja tiene las suyas y en otro orden.
 */
export async function crearComanda(
  dades: NovaComanda,
  sheetTab?: string | null,
  /** La dirección elegida del buscador, si se eligió: se guarda ya resuelta. */
  lloc?: LlocGuardat | null,
): Promise<{ sheetTab: string }> {
  const snapshot = await readSheet(sheetTab);

  /*
    Dos filas con el mismo número rompen cosas que no se ven hasta mucho
    después: el importe se guarda contra el número, así que se pisarían el
    precio, y en la hoja la segunda se descarta al leer.
  */
  if (snapshot.orders.some((order) => order.id === dades.id)) {
    throw new ErrorAccionable(
      `Ja hi ha una comanda amb el número "${dades.id}" al full ${snapshot.sheetTab}.`,
    );
  }

  const valores = filaNovaComanda(
    {
      id: dades.id,
      customer: dades.customer ?? "",
      address: dades.address ?? "",
      city: dades.city ?? "",
      phone: dades.phone ?? "",
      measures: dades.measures ?? "",
      notes: dades.notes ?? "",
      // El día de hoy, como lo escribe la oficina: dd/mm/aaaa.
      creationDate: today(env.timezone).split("-").reverse().join("/"),
      /*
        El transportista, solo si la hoja tiene esa columna.

        Hoy no la tiene y todas las comandas son suyas. El día que la tenga,
        una fila creada sin ella quedaría sin dueño y el filtro por
        transportista la escondería: creas la comanda y no aparece.
      */
      driverId: dades.driverId ?? "",
      /*
        La dirección elegida se guarda ya con su punto: la comanda nace con
        la ubicación exacta y no hay nada que buscar después. Sin elegir,
        estas celdas van vacías y se resuelven al calcular la ruta.
      */
      ...(lloc
        ? {
            lat: String(lloc.lat),
            lng: String(lloc.lng),
            placeId: lloc.placeId,
            geoLevel: "portal",
          }
        : {}),
    },
    // Las columnas del punto puede que no existan todavía en la hoja: se
    // crean antes de escribir, o el valor no tendría dónde ir.
    lloc
      ? await ensureManagedColumns(snapshot.headerMap, snapshot.sheetTab)
      : snapshot.headerMap,
  );

  await sheetsFetch(
    `/values/${encodeURIComponent(range("A:ZZ", snapshot.sheetTab))}:append` +
      `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [valores] }) },
  );

  return { sheetTab: snapshot.sheetTab ?? "" };
}

/** Una dirección ya elegida en el buscador, tal y como se guarda. */
export interface LlocGuardat {
  placeId: string;
  lat: number;
  lng: number;
}

/** Los datos de una comanda que se pueden corregir desde la app. */
export type DadesComanda = Partial<
  Record<"customer" | "address" | "city" | "phone" | "measures" | "notes", string>
>;

/**
 * Corrige los datos de una comanda en la hoja.
 *
 * Hace falta desde que se pueden crear comandas con solo el número: la
 * dirección se sabe cinco minutos después, por teléfono, y hasta ahora eso
 * era abrir el Google Sheet en el móvil. También sirve para lo de siempre
 * —un teléfono mal apuntado, un portal cambiado— que antes solo se podía
 * arreglar en la hoja.
 *
 * Escribe en la fila de la comanda, que con varios bultos es la primera: es
 * la que lleva la dirección y el cliente, las demás solo las medidas.
 *
 * Necesita cobertura y no pasa por la cola. La cola es para lo que se marca
 * en la calle —entregado, incidencia, importe— y se sube tal cual llega.
 * Esto es corregir lo que hay escrito: si se encolara, dos correcciones del
 * mismo dato se pisarían sin que nadie viera cuál ha ganado.
 */
export async function actualitzarComanda(
  id: string,
  dades: DadesComanda,
  sheetTab?: string | null,
  /**
   * La dirección elegida del buscador de Google, si se eligió.
   *
   * Trae el portal con su identificador, así que se guarda como buena y ya
   * no hay que buscarla al calcular la ruta: es la única forma de que el
   * punto sea exacto seguro.
   */
  lloc?: LlocGuardat | null,
): Promise<boolean> {
  const snapshot = await readSheet(sheetTab);
  const order = snapshot.orders.find((o) => o.id === id);
  if (!order) return false;

  const updates: CellUpdate[] = [];
  for (const [columna, valor] of Object.entries(dades)) {
    if (valor === undefined) continue;
    updates.push({
      rowNumber: order.rowNumber,
      column: columna as ColumnKey,
      value: valor.trim(),
    });
  }

  /*
    Si cambia la dirección, el punto de antes ya no vale.

    Sin esto, corregir una dirección mal escrita dejaba las coordenadas
    viejas en su sitio —la app solo busca las filas que no tienen— y el
    botón de navegar seguía llevando al sitio equivocado, ahora además con
    la dirección buena escrita al lado.
  */
  const canviaAdreca =
    (dades.address !== undefined && dades.address.trim() !== order.address) ||
    (dades.city !== undefined && (dades.city.trim() || null) !== order.city);

  if (lloc) {
    updates.push({ rowNumber: order.rowNumber, column: "lat", value: lloc.lat });
    updates.push({ rowNumber: order.rowNumber, column: "lng", value: lloc.lng });
    updates.push({ rowNumber: order.rowNumber, column: "placeId", value: lloc.placeId });
    updates.push({ rowNumber: order.rowNumber, column: "geoLevel", value: "portal" });
  } else if (canviaAdreca) {
    for (const columna of ["lat", "lng", "placeId", "geoLevel"] as const) {
      updates.push({ rowNumber: order.rowNumber, column: columna, value: "" });
    }
  }

  const headerMap =
    lloc || canviaAdreca
      ? await ensureManagedColumns(snapshot.headerMap, snapshot.sheetTab)
      : snapshot.headerMap;

  await writeCells(updates, headerMap, snapshot.sheetTab);
  return true;
}

/**
 * Persiste en el Sheet las coordenadas recién geocodificadas, para no volver
 * a pagar geocoding por la misma dirección nunca más.
 */
export async function cacheCoordinates(
  coords: {
    orderId: string;
    lat: number;
    lng: number;
    placeId: string | null;
    geoLevel: "portal" | "negoci" | "carrer" | "poble";
  }[],
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
    /*
      El place_id se guarda siempre que lo haya, aunque sea una cadena vacía
      cuando no: así se distingue "esta dirección ya se resolvió y Google no
      da más de sí" de "esta fila es de antes de que se guardara el portal",
      que es la que hay que volver a geocodificar.
    */
    updates.push({
      rowNumber: order.rowNumber,
      column: "placeId",
      value: coord.placeId ?? "",
    });
    updates.push({
      rowNumber: order.rowNumber,
      column: "geoLevel",
      value: coord.geoLevel,
    });
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
    throw new ErrorAccionable(
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
    const codigo = mensaje.match(/respondió (403|404)/)?.[1];
    if (doc !== env.google.sheetId && codigo) {
      /*
        403 y 404 se arreglan de forma distinta y el mensaje de antes los
        metía en el mismo saco: quien lo leía comprobaba que el documento
        estaba compartido, veía que sí, y se quedaba sin saber qué mirar.

        Va también el final del ID, que es lo que se compara de un vistazo
        con la URL del documento que se tiene abierto. Entero no: acaba en
        logs y da acceso a quien tenga las credenciales.
      */
      const cola = doc.slice(-6);
      throw new ErrorAccionable(
        codigo === "404"
          ? `No existe ningún documento con ese GOOGLE_SHEET_ID_FACTURAS ` +
            `(acaba en "…${cola}"). Tiene que ser SOLO el trozo de la URL entre ` +
            `/d/ y /edit, sin "https://" y sin "/edit" detrás.`
          : `El documento de facturas existe pero la cuenta de servicio no ` +
            `puede entrar (acaba en "…${cola}"). Ábrelo → Compartir → y ponle ` +
            `permiso de Editor a ${env.google.serviceAccountEmail}. Si ya ` +
            `aparece ahí, comprueba que es ESE documento y no otro: el ID de ` +
            `.env.local tiene que acabar igual que el de la URL.`,
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
  // NO vale partir por comas: la coma también es el separador decimal de
  // cada importe. Ver `parseImportesFactura`.
  const importes = parseImportesFactura(text(fila[4]));

  return {
    numero,
    // Las emitidas antes del apóstrofo están guardadas como fecha de verdad
    // y vuelven como número de serie; `parseSheetDate` las devuelve a ISO.
    fecha: parseSheetDate(fila[1]) ?? text(fila[1]),
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

  /*
    El apóstrofo delante fuerza que Sheets lo guarde como TEXTO.

    `USER_ENTERED` interpreta lo que mandamos igual que si se tecleara en la
    casilla, así que "2026-09-11" se convertía en una fecha y "JUL 26" en el
    26 de julio. Al releerlas con UNFORMATTED_VALUE volvían como número de
    serie —46276, 46229— y la lista de facturas enseñaba
    "undefined/undefined/46276". El apóstrofo no forma parte del valor: ni se
    ve en la casilla ni vuelve al leerla.
  */
  const fila = [
    numero,
    `'${datos.fecha}`,
    `'${datos.periodo}`,
    datos.lineas.map((l) => l.comanda).join(", "),
    // Con ";" y no con ", ": el importe lleva coma decimal dentro y una
    // lista separada por comas no se puede volver a partir.
    datos.lineas.map((l) => importeSheet(l.importe)).join("; "),
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

/* ── A quién se le factura ──────────────────────────────────────────────── */

/**
 * Lee y escribe la pestaña de clientes del documento privado.
 *
 * Qué es cada columna lo decide `lib/clients.ts`; aquí solo está el viaje.
 */

/**
 * Crea una pestaña del documento privado con su cabecera, si hace falta.
 *
 * Que exista no basta: si alguien la crea a mano y se queda sin cabecera, la
 * primera fila de datos iría a la 1 y a partir de ahí todo lo que cuenta
 * desde la 2 apuntaría a la fila equivocada. Por eso la cabecera se escribe
 * también cuando la pestaña ya estaba pero está vacía.
 */
async function asegurarTab(tab: string, cabecera: string[]): Promise<void> {
  const doc = docFacturas();
  const tabs = await tabsFacturas(doc);
  const rangCabecera = range(`A1:${columnLetter(cabecera.length - 1)}1`, tab);

  if (tabs.includes(tab)) {
    const actual = (await sheetsFetch(
      `/values/${encodeURIComponent(rangCabecera)}`,
      undefined,
      doc,
    )) as { values?: unknown[][] };
    if ((actual.values?.[0] ?? []).some((c) => text(c) !== "")) return;
  } else {
    await sheetsFetch(
      ":batchUpdate",
      {
        method: "POST",
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: tab } } }],
        }),
      },
      doc,
    );
  }

  await sheetsFetch(
    `/values/${encodeURIComponent(rangCabecera)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values: [cabecera] }) },
    doc,
  );
}

/**
 * Los clientes a los que se factura.
 *
 * Una instalación recién puesta en marcha todavía no tiene la pestaña, y eso
 * no es un error: devuelve la lista vacía y quien llama decide con qué se
 * queda. Como en los importes, se pide el rango directamente y el 400 de
 * "esa pestaña no existe" se traduce a "no hay ninguno".
 */
export async function readClients(): Promise<ClienteFacturacion[]> {
  const data = (await sheetsFetch(
    `/values/${encodeURIComponent(range("A2:G", TAB_CLIENTS))}`,
    undefined,
    docFacturas(),
  ).catch((error: unknown) => {
    if (String(error).includes("respondió 400")) return { values: [] };
    throw error;
  })) as { values?: unknown[][] };

  return parseClients(data.values ?? []);
}

/**
 * Guarda la lista entera, tal cual queda.
 *
 * Se reescribe todo el bloque en vez de buscar qué ha cambiado: son cuatro
 * clientes que casi nunca se tocan, y un plan de diferencias como el de los
 * importes sería más código que el problema. Lo que sobra por debajo se
 * borra, que si no un cliente eliminado se quedaría ahí abajo para siempre.
 */
export async function writeClients(clients: ClienteFacturacion[]): Promise<void> {
  await asegurarTab(TAB_CLIENTS, CABECERA_CLIENTS);
  const doc = docFacturas();

  if (clients.length > 0) {
    await sheetsFetch(
      `/values/${encodeURIComponent(range(`A2:G${clients.length + 1}`, TAB_CLIENTS))}` +
        `?valueInputOption=USER_ENTERED`,
      { method: "PUT", body: JSON.stringify({ values: clients.map(clientAFila) }) },
      doc,
    );
  }

  await sheetsFetch(
    `/values/${encodeURIComponent(range(`A${clients.length + 2}:G`, TAB_CLIENTS))}:clear`,
    { method: "POST", body: "{}" },
    doc,
  );
}

/* ── Quién emite ────────────────────────────────────────────────────────── */

/**
 * El emisor guardado en el documento.
 *
 * `null` si la pestaña no existe todavía o está sin rellenar: eso no es un
 * error, es una instalación que aún no ha guardado el suyo, y quien llama se
 * queda con el que ya tenga.
 */
export async function readEmissor(): Promise<Emissor | null> {
  const data = (await sheetsFetch(
    `/values/${encodeURIComponent(range("A2:G2", TAB_EMISSOR))}`,
    undefined,
    docFacturas(),
  ).catch((error: unknown) => {
    if (String(error).includes("respondió 400")) return { values: [] };
    throw error;
  })) as { values?: unknown[][] };

  return filaAEmissor(data.values?.[0]);
}

/** Guarda el emisor. Una sola fila: no hay más que uno. */
export async function writeEmissor(emissor: Emissor): Promise<void> {
  await asegurarTab(TAB_EMISSOR, CABECERA_EMISSOR);

  await sheetsFetch(
    `/values/${encodeURIComponent(range("A2:G2", TAB_EMISSOR))}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values: [emissorAFila(emissor)] }) },
    docFacturas(),
  );
}

/* ── Los importes de cada comanda ───────────────────────────────────────── */

/**
 * Lee y escribe la pestaña privada de importes.
 *
 * Aquí solo está el transporte: qué fila se actualiza y cuál se añade lo
 * decide `lib/importes.ts`, que no depende de la red y se puede comprobar.
 */

/*
  La pestaña de importes es UNA para todos los fulls, así que el mapa vale
  igual para cualquiera. Sin esta caché, la comparativa de Informes —que lee
  doce fulls seguidos— pedía doce veces la misma pestaña y agotaba la cuota
  de lecturas por minuto de Sheets (60 por usuario), que no tira abajo solo
  los importes: se lleva por delante la sincronización entera.

  Medio minuto es más que suficiente para cubrir esa ráfaga, y un precio
  recién tecleado se ve igual porque la pantalla lo pinta desde la cola local
  antes de que el servidor conteste. Al escribir se tira la caché igualmente.

  ponytail: caché en memoria del proceso; en Vercel cada instancia tiene la
  suya. Si algún día hace falta compartirla, un KV.
*/
const CACHE_IMPORTES_MS = 30_000;
let cacheImportes: { guardado: number; datos: Map<string, number> } | null = null;

/**
 * El importe de cada comanda, por número de comanda.
 *
 * Si la pestaña no existe todavía devuelve un mapa vacío en vez de fallar:
 * una instalación recién puesta en marcha no tiene ningún importe puesto, y
 * eso no es un error.
 */
export async function readImportes(): Promise<Map<string, number>> {
  if (cacheImportes && Date.now() - cacheImportes.guardado < CACHE_IMPORTES_MS) {
    return cacheImportes.datos;
  }

  /*
    Se pide el rango directamente en vez de preguntar antes qué pestañas hay.
    Eran dos llamadas por manifiesto y la cuota de Sheets se cuenta por
    llamadas, no por datos. Si la pestaña no existe todavía Google contesta
    400, y aquí eso significa "no hay ningún importe puesto", que no es un
    error: una instalación recién estrenada está justo así.
  */
  const data = (await sheetsFetch(
    `/values/${encodeURIComponent(range("A2:B", TAB_IMPORTS))}` +
      `?valueRenderOption=UNFORMATTED_VALUE`,
    undefined,
    docFacturas(),
  ).catch((error: unknown) => {
    if (String(error).includes("respondió 400")) return { values: [] };
    throw error;
  })) as { values?: unknown[][] };

  const datos = parseImportes(data.values ?? []);
  cacheImportes = { guardado: Date.now(), datos };
  return datos;
}

/**
 * Guarda los importes en el documento privado.
 *
 * Se relee la columna de comandas justo antes de escribir por lo mismo que
 * en la hoja de repartos: puede haber crecido desde la última vez.
 */
export async function writeImportes(entradas: ImporteEntrada[]): Promise<void> {
  if (entradas.length === 0) return;
  await asegurarTab(TAB_IMPORTS, CABECERA_IMPORTS);

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
          // RAW y no USER_ENTERED: sin esto Google interpreta el nombre del
          // full —"JUL 26"— como una fecha y se pierde.
          valueInputOption: "RAW",
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
        `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: "POST", body: JSON.stringify({ values: plan.nuevas }) },
      doc,
    );
  }

  cacheImportes = null;
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

/**
 * El identificador interno de una pestaña, que no es su nombre.
 *
 * Hace falta para borrar una fila: la API de valores sabe escribir y vaciar
 * celdas, pero quitar la fila entera es una operación de estructura y esas
 * van por `:batchUpdate`, que pide el `sheetId` —el número que sale en la
 * URL como `#gid=`— y no el título.
 */
async function idPestanya(doc: string, titulo: string): Promise<number | null> {
  const data = (await sheetsFetch(
    "?fields=sheets.properties(sheetId,title)",
    undefined,
    doc,
  )) as { sheets?: { properties?: { sheetId?: number; title?: string } }[] };

  const pestanya = (data.sheets ?? []).find((s) => s.properties?.title === titulo);
  return pestanya?.properties?.sheetId ?? null;
}

/**
 * Borra una factura emitida. `false` si ese número ya no está en la hoja.
 *
 * Se quita la FILA entera en vez de vaciarla: una fila en blanco en medio de
 * la serie se lee igual que una factura rota, y `actualizarEstadoFactura`
 * cuenta filas para saber dónde escribir.
 *
 * Borrar la última deja su número libre —`emitirFactura` coge el mayor más
 * uno—, que es justo lo que se quiere al haberse equivocado y querer
 * rehacerla. Borrar una de en medio deja un hueco en la serie y eso ya no lo
 * arregla la app: lo avisa antes de hacerlo (ver `components/factures.tsx`),
 * pero la decisión es de quien factura.
 */
export async function esborrarFactura(numero: number): Promise<boolean> {
  const doc = docFacturas();
  const tabs = await tabsFacturas(doc);
  if (!tabs.includes(TAB_FACTURAS)) return false;

  const gid = await idPestanya(doc, TAB_FACTURAS);
  if (gid === null) return false;

  const data = (await sheetsFetch(
    `/values/${encodeURIComponent(range("A2:A", TAB_FACTURAS))}` +
      `?valueRenderOption=UNFORMATTED_VALUE`,
    undefined,
    doc,
  )) as { values?: unknown[][] };

  const indice = (data.values ?? []).findIndex((fila) => parseNumber(fila[0]) === numero);
  if (indice === -1) return false;

  // La API cuenta las filas desde 0 y sin cabecera: la fila 2 de la hoja es
  // el índice 1. Se relee justo antes de borrar, como en todo lo demás,
  // porque alguien puede haber tocado la hoja a mano mientras tanto.
  const inicio = indice + 1;
  await sheetsFetch(
    ":batchUpdate",
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: gid,
                dimension: "ROWS",
                startIndex: inicio,
                endIndex: inicio + 1,
              },
            },
          },
        ],
      }),
    },
    doc,
  );

  return true;
}
