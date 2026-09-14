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
      part: 1,
      parts: 1,
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

    /*
      La marca que escribe la app al crear otra parte desde el móvil. Ver
      `part` en `lib/sheet-schema.ts`: sin ella, una parte recién creada
      —que solo tiene el número— sería indistinguible de un bulto.
    */
    const marcaPart = parseNumber(cell(row, "part"));

    const yaEsta = porId.get(id);
    if (yaEsta !== undefined) {
      /*
        Otra fila con el mismo nº de comanda: o es un bulto más de la misma
        entrega —así escribe la oficina las comandas de varios paquetes, y se
        fusiona; ver `fusionarBulto`— o de la misma comanda: la entrega
        se parte en dos cuando no cabe todo o cuando falta material, y la
        oficina apunta cada parte en su fila con el mismo número. Son dos
        entregas, cada una con su día, su hora y lo que se cobra por hacerla.

        Antes la segunda se descartaba: la oficina la veía en su hoja y el
        transportista no, así que esa parte ni se repartía ni se cobraba.
        Ahora entra como una parada más, con su propia clave ("748#2") para
        que marcar una entregada no toque la otra y cada una lleve su
        importe.

        Se reconoce por tres cosas, y basta una:

        - Dirección propia: así lo escribe la oficina.
        - La marca `_part`: así lo escribe la app, donde una parte nueva nace
          solo con el número y la dirección llega después.
        - Ni medidas ni cliente: no hay nada que la haga un bulto. Una fila
          de bulto existe para decir QUÉ paquete es —lleva las medidas—, así
          que una fila repetida que no dice nada de eso no lo es. Esto
          recupera las partes creadas antes de que existiera la marca.

        El número que se enseña y el que va a la factura sigue siendo el de
        la hoja —`codi`—: para el cliente es una sola comanda.
      */
      const esBulto =
        !address &&
        (marcaPart === null || marcaPart <= 1) &&
        (fila.measures !== null || fila.customer !== "");

      if (!esBulto) {
        const parte = (vecesVisto.get(id) ?? 1) + 1;
        vecesVisto.set(id, parte);
        const otraParte: Order = {
          ...fila,
          id: `${id}#${parte}`,
          part: parte,
          parts: parte,
        };
        // Los siguientes bultos de este número son de ESTA parte, la última.
        porId.set(id, orders.length);
        orders.push(otraParte);
        // Cuántas partes hay solo se sabe al final; las anteriores se ponen
        // al día para que todas digan lo mismo ("part 1 de 2", "part 2 de 2").
        for (const otra of orders) {
          if (otra.codi === id) otra.parts = parte;
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