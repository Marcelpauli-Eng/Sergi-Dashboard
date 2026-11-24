/**
 * A quién se factura y quién emite: las pestañas "Clients" y "Emissor" del
 * documento privado. Qué es cada columna lo deciden `lib/clients.ts` y
 * `lib/emissor.ts`; aquí solo está el viaje.
 */
import "server-only";
import { CABECERA_CLIENTS, clientAFila, TAB_CLIENTS, fullsDe, parseClients } from "../clients.ts";
import { type ClienteFacturacion } from "../factura.ts";
import { CABECERA_EMISSOR, type Emissor, TAB_EMISSOR, emissorAFila, filaAEmissor } from "../emissor.ts";
import { range, sheetsFetch } from "./api";
import { oblidarBosses } from "./bosses";
import { asegurarTab, docFacturas } from "./document-privat";

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

  // La columna H no viene de la app: se relee y cada hoja sigue a su cliente.
  const abans = (await sheetsFetch(
    `/values/${encodeURIComponent(range("A2:H", TAB_CLIENTS))}`,
    undefined,
    doc,
  )) as { values?: unknown[][] };
  const fulls = fullsDe(abans.values ?? [], clients);

  if (clients.length > 0) {
    await sheetsFetch(
      `/values/${encodeURIComponent(range(`A2:H${clients.length + 1}`, TAB_CLIENTS))}` +
        `?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        body: JSON.stringify({
          values: clients.map((client, i) => [...clientAFila(client), fulls[i]]),
        }),
      },
      doc,
    );
  }

  await sheetsFetch(
    `/values/${encodeURIComponent(range(`A${clients.length + 2}:H`, TAB_CLIENTS))}:clear`,
    { method: "POST", body: "{}" },
    doc,
  );
  oblidarBosses();
}

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
