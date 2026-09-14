/**
 * De filas de la hoja a comandas.
 *
 * Vive fuera de `lib/sheets.ts` —que es solo de servidor y trae consigo las
 * credenciales— porque aquí está lo único que hay que poder comprobar sin
 * Google: qué filas se juntan como bultos, cuáles se descartan y qué pasa
 * cuando la oficina repite un número de comanda.
 *
 * Ver `scripts/check-sheet-rows.mts`.
 */

import {
  fusionarBulto,
  parseNumber,
  parsePriority,
  parseStatus,
  parseStatusCategory,
  text,
} from "./sheet-cells.ts";
import { parseSheetDate, parseSheetTime } from "./dates.ts";
import {
  mapHeaders,
  REQUIRED_COLUMNS,
  MissingColumnsError,
  type ColumnKey,
} from "./sheet-schema.ts";
import type { Order } from "./types.ts";

/** Filas descartadas al leer, con el motivo, para poder avisar. */
export interface FilaDescartada {
  rowNumber: number;
  reason: string;
}

/**
 * Las filas de la hoja, ya normalizadas en comandas.
 *
 * Está aparte de `readSheet` —y exportada— porque aquí vive lo que hay que
 * poder comprobar sin Google: qué filas se juntan como bultos, cuáles se
 * descartan y qué pasa cuando la oficina repite un número de comanda. Ver
 * `scripts/check-sheet-rows.mts`.
 */
export function construirComandes(rows: unknown[][]): {
  orders: Order[];
  headerMap: Partial<Record<ColumnKey, number>>;
  skipped: FilaDescartada[];
} {
  const headerRow = (rows[0] ?? []).map((cell) => String(cell ?? ""));
  const headerMap = mapHeaders(headerRow);

  const missing = REQUIRED_COLUMNS.filter((key) => headerMap[key] === undefined);
  if (missing.length > 0) throw new MissingColumnsError(missing);

  const cell = (row: unknown[], key: ColumnKey): unknown => {
    const index = headerMap[key];
    return index === undefined ? undefined : row[index];
  };

  const orders: Order[] = [];
  const skipped: FilaDescartada[] = [];
  /**
   * Dónde está cada comanda dentro de `orders`, para juntarle sus bultos.
   * Con un número repetido apunta a la ÚLTIMA aparición: los bultos van
   * siempre detrás de su entrega.
   */
  const porId = new Map<string, number>();
  /** Cuántas veces ha salido ya cada número de comanda con dirección propia. */
  const vecesVisto = new Map<string, number>();

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
      codi: id,
      duplicats: 1,
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

        Si SÍ trae dirección son dos entregas distintas compartiendo número.
        Antes se descartaba la segunda: la oficina la veía en su hoja y el
        transportista no, y esa entrega no se hacía ni se cobraba. Ahora
        entra como una parada más, con su propia clave ("748#2") para que
        marcar una entregada no toque la otra y cada una lleve su importe.

        El número que se enseña y el que va a la factura sigue siendo el de
        la hoja: `codi`.
      */
      if (address) {
        const veces = (vecesVisto.get(id) ?? 1) + 1;
        vecesVisto.set(id, veces);
        const duplicada: Order = { ...fila, id: `${id}#${veces}`, duplicats: veces };
        // Los siguientes bultos de este número son de ESTA entrega, la última.
        porId.set(id, orders.length);
        orders.push(duplicada);
        // Todas las que comparten número lo dicen, también la primera.
        for (const otra of orders) {
          if (otra.codi === id) otra.duplicats = veces;
        }
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

  return { orders, headerMap, skipped };
}