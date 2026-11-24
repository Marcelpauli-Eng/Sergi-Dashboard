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
