/**
 * De dónde salen las comandas: qué documentos hay (una bossa por cada uno) y
 * qué pestaña se lee de cada uno.
 *
 * El de siempre y el segundo salen del entorno; los de los clientes, de la
 * columna H de "Clients" en el documento privado (ver lib/clients.ts).
 */
import "server-only";
import { env } from "../env";
import { today } from "../dates";
import { noTabFoundMessage, parseTabMonth, pestanyaACrear, planDelFull } from "../sheet-tab";
import { type BossaClient, TAB_CLIENTS, bossesDeClients } from "../clients.ts";
import { listSheetTabs, range, sheetsFetch } from "./api";

/**
 * Un documento de comandas.
 *
 * El de siempre (`GOOGLE_SHEET_ID`) y, si está puesto, un segundo
 * (`GOOGLE_SHEET_ID_2`) de otra empresa con su propia numeración. Cada uno
 * es una bossa en el calendario; los dos van a la misma ruta y a la misma
 * factura.
 */
export interface Origen {
  /**
   * "" el de siempre, "2" el segundo. Va delante del id de sus comandas
   * —"2:748"— para que no choquen con las del primero. Ver `Order.origen`.
   */
  id: string;
  nom: string;
  sheetId: string;
  /** Pestaña forzada por entorno. `null`: la del mes, como siempre. */
  sheetTab: string | null;
  /**
   * Solo en la bossa de un cliente: su código. Todas sus comandas se le
   * facturan a él, diga lo que diga la columna "Client facturació".
   */
  client?: string;
}

/** El documento de siempre. */
export function origenPrincipal(): Origen {
  const { sheetId, sheetTab, nom } = env.google;
  return { id: "", nom, sheetId, sheetTab };
}

/** Los del entorno: el de siempre y, si está, el segundo. Sin leer nada. */
export function origensFixos(): Origen[] {
  const { segon } = env.google;
  return segon ? [origenPrincipal(), { id: "2", ...segon }] : [origenPrincipal()];
}

/** Las bosses de clientes ya leídas, y hasta cuándo valen. */
let bosses: { fins: number; llista: BossaClient[] } | null = null;

/** Olvida las bosses leídas: se han guardado clientes y la columna H puede haber cambiado. */
export function oblidarBosses(): void {
  bosses = null;
}

/**
 * Las bosses que salen de la columna H de "Clients" (ver lib/clients.ts).
 *
 * Se guardan un minuto: esto se pregunta en cada entrega que se escribe. Si
 * Google falla y hay una lista de antes, vale la de antes; si no hay ninguna
 * el error sube, que dar por buena una lista vacía mandaría las entregas de
 * esas bosses al documento de siempre.
 */
async function bossesClients(): Promise<BossaClient[]> {
  const doc = env.google.facturasSheetId;
  if (!doc) return [];
  if (bosses && Date.now() < bosses.fins) return bosses.llista;

  try {
    const data = (await sheetsFetch(
      `/values/${encodeURIComponent(range("A2:H", TAB_CLIENTS))}`,
      undefined,
      doc,
    ).catch((error: unknown) => {
      // Sin pestaña o sin acceso no hay bosses de clientes: es lo de siempre.
      if (/respondió (400|403|404)/.test(String(error))) return { values: [] };
      throw error;
    })) as { values?: unknown[][] };
    bosses = { fins: Date.now() + 60_000, llista: bossesDeClients(data.values ?? []) };
  } catch (error) {
    if (!bosses) throw error;
  }
  return bosses.llista;
}

/**
 * Los documentos de comandas: el de siempre, el segundo del entorno y uno
 * por cliente con hoja propia.
 */
export async function origens(): Promise<Origen[]> {
  const llista = origensFixos();
  for (const bossa of await bossesClients()) {
    /*
      La hoja de un cliente que ya es uno de los documentos del entorno (la
      de Bricomuebles en la H de Bricocentro) no es otra bossa: es decir de
      quién es ese documento. Se le pone el cliente y se sigue.
    */
    const fix = llista.find((o) => o.sheetId === bossa.sheetId && !o.client);
    if (fix && origensFixos().some((o) => o.id === fix.id)) {
      fix.client = bossa.client;
      continue;
    }
    // La misma hoja dos veces sacaría cada comanda en dos bosses.
    if (llista.some((o) => o.sheetId === bossa.sheetId || o.id === bossa.id)) {
      console.warn(`La bossa de "${bossa.nom}" repite hoja o id: no se enseña.`);
      continue;
    }
    llista.push({ ...bossa, sheetTab: null });
  }
  return llista;
}

/** El documento de una comanda, por el prefijo de su id. */
export async function origenDe(orderId: string): Promise<Origen> {
  const [principal, ...altres] = await origens();
  return altres.find((o) => orderId.startsWith(`${o.id}:`)) ?? principal;
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
 *
 * `full` es la pestaña elegida en la app, que es siempre una del documento
 * de siempre. El segundo documento tiene las suyas con otros nombres, así
 * que de ella solo se aprovecha el MES: mirando "JUL 26" se lee el julio
 * del segundo, se llame como se llame allí.
 */
export async function resolverPestanya(origen: Origen, full?: string | null): Promise<string> {
  if (origen.sheetTab) return origen.sheetTab;

  /*
    Qué mes se está mirando lo dice el documento de siempre, no el calendario.

    Cuando el móvil no manda ninguna pestaña —lo normal hasta que alguien
    elige un mes a mano—, cada documento resolvía su mes por su cuenta: "el
    de hoy, y si no lo tiene, el último". El día 1 del mes eso los separaba.
    La oficina todavía no había creado OCT 26 en su hoja, así que la bossa de
    siempre seguía en SET 26; pero la otra empresa, que lleva su propio
    documento, sí tenía su octubre, y su bossa se iba a OCT 26 ella sola.

    Y una comanda nueva en esa bossa se escribe en el mes del documento de
    siempre (ver `crearComanda`): caía en SET 26 mientras la pantalla leía
    OCT 26. Se apuntaba la comanda y no salía por ningún lado.

    Así que el segundo documento sigue al primero: un mes para los dos, el
    mismo que se escribe y el que se lee.
  */
  const ancora =
    full ?? (origen.id ? await resolverPestanya(origenPrincipal()) : null);

  const tabs = await listSheetTabs(origen.sheetId);
  const mes = (ancora && parseTabMonth(ancora)) || today(env.timezone).slice(0, 7);

  /*
    Qué pestaña toca lo decide `planDelFull`, que no habla con Google y se
    comprueba sin él. Aquí solo se hace lo que diga.

    `crea` es la novedad: el día que la oficina estrena octubre, la otra
    empresa estrena el suyo a la vez, con el mismo nombre y solo la cabecera.
    Antes esperaba a que alguien apuntara la primera comanda con su "+", y
    hasta entonces su bossa enseñaba las comandas de septiembre mientras la
    pantalla decía octubre.
  */
  const pla = planDelFull({
    tabs,
    mes,
    nom: ancora ?? null,
    avui: today(env.timezone).slice(0, 7),
    segon: origen.id !== "",
    // Solo las bosses de clientes: en el segundo del entorno, todo como estaba.
    sempre: !origensFixos().some((o) => o.id === origen.id),
  });
  if (pla.fes === "usa" || pla.fes === "enrere") return pla.full;
  if (pla.fes === "crea") {
    await assegurarPestanya(origen, pla.full);
    return pla.full;
  }

  /*
    Aquí solo se llega mirando un mes que allí no existe y que ya pasó, o con
    una pestaña forzada que no dice de qué mes es. No es un fallo de la app:
    se cuenta en su bossa —que es donde está su "+"— en vez de tumbar la ruta.
  */
  if (origen.id) {
    const quin = ancora && parseTabMonth(ancora) ? ancora : mes;
    throw new Error(
      `No hi ha el full de ${quin} a ${origen.nom}. Els mesos que ja han passat ` +
        `no es creen sols; crea'l a mà a la seva fulla si hi vols apuntar res.`,
    );
  }
  throw new Error(noTabFoundMessage(tabs, mes));
}

/**
 * Crea en el segundo documento la pestaña del mes de `full`, si no la tiene.
 *
 * Con el mismo nombre que la del documento de siempre y su misma fila de
 * cabecera —o la de su propio mes anterior, si tiene—. Solo la cabecera:
 * copiar la pestaña entera se llevaría las comandas de una empresa a la
 * hoja de la otra. Qué crear lo decide `pestanyaACrear`.
 */
export async function assegurarPestanya(origen: Origen, full: string): Promise<void> {
  const pla = pestanyaACrear(await listSheetTabs(origen.sheetId), full);
  if (!pla) return;

  const [de, pestanya] = pla.cabeceraDe
    ? [origen, pla.cabeceraDe]
    : [origenPrincipal(), full];
  const cabecera = (await sheetsFetch(
    `/values/${encodeURIComponent(range("1:1", pestanya))}`,
    undefined,
    de.sheetId,
  )) as { values?: unknown[][] };

  try {
    await sheetsFetch(
      ":batchUpdate",
      {
        method: "POST",
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                // La cabecera fija arriba, como en la de la oficina.
                properties: { title: pla.titol, gridProperties: { frozenRowCount: 1 } },
              },
            },
          ],
        }),
      },
      origen.sheetId,
    );
  } catch (error) {
    // Otra petición la acaba de crear: ya está, que es lo que se quería.
    if (String(error).includes("already exists")) return;
    throw error;
  }

  await sheetsFetch(
    `/values/${encodeURIComponent(range("A1", pla.titol))}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: [cabecera.values?.[0] ?? []] }) },
    origen.sheetId,
  );
  console.warn(`Creado el full "${pla.titol}" en "${origen.nom}".`);
}
