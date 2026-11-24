/**
 * Las comandas en su hoja: leerlas, marcar entregas, crearlas, corregirlas,
 * moverlas de full y borrarlas. A qué documento va cada una lo dice
 * `bosses.ts`.
 */
import "server-only";
import { ErrorAccionable, env } from "../env";
import { formatSheetTimestamp, today } from "../dates";
import { type ImporteEntrada } from "../importes.ts";
import { type AvisEntrada, CABECERA_AVISOS, TAB_AVISOS, filesAvisos } from "../avisos.ts";
import { columnLetter, filaNovaComanda, text } from "../sheet-cells.ts";
import { type ColumnKey, MANAGED_COLUMNS, canonicalHeader, normalizeHeader } from "../sheet-schema";
import { construirComandes } from "../sheet-rows.ts";
import { type DeliveryRecord, type Order } from "../types";
import { idPestanya, range, sheetsFetch } from "./api";
import { type Origen, assegurarPestanya, origenDe, origenPrincipal, origens, resolverPestanya } from "./bosses";
import { asegurarTab, docFacturas } from "./document-privat";
import { writeImportes } from "./imports";

export interface SheetSnapshot {
  /** Todos los pedidos válidos de la hoja. */
  orders: Order[];
  /** Índice de cada columna del modelo dentro de la hoja. */
  headerMap: Partial<Record<ColumnKey, number>>;
  /** Filas que se descartaron y por qué, para poder avisar en logs. */
  skipped: { rowNumber: number; reason: string }[];
  /** Nombre de la pestaña que se leyó. */
  sheetTab: string | null;
  /** De qué documento. Todo lo que se escriba a partir de aquí va a ese. */
  origen: Origen;
  /**
   * Filas con algo escrito, cabecera incluida: la siguiente libre es esta +1.
   * Ver `filaLliure`.
   */
  files: number;
}

/**
 * Dónde añadir una fila: la primera libre, desde la columna A.
 *
 * Un `:append` sobre "A:ZZ" deja que Google adivine dónde empieza la tabla,
 * y con cualquier cosa escrita a la derecha de la cabecera —el "RESUM
 * D'ENTREGUES" de Bricomuebles— la fila caía veinte columnas más allá, y
 * cada comanda nueva un poco más lejos. Anclado a una fila vacía no hay nada
 * que adivinar; sigue siendo `:append` para que añada filas si la pestaña
 * está llena.
 */
function filaLliure(snapshot: SheetSnapshot): string {
  return range(`A${snapshot.files + 1}:ZZ`, snapshot.sheetTab);
}

/**
 * Lee la hoja entera y la normaliza.
 *
 * Se piden los valores sin formatear y las fechas como número de serie:
 * así el parseo no depende del locale con el que esté configurada la hoja.
 *
 * @param sheetTab - La pestaña elegida en la app. Si no se pasa, se elige la
 *                   del mes en curso (ver `resolverPestanya`).
 * @param origen - De qué documento. Por defecto, el de siempre.
 */
export async function readSheet(
  sheetTab?: string | null,
  origen: Origen = origenPrincipal(),
): Promise<SheetSnapshot> {
  const tab =
    origen.id === "" && sheetTab ? sheetTab : await resolverPestanya(origen, sheetTab);

  const data = (await sheetsFetch(
    `/values/${encodeURIComponent(range("A1:ZZ", tab))}` +
      `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
    undefined,
    origen.sheetId,
  )) as { values?: unknown[][] };

  const rows = data.values ?? [];
  if (rows.length === 0) {
    throw new Error(
      `La pestaña "${tab}" está vacía. Comprueba el nombre de la pestaña.`,
    );
  }

  const { orders, headerMap, skipped } = construirComandes(rows);
  for (const order of orders) {
    if (origen.id) {
      order.id = `${origen.id}:${order.id}`;
      order.origen = origen.id;
    }
    // La bossa de un cliente es suya: sus comandas no pueden acabar en la
    // factura de otro. Sin código (un solo cliente) no hay nada que separar.
    if (origen.client?.trim()) order.billingClient = origen.client.trim();
  }
  return { orders, headerMap, skipped, sheetTab: tab, origen, files: rows.length };
}

/**
 * Crea en la hoja las columnas que la app gestiona (Estado, Hora Entrega,
 * _lat, _lng…) si el usuario no las tiene. Así el Sheet original de la
 * oficina no necesita preparación previa.
 *
 * Devuelve el headerMap actualizado.
 */
export async function ensureManagedColumns(
  snapshot: SheetSnapshot,
): Promise<Partial<Record<ColumnKey, number>>> {
  const { headerMap, sheetTab: tab, origen } = snapshot;
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
    origen.sheetId,
  );

  return updated;
}

/** Una celda concreta a escribir. */
interface CellUpdate {
  rowNumber: number;
  column: ColumnKey;
  value: string | number;
}

/** Escribe en la pestaña y el documento de los que salió `snapshot`. */
async function writeCells(
  updates: CellUpdate[],
  headerMap: Partial<Record<ColumnKey, number>>,
  snapshot: SheetSnapshot,
): Promise<void> {
  const tab = snapshot.sheetTab;
  const data = updates
    .map((update) => {
      const columnIndex = headerMap[update.column];
      if (columnIndex === undefined) return null;
      const a1 = `${columnLetter(columnIndex)}${update.rowNumber}`;
      return { range: range(a1, tab), values: [[update.value]] };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (data.length === 0) return;

  await sheetsFetch(
    `/values:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
    },
    snapshot.origen.sheetId,
  );
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
  /*
    Cada comanda a su documento, que lo dice el prefijo de su id.

    Una tanda de la cola lleva mezcladas las de las dos bosses —se agrupa
    por el full elegido, no por documento— y escribirlas todas en el primero
    las daba por "no encontradas": entregas perdidas sin un error. Uno detrás
    de otro, y si uno falla el error sube y la cola reintenta la tanda
    entera: lo ya escrito se reescribe igual, como en cualquier reintento.
  */
  const perOrigen = new Map<string, DeliveryRecord[]>();
  for (const record of records) {
    const clau = (await origenDe(record.orderId)).id;
    perOrigen.set(clau, [...(perOrigen.get(clau) ?? []), record]);
  }

  const result: WriteResult = { applied: [], notFound: [] };
  for (const [clau, delOrigen] of perOrigen) {
    const origen = (await origens()).find((o) => o.id === clau)!;
    const escrit = await escriureEntregues(delOrigen, sheetTab, origen);
    result.applied.push(...escrit.applied);
    result.notFound.push(...escrit.notFound);
  }
  return result;
}

/** `writeDeliveries` para las comandas de un solo documento. */
async function escriureEntregues(
  records: DeliveryRecord[],
  sheetTab: string | null | undefined,
  origen: Origen,
): Promise<WriteResult> {
  const snapshot = await readSheet(sheetTab, origen);
  /*
    Se escribe en el full que se ACABA DE LEER, no en el que pidió el móvil.

    Cuando el móvil no manda ninguno —que es lo normal hasta que alguien
    elige uno a mano en el menú— `readSheet` resuelve el del mes y escribir
    con el parámetro crudo caía en `env.google.sheetTab`, que está vacío: el
    rango se quedaba sin nombre de pestaña y Google escribe entonces en la
    PRIMERA del documento. La comanda se encontraba (se había leído bien),
    así que la respuesta decía "entregado" y la barra "actualizado ahora
    mismo"; pero la celda se iba a otra pestaña, el full del mes seguía
    vacío, y al minuto —cuando caduca `TRUST_LOCAL_MS`— la parada volvía a
    pendiente sin un solo error por ninguna parte.
  */
  const headerMap = await ensureManagedColumns(snapshot);
  const byId = new Map(snapshot.orders.map((order) => [order.id, order]));

  const updates: CellUpdate[] = [];
  /* Los importes no van a la hoja de repartos: la comparte la empresa. Se
     juntan aquí y se escriben en el documento privado, junto a las facturas. */
  const importes: ImporteEntrada[] = [];
  /* Los avisos al cliente, tampoco: van a su pestaña del documento privado. */
  const avisos: AvisEntrada[] = [];
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
      Las filas de ESTA entrega, que hoy es siempre una: cada fila del full
      es una entrega y se marca la suya. Ver `construirComandes`.

      Se escribe recorriendo `rowNumbers` y no `rowNumber` a secas porque es
      lo que garantiza que marcar una entrega no toque la fila de otra, que
      con el mismo número de comanda está a un despiste de distancia.
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
    } else if (type === "avis" && record.pas) {
      avisos.push({
        clientId: record.clientId,
        quan: formatSheetTimestamp(record.recordedAt, env.timezone),
        codi: order.codi,
        customer: order.customer,
        phone: order.phone,
        pas: record.pas,
        text: record.note ?? "",
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
  await writeCells(updates, headerMap, snapshot);
  await writeImportes(importes);
  // Lo último: un aviso sin apuntar es lo que menos importa de la tanda.
  await writeAvisos(avisos);
  return { applied, notFound };
}

/**
 * Añade los avisos al cliente a la pestaña "Avisos" del documento privado.
 *
 * Antes de añadir se lee la columna "Id" y se quitan los que ya estén: es la
 * única escritura de la cola que añade filas en vez de reescribir celdas, y
 * sin esto un reintento apuntaría el mismo aviso dos veces. Ver `filesAvisos`.
 */
async function writeAvisos(avisos: AvisEntrada[]): Promise<void> {
  if (avisos.length === 0) return;
  await asegurarTab(TAB_AVISOS, CABECERA_AVISOS);

  const doc = docFacturas();
  const columnaId = columnLetter(CABECERA_AVISOS.length - 1);
  const ids = (await sheetsFetch(
    `/values/${encodeURIComponent(range(`${columnaId}2:${columnaId}`, TAB_AVISOS))}`,
    undefined,
    doc,
  )) as { values?: unknown[][] };

  const files = filesAvisos(avisos, (ids.values ?? []).map((fila) => text(fila[0])));
  if (files.length === 0) return;

  await sheetsFetch(
    `/values/${encodeURIComponent(range(`A:${columnaId}`, TAB_AVISOS))}:append` +
      // RAW por lo mismo que los importes: que Google no convierta el full
      // "JUL 26" en una fecha, ni un "+34 666…" en una fórmula.
      `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: files }) },
    doc,
  );
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
  /**
   * Crear la comanda aunque ese número ya esté en el full: es otra parte de
   * la misma entrega. Sin esto, el número repetido se rechaza, que es lo que
   * hay que hacer con un número mal tecleado.
   */
  afegirPart?: boolean;
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
  /** En qué documento: la bossa desde la que se ha pulsado "+". */
  origen: Origen = origenPrincipal(),
): Promise<{
  /** La pestaña donde ha caído la fila. En el segundo documento es la suya. */
  sheetTab: string;
  /**
   * El full tal y como lo nombra la app, que es siempre del documento de
   * siempre. Es lo que vale para volver a pedir el manifiesto: el nombre de
   * una pestaña del segundo documento no lo entiende nadie más.
   */
  full: string;
}> {
  /*
    En el segundo documento, el mes que estás mirando se crea si no está.
    Sin esto, una comanda de la otra empresa en SET 26 caía en su último
    mes —o en ningún sitio si su hoja estaba recién estrenada—. Con la
    pestaña forzada por entorno no se toca nada: esa manda.
  */
  let full = sheetTab;
  if (origen.id && !origen.sheetTab) {
    full ??= await resolverPestanya(origenPrincipal());
    await assegurarPestanya(origen, full);
  }

  const snapshot = await readSheet(full, origen);

  /*
    El mismo número otra vez es casi siempre un número mal tecleado, así que
    por defecto no pasa. Pero a veces es adrede: una comanda que se entrega
    en dos veces se apunta como dos filas con el mismo número, cada una con
    su día y su importe. Eso lo dice quien la crea con `afegirPart`, y es
    una decisión suya, no algo que se pueda adivinar aquí.
  */
  const partsJa = snapshot.orders.filter((order) => order.codi === dades.id).length;
  if (partsJa > 0 && !dades.afegirPart) {
    throw new ErrorAccionable(
      `Ja hi ha una comanda amb el número "${dades.id}" al full ${snapshot.sheetTab}.`,
    );
  }

  /*
    Una parte hereda de la primera lo que no cambia entre viajes: el cliente,
    la dirección, la población y el teléfono.

    Es el mismo sitio —la comanda se parte porque no cabe todo en un viaje,
    no porque vaya a dos lados—, y sin dirección la parte nueva no se puede
    navegar: la tarjeta esconde el botón. Copiarla aquí es también no volver
    a pagar geocoding por una dirección que la app ya resolvió: se traen las
    coordenadas cacheadas con ella.

    Lo que SÍ cambia en cada viaje —medidas y notas— no se hereda: es lo que
    distingue una parte de otra.
  */
  const primera = snapshot.orders.find((order) => order.codi === dades.id);
  const hereda = (propi: string | undefined, delPare: string | null | undefined) =>
    propi && propi.trim() !== "" ? propi : (delPare ?? "");
  const coords =
    dades.address && dades.address.trim() !== "" ? null : primera;

  const valores = filaNovaComanda(
    {
      id: dades.id,
      customer: hereda(dades.customer, primera?.customer),
      address: hereda(dades.address, primera?.address),
      city: hereda(dades.city, primera?.city),
      phone: hereda(dades.phone, primera?.phone),
      lat: coords?.lat !== null && coords?.lat !== undefined ? String(coords.lat) : "",
      lng: coords?.lng !== null && coords?.lng !== undefined ? String(coords.lng) : "",
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
    lloc ? await ensureManagedColumns(snapshot) : snapshot.headerMap,
  );

  await sheetsFetch(
    `/values/${encodeURIComponent(filaLliure(snapshot))}:append` +
      `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [valores] }) },
    origen.sheetId,
  );

  return {
    sheetTab: snapshot.sheetTab ?? "",
    full: origen.id
      ? (full ?? (await resolverPestanya(origenPrincipal())))
      : (snapshot.sheetTab ?? ""),
  };
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
 * Escribe en la fila de esa entrega y solo en esa: las otras filas con el
 * mismo número son otros viajes y tienen sus propios datos.
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
  const snapshot = await readSheet(sheetTab, await origenDe(id));
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
    updates.push({ rowNumber: order.rowNumber, column: "precisio", value: "portal" });
  } else if (canviaAdreca) {
    for (const columna of ["lat", "lng", "placeId", "precisio", "geoAddress"] as const) {
      updates.push({ rowNumber: order.rowNumber, column: columna, value: "" });
    }
  }

  const headerMap =
    lloc || canviaAdreca ? await ensureManagedColumns(snapshot) : snapshot.headerMap;

  await writeCells(updates, headerMap, snapshot);
  return true;
}

/**
 * Pasa las filas de unas comandas a otro full del mismo documento.
 *
 * Primero se añaden en el destino y luego se borran del origen: si algo falla
 * a medias quedan repetidas, que se ve y se arregla, en vez de perdidas. Todo
 * de una vez —una lectura, una escritura y un borrado— y no comanda a
 * comanda: con diez seguidas se pasaba del cupo por minuto de Google.
 *
 * Cada columna va a la de la misma cabecera en el destino, no a la misma
 * posición: cada mes puede tener las columnas en otro orden. Si una celda con
 * datos no tiene dónde ir, no se mueve nada.
 *
 * `desti` es un full del documento de siempre; para el segundo se usa su
 * mes, como en `crearComanda`. Devuelve las que se han movido y de qué full
 * salieron, que es adonde las devuelve el Desfer.
 */
export async function moureComandes(
  ids: string[],
  desti: string,
  sheetTab?: string | null,
): Promise<{ mogudes: string[]; de: string }> {
  const [origen, ...resta] = await Promise.all(ids.map(origenDe));
  if (resta.some((o) => o.id !== origen.id)) {
    throw new ErrorAccionable("Les comandes són de documents diferents.");
  }
  const snapshot = await readSheet(sheetTab, origen);
  const tabOrigen = snapshot.sheetTab ?? "";
  const orders = snapshot.orders.filter((o) => ids.includes(o.id));
  if (orders.length === 0) return { mogudes: [], de: tabOrigen };

  let tabDesti = desti;
  if (origen.id) {
    if (!origen.sheetTab) await assegurarPestanya(origen, desti);
    tabDesti = await resolverPestanya(origen, desti);
  }
  if (tabDesti === tabOrigen) {
    throw new ErrorAccionable(`Les comandes ja són al full ${tabOrigen}.`);
  }

  const destiSnapshot = await readSheet(tabDesti, origen);
  // Las columnas de la app (_lat, Estat…) pueden no existir aún en el destino.
  const destiMap = await ensureManagedColumns(destiSnapshot);
  const llegir = async (a1: string, tab: string) =>
    ((await sheetsFetch(
      `/values/${encodeURIComponent(range(a1, tab))}`,
      undefined,
      origen.sheetId,
    )) as { values?: unknown[][] }).values ?? [];
  // Valores formateados, tal y como se ven: fechas e importes se reescriben
  // igual con USER_ENTERED en el mismo documento.
  const [filesOrigen, [cabDesti = []]] = await Promise.all([
    llegir("A1:ZZ", tabOrigen),
    llegir("1:1", tabDesti),
  ]);
  const cabOrigen = filesOrigen[0] ?? [];

  const columnaDesti = (i: number): number => {
    const clau = (Object.keys(snapshot.headerMap) as ColumnKey[]).find(
      (k) => snapshot.headerMap[k] === i,
    );
    const nom = normalizeHeader(String(cabOrigen[i] ?? ""));
    return (
      (clau ? destiMap[clau] : undefined) ??
      cabDesti.findIndex((c) => normalizeHeader(String(c ?? "")) === nom)
    );
  };

  const perdudes = new Set<string>();
  const noves = orders.map((order) => {
    const valors: unknown[] = [];
    (filesOrigen[order.rowNumber - 1] ?? []).forEach((valor, i) => {
      if (valor === "" || valor === null || valor === undefined) return;
      const j = columnaDesti(i);
      if (j < 0) perdudes.add(String(cabOrigen[i] ?? i + 1));
      else valors[j] = valor;
    });
    return Array.from(valors, (v) => v ?? "");
  });
  if (perdudes.size > 0) {
    throw new ErrorAccionable(
      `El full ${tabDesti} no té les columnes: ${[...perdudes].join(", ")}. No s'ha mogut res.`,
    );
  }

  await sheetsFetch(
    `/values/${encodeURIComponent(filaLliure(destiSnapshot))}:append` +
      `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: noves }) },
    origen.sheetId,
  );

  const gid = await idPestanya(origen.sheetId, tabOrigen);
  if (gid === null) throw new ErrorAccionable(`No trobo el full ${tabOrigen} per esborrar-les.`);
  // De abajo arriba: borrar una fila sube las de debajo, no las de encima.
  const requests = orders
    .map((o) => o.rowNumber)
    .sort((a, b) => b - a)
    .map((fila) => ({
      deleteDimension: {
        range: { sheetId: gid, dimension: "ROWS", startIndex: fila - 1, endIndex: fila },
      },
    }));
  await sheetsFetch(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) }, origen.sheetId);
  return { mogudes: orders.map((o) => o.id), de: tabOrigen };
}

/**
 * Borra una comanda del full: su fila entera.
 *
 * Devuelve la fila tal y como estaba escrita y en qué pestaña, que es lo que
 * hace falta para deshacerlo (`restaurarComanda`). `null` si ya no está.
 */
export async function esborrarComanda(
  id: string,
  sheetTab?: string | null,
): Promise<{ full: string; fila: unknown[] } | null> {
  const origen = await origenDe(id);
  const snapshot = await readSheet(sheetTab, origen);
  const order = snapshot.orders.find((o) => o.id === id);
  if (!order) return null;

  const full = snapshot.sheetTab ?? "";
  // Formateada, como en `moureComandes`: se reescribe igual con USER_ENTERED.
  const llegida = (await sheetsFetch(
    `/values/${encodeURIComponent(range(`A${order.rowNumber}:ZZ${order.rowNumber}`, full))}`,
    undefined,
    origen.sheetId,
  )) as { values?: unknown[][] };

  const gid = await idPestanya(origen.sheetId, full);
  if (gid === null) throw new ErrorAccionable(`No trobo el full ${full} per esborrar-la.`);
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
                startIndex: order.rowNumber - 1,
                endIndex: order.rowNumber,
              },
            },
          },
        ],
      }),
    },
    origen.sheetId,
  );
  return { full, fila: llegida.values?.[0] ?? [] };
}

/**
 * Deshace `esborrarComanda`: vuelve a escribir la fila en su pestaña.
 *
 * Al final y no donde estaba: entre el borrado y el Desfer la oficina puede
 * haber movido filas, y el orden del full no significa nada para la app.
 */
export async function restaurarComanda(id: string, full: string, fila: unknown[]): Promise<void> {
  const origen = await origenDe(id);
  const snapshot = await readSheet(full, origen);
  await sheetsFetch(
    `/values/${encodeURIComponent(filaLliure(snapshot))}:append` +
      `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [fila] }) },
    origen.sheetId,
  );
}

/** Lo que se guarda de una comanda ya geocodificada. */
export interface CoordCacheada {
  orderId: string;
  /** La dirección que se le preguntó a Google, tal cual. */
  address: string;
  /** `null` las dos cuando Google no reconoció la dirección. */
  lat: number | null;
  lng: number | null;
  /** El portal en Google, si el punto salió de una ficha suya. */
  placeId: string | null;
  /** Hasta dónde se afinó: el portal, el negocio, la calle o el pueblo. */
  geoLevel: "portal" | "negoci" | "carrer" | "poble" | null;
}

/**
 * Persiste en el Sheet las coordenadas recién geocodificadas, para no volver
 * a pagar geocoding por la misma dirección nunca más.
 *
 * Junto a ellas va la dirección de la que salieron. Es lo que las caduca
 * cuando alguien corrige el portal: al leer la hoja se comparan las dos y,
 * si no coinciden, las coordenadas se tiran y se vuelven a buscar. Ver
 * `construirComandes`.
 *
 * Las direcciones que Google no reconoce se guardan igual, sin coordenadas:
 * dejan constancia de que ya se preguntó y evitan volver a preguntar lo
 * mismo en cada sincronización.
 */
export async function cacheCoordinates(
  coords: CoordCacheada[],
  snapshot: SheetSnapshot,
): Promise<void> {
  if (coords.length === 0) return;

  const headerMap = await ensureManagedColumns(snapshot);
  const byId = new Map(snapshot.orders.map((order) => [order.id, order]));

  const updates: CellUpdate[] = [];
  for (const coord of coords) {
    const order = byId.get(coord.orderId);
    if (!order) continue;
    // En todas las filas de la comanda, que es lo que dice `rowNumbers`.
    for (const fila of order.rowNumbers) {
      updates.push({ rowNumber: fila, column: "lat", value: coord.lat ?? "" });
      updates.push({ rowNumber: fila, column: "lng", value: coord.lng ?? "" });
      updates.push({ rowNumber: fila, column: "geoAddress", value: coord.address });
      /*
        El portal y lo fino que se ha hilado van al lado del punto.

        Vacíos cuando no los hay —una dirección que Google no reconoce, o un
        punto que puso una persona— y por eso se escriben siempre: dejarlos
        sin tocar mantendría los de la dirección anterior, que es de lo que
        iba todo esto.
      */
      updates.push({ rowNumber: fila, column: "placeId", value: coord.placeId ?? "" });
      updates.push({ rowNumber: fila, column: "precisio", value: coord.geoLevel ?? "" });
    }
  }

  await writeCells(updates, headerMap, snapshot);
}
