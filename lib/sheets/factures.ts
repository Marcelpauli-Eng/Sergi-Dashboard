/**
 * El registro de facturas emitidas, en la pestaña "Factures" del documento
 * privado: emitir, leer, cambiar su estado o su fecha y borrar.
 */
import "server-only";
import { parseSheetDate } from "../dates";
import { comprovarNoFacturades, parseImportesFactura } from "../factura.ts";
import { parseNumber, text } from "../sheet-cells.ts";
import { type EstatFactura, type FacturaEmitida } from "../types";
import { idPestanya, oblidarPestanyes, range, sheetsFetch } from "./api";
import { docFacturas, tabsFacturas } from "./document-privat";

/**
 * Las facturas emitidas viven en una pestaña con este nombre.
 *
 * En un Sheet y no en el móvil a propósito: es lo que permite que el número
 * correlativo no dependa del dispositivo y que un cambio de teléfono no se
 * lleve por delante la serie. En cuál, lo decide `docFacturas()`.
 */
export const TAB_FACTURAS = "Factures";

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
  // De qué documento sale cada línea, en el orden de "Comandes". Vacía en
  // las facturas de un solo documento, que son todas las de antes.
  "Grups",
  // El id de cada comanda en la app, en el orden de "Comandes". Es lo que
  // dice qué comanda está facturada sin confundirla con la de otra bossa
  // (ver `comandesFacturades`). Vacía en las facturas de antes.
  "Ids",
];

/** Última columna de la pestaña de facturas. Va con `CABECERA_FACTURAS`. */
const ULTIMA_COLUMNA_FACTURAS = "M";

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
  const tabs = await pestanyesFacturas(doc);

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
    oblidarPestanyes(doc);
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
  const grups = text(fila[11]).split(";").map((g) => g.trim());
  const ids = text(fila[12]).split(";").map((g) => g.trim());

  return {
    numero,
    // Las emitidas antes del apóstrofo están guardadas como fecha de verdad
    // y vuelven como número de serie; `parseSheetDate` las devuelve a ISO.
    fecha: parseSheetDate(fila[1]) ?? text(fila[1]),
    periodo: text(fila[2]),
    lineas: comandas.map((comanda, i) => ({
      comanda,
      importe: importes[i] ?? 0,
      ...(grups[i] ? { grup: grups[i] } : {}),
      ...(ids[i] ? { id: ids[i] } : {}),
    })),
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

/**
 * Las pestañas del documento de facturas, con la de "Factures" de seguro.
 *
 * La lista puede venir de hace unos minutos (ver `listSheetTabs`). Si en ella
 * no está "Factures", se pregunta de nuevo antes de creérselo: leer "no hay
 * facturas" por una lista vieja dejaría pasar una comanda ya facturada.
 */
async function pestanyesFacturas(doc: string): Promise<string[]> {
  const tabs = await tabsFacturas(doc);
  return tabs.includes(TAB_FACTURAS) ? tabs : tabsFacturas(doc, true);
}

/** Todas las facturas emitidas, de la más reciente a la más antigua. */
export async function readFacturas(): Promise<FacturaEmitida[]> {
  const doc = docFacturas();
  const tabs = await pestanyesFacturas(doc);
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
  lineas: { comanda: string; importe: number; grup?: string; id?: string }[];
  base: number;
  iva: number;
  irpf: number;
  total: number;
  /** Código del cliente al que se emite. Vacío si solo hay uno. */
  client?: string;
  /** Número con el que arranca la serie si todavía no hay ninguna factura. */
  primerNumero: number;
},
/** El nombre del full principal. Ver `comprovarNoFacturades`. */
nomPrincipal?: string,
): Promise<FacturaEmitida> {
  await asegurarTabFacturas();

  const emitidas = await readFacturas();
  // Una comanda no se factura dos veces. Ver `comandesFacturades`.
  comprovarNoFacturades(emitidas, { ...datos, nomPrincipal });
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
    // Con apóstrofo, como la fecha: un nombre no se interpreta. Sin ";"
    // dentro, que es el separador.
    datos.lineas.some((l) => l.grup)
      ? `'${datos.lineas.map((l) => (l.grup ?? "").replace(/;/g, ",")).join("; ")}`
      : "",
    // Igual que los grupos. Un id con ";" dentro no se podría volver a
    // partir: esa línea se queda sin id y se reconoce como las antiguas.
    datos.lineas.some((l) => l.id)
      ? `'${datos.lineas.map((l) => (l.id && !l.id.includes(";") ? l.id : "")).join("; ")}`
      : "",
  ];

  await sheetsFetch(
    `/values/${encodeURIComponent(range(`A:${ULTIMA_COLUMNA_FACTURAS}`, TAB_FACTURAS))}:append` +
      `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [fila] }) },
    docFacturas(),
  );

  return { ...datos, client: datos.client ?? "", estat: "emesa", numero };
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
 * Cambia la fecha de una factura ya emitida (columna B), por si salió con
 * el día en que se hizo y no con el que tocaba. Número e importes no se tocan.
 */
export async function canviarDataFactura(
  numero: number,
  fecha: string,
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

  const fila = indice + 2;
  // Con apóstrofo, como al emitir: si no, Sheets la convierte en fecha.
  await sheetsFetch(
    `/values/${encodeURIComponent(range(`B${fila}`, TAB_FACTURAS))}` +
      `?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values: [[`'${fecha}`]] }) },
    docFacturas(),
  );

  const todas = await readFacturas();
  return todas.find((f) => f.numero === numero) ?? null;
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
  const tabs = await pestanyesFacturas(doc);
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
