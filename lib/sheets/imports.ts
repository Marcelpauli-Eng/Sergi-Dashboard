import "server-only";
import { env } from "../env";
import { formatSheetTimestamp } from "../dates";
import { CABECERA_IMPORTS, type ImporteEntrada, TAB_IMPORTS, parseImportes, planImportes } from "../importes.ts";
import { text } from "../sheet-cells.ts";
import { range, sheetsFetch } from "./api";
import { asegurarTab, docFacturas } from "./document-privat";

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
