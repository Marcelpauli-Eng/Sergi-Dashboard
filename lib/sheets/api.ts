/**
 * El transporte con Google Sheets: la llamada a la API, el rango con su
 * pestaña y lo que sirve a cualquier documento (pestañas, permiso de
 * escritura, el número interno de una pestaña). Aquí no se decide nada.
 */
import "server-only";
import { googleAccessToken } from "../google-auth";
import { env } from "../env";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

/** Rango A1 con el nombre de pestaña escapado (puede llevar espacios). */
export function range(a1: string, sheetTab?: string | null): string {
  const tab = sheetTab ?? env.google.sheetTab;
  if (!tab) return a1;
  // Las comillas simples en el nombre de pestaña se escapan duplicándolas.
  // Envolvemos siempre en comillas simples para que funcionen tabs con espacios.
  return `'${tab.replace(/'/g, "''")}'!${a1}`;
}

/**
 * Google ha dicho que no: demasiadas peticiones en un minuto (HTTP 429).
 *
 * La cuota es de la cuenta de servicio, no de cada móvil: todos los
 * dispositivos y todas las bosses gastan del mismo saco, unas sesenta
 * lecturas por minuto. No es una avería: pasado el minuto vuelve a ir. Por
 * eso tiene su propio tipo, para que quien lo reciba pueda decirlo claro y
 * esperar en vez de enseñar el error crudo de Google.
 */
export class ErrorQuotaGoogle extends Error {
  constructor() {
    super(
      "Google va saturat: massa lectures en un minut. Les dades que veus són les " +
        "d'abans i es tornarà a provar sol.",
    );
    this.name = "ErrorQuotaGoogle";
  }
}

/**
 * Cuánto esperar antes de cada reintento tras un 429.
 *
 * Un 429 quiere decir que Google ni ha mirado la petición, así que repetirla
 * es seguro, también si escribe. Poco rato y pocas veces: la cuota es por
 * minuto, y una petición no puede quedarse colgada esperando a que pase:
 * una sincronización encadena varias lecturas y la función del servidor
 * tiene un tiempo máximo. Como mucho, unos tres segundos por lectura.
 */
const ESPERES_429_MS = [700, 1_800];

/**
 * Una llamada a la API de Sheets.
 *
 * `spreadsheetId` existe porque las facturas viven en OTRO documento que los
 * repartos: el de repartos lo comparte la empresa y lo que factura el
 * transportista no es asunto suyo. Ver `env.google.facturasSheetId`.
 */
export async function sheetsFetch(
  path: string,
  init?: RequestInit,
  spreadsheetId: string = env.google.sheetId,
): Promise<unknown> {
  const token = await googleAccessToken();
  let response: Response;
  for (let intent = 0; ; intent++) {
    response = await fetch(`${API}/${spreadsheetId}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      // Los datos del Sheet cambian constantemente; nunca los cachea Next.
      cache: "no-store",
    });
    if (response.status !== 429) break;
    if (intent >= ESPERES_429_MS.length) throw new ErrorQuotaGoogle();
    // Con algo de azar, para que dos peticiones rechazadas a la vez no
    // vuelvan a chocar en el mismo instante.
    await new Promise((fet) => setTimeout(fet, ESPERES_429_MS[intent] + Math.random() * 300));
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Google Sheets respondió ${response.status} en ${path}: ${body.slice(0, 500)}`,
    );
  }

  return response.json();
}

/**
 * Cuánto se fía uno de la lista de pestañas de un documento.
 *
 * Se preguntaba en cada sincronización, una vez por bossa: con cuatro bosses
 * y un refresco cada veinte segundos eran doce lecturas por minuto y móvil
 * solo para saber que las pestañas seguían siendo las mismas, y la cuota de
 * Google (ver `ErrorQuotaGoogle`) saltaba. Las pestañas cambian una vez al
 * mes. Lo que las crea desde la app tira la lista (`oblidarPestanyes`), y lo
 * que crea algo si NO está pide la lista fresca (`fresca`).
 *
 * ponytail: caché en memoria del proceso, como la de bosses e importes; en
 * Vercel cada instancia tiene la suya.
 */
const PESTANYES_MS = 5 * 60_000;

const pestanyes = new Map<string, { fins: number; llista: string[] }>();

/** Olvida la lista de pestañas de un documento, o de todos. */
export function oblidarPestanyes(spreadsheetId?: string): void {
  if (spreadsheetId) pestanyes.delete(spreadsheetId);
  else pestanyes.clear();
}

/**
 * Devuelve los nombres de todas las pestañas (hojas) del Google Sheet.
 *
 * @param fresca - Preguntar a Google aunque haya una lista reciente. Para
 *   quien va a CREAR una pestaña si no la ve: una lista de hace un rato
 *   podría no tener la que acaba de crear otro, y se intentaría dos veces.
 */
export async function listSheetTabs(
  spreadsheetId: string = env.google.sheetId,
  { fresca = false }: { fresca?: boolean } = {},
): Promise<string[]> {
  const guardada = pestanyes.get(spreadsheetId);
  if (!fresca && guardada && Date.now() < guardada.fins) return [...guardada.llista];

  const data = (await sheetsFetch(
    `?fields=sheets.properties.title`,
    undefined,
    spreadsheetId,
  )) as {
    sheets?: { properties?: { title?: string } }[];
  };

  const llista = (data.sheets ?? [])
    .map((s) => s.properties?.title ?? "")
    .filter((title) => title.length > 0);
  pestanyes.set(spreadsheetId, { fins: Date.now() + PESTANYES_MS, llista });
  return [...llista];
}

/** Cuál de los dos documentos. Solo para etiquetar comprobaciones. */
export type SheetDoc = "repartos" | "segon" | "privado";

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

/**
 * El identificador interno de una pestaña, que no es su nombre.
 *
 * Hace falta para borrar una fila: la API de valores sabe escribir y vaciar
 * celdas, pero quitar la fila entera es una operación de estructura y esas
 * van por `:batchUpdate`, que pide el `sheetId` —el número que sale en la
 * URL como `#gid=`— y no el título.
 */
export async function idPestanya(doc: string, titulo: string): Promise<number | null> {
  const data = (await sheetsFetch(
    "?fields=sheets.properties(sheetId,title)",
    undefined,
    doc,
  )) as { sheets?: { properties?: { sheetId?: number; title?: string } }[] };

  const pestanya = (data.sheets ?? []).find((s) => s.properties?.title === titulo);
  return pestanya?.properties?.sheetId ?? null;
}
