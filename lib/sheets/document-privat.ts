/**
 * El documento privado del transportista: facturas, clientes, emisor,
 * importes y avisos. La empresa no lo ve, por eso va aparte de las hojas de
 * comandas. Aquí, encontrarlo y preparar sus pestañas.
 */
import "server-only";
import { ErrorAccionable, env } from "../env";
import { columnLetter, text } from "../sheet-cells.ts";
import { listSheetTabs, oblidarPestanyes, range, sheetsFetch } from "./api";

/**
 * Dónde vive el registro de facturas: un documento aparte, obligatorio.
 *
 * Google Sheets no sabe ocultar una pestaña a quien tiene acceso al
 * documento, así que separar el archivo es la única manera de que la empresa
 * no vea lo que factura el transportista. Sin la variable no se factura: el
 * apaño de caer en el documento de repartos convertía un olvido de
 * configuración en la fuga que esto viene a evitar.
 */
export function docFacturas(): string {
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
export async function tabsFacturas(doc: string, fresca = false): Promise<string[]> {
  try {
    return await listSheetTabs(doc, { fresca });
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

/**
 * Crea una pestaña del documento privado con su cabecera, si hace falta.
 *
 * Que exista no basta: si alguien la crea a mano y se queda sin cabecera, la
 * primera fila de datos iría a la 1 y a partir de ahí todo lo que cuenta
 * desde la 2 apuntaría a la fila equivocada. Por eso la cabecera se escribe
 * también cuando la pestaña ya estaba pero está vacía.
 */
export async function asegurarTab(tab: string, cabecera: string[]): Promise<void> {
  const doc = docFacturas();
  let tabs = await tabsFacturas(doc);
  // La lista de hace un rato puede no tener la que otro acaba de crear: antes
  // de crearla, se pregunta otra vez.
  if (!tabs.includes(tab)) tabs = await tabsFacturas(doc, true);
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
    oblidarPestanyes(doc);
  }

  await sheetsFetch(
    `/values/${encodeURIComponent(rangCabecera)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values: [cabecera] }) },
    doc,
  );
}
