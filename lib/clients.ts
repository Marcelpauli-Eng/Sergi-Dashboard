/**
 * A quién se le factura, guardado en el documento privado.
 *
 * Hasta ahora los clientes vivían solo en el móvil, en `localStorage`: cada
 * teléfono tenía los suyos, cambiar de móvil los perdía y dos dispositivos
 * podían estar facturando a direcciones distintas sin que nadie se enterara.
 * Ahora viven en la pestaña "Clients" del mismo documento que las facturas y
 * los importes —el privado, el que no ve la empresa—, con los mismos campos
 * que el emisor.
 *
 * El móvil se queda con una copia para poder componer la factura sin
 * cobertura; la del documento manda.
 *
 * Aquí no hay red: solo qué columna es cada cosa y cómo se lee y se escribe
 * una fila. Se comprueba con `scripts/check-clients.mts`; el transporte está
 * en `lib/sheets.ts`.
 */

import type { ClienteFacturacion } from "./factura.ts";
import { text } from "./sheet-cells.ts";
import { sheetIdFrom } from "./sheet-tab.ts";

export const TAB_CLIENTS = "Clients";

/** El orden manda: es el de las columnas A a G de la pestaña. */
export const CABECERA_CLIENTS = [
  "Codi",
  "Nom",
  "NIF",
  "Adreça",
  "CP",
  "Població",
  "Província",
];

/**
 * Una fila tal y como se escribe en la hoja.
 *
 * Todo va con apóstrofo delante, que fuerza TEXTO. Sin él Sheets se toma la
 * libertad de interpretar: un código postal como "08940" se convierte en el
 * número 8940 y pierde el cero, y un código de cliente como "03" pasa a ser
 * un 3. Aquí no hay ni un campo con el que se haga una cuenta, así que texto
 * todos y no hay que ir pensando cuál se salva.
 */
export function clientAFila(client: ClienteFacturacion): string[] {
  return [
    client.codigo,
    client.nombre,
    client.nif,
    client.direccion,
    client.cp,
    client.poblacion,
    client.provincia,
  ].map((valor) => (valor === "" ? "" : `'${valor}`));
}

/**
 * Un cliente a partir de su fila.
 *
 * Sin nombre no es un cliente: una fila así es una que alguien empezó y dejó
 * a medias, y colarla en la lista solo sirve para que salga un cliente en
 * blanco en el desplegable de la factura.
 */
export function filaAClient(fila: unknown[]): ClienteFacturacion | null {
  const nombre = text(fila[1]);
  if (nombre === "") return null;

  return {
    codigo: text(fila[0]),
    nombre,
    nif: text(fila[2]),
    direccion: text(fila[3]),
    cp: text(fila[4]),
    poblacion: text(fila[5]),
    provincia: text(fila[6]),
  };
}

/**
 * Los clientes de la pestaña, en el orden en que están.
 *
 * El orden importa: el primero es el de por defecto, el que se lleva las
 * comandas que no digan a quién se facturan —que hoy son todas—.
 */
export function parseClients(filas: unknown[][]): ClienteFacturacion[] {
  const clients: ClienteFacturacion[] = [];
  for (const fila of filas) {
    const client = filaAClient(fila);
    if (client !== null) clients.push(client);
  }
  return clients;
}

/* ── La bossa de cada cliente ───────────────────────────────────────────── */

/**
 * Columna H: la hoja de comandas de ese cliente, URL o ID.
 *
 * La rellena el programador a mano, en el documento. La app no la enseña en
 * ninguna pantalla: quien usa la app no tiene por qué saber que hay hojas.
 * Con ella puesta, ese cliente tiene su propia bossa en el calendario.
 */
export const COL_FULL = 7;

export interface BossaClient {
  /** Lo que va delante del id de sus comandas. Ver `idDeBossa`. */
  id: string;
  nom: string;
  sheetId: string;
}

/**
 * El identificador de la bossa de un cliente.
 *
 * Va delante del id de cada comanda suya —"<id>:748"— y de ahí se saca a
 * qué documento se escribe su entrega (ver `origenDe` en lib/sheets.ts).
 *
 * Sale de la hoja y no del cliente: el código y el nombre se cambian desde
 * Ajustes, y con entregas en la cola del móvil un id que cambia las manda a
 * buscar al documento equivocado. La hoja es la misma mientras sea la misma.
 * Solo el principio, que el id entero es largo y va en cada comanda; dos que
 * coincidan los descarta `origens`.
 */
export function idDeBossa(sheetId: string): string {
  return sheetId.replace(/[^\w-]/g, "").slice(0, 10);
}

/** Las bosses que salen de la pestaña: una por cliente con la columna H puesta. */
export function bossesDeClients(filas: unknown[][]): BossaClient[] {
  const bosses: BossaClient[] = [];
  for (const fila of filas) {
    const client = filaAClient(fila);
    const full = text(fila[COL_FULL]);
    if (client === null || full === "") continue;
    const sheetId = sheetIdFrom(full);
    bosses.push({ id: idDeBossa(sheetId), nom: client.nombre, sheetId });
  }
  return bosses;
}

/**
 * La columna H de cada cliente de la lista nueva, sacada de las filas de antes.
 *
 * Guardar los clientes reescribe el bloque entero, y borrar o reordenar uno
 * dejaría cada hoja en la fila de otro cliente: sus comandas con el nombre
 * equivocado. Se busca por código y, si no, por nombre.
 */
export function fullsDe(antigues: unknown[][], clients: ClienteFacturacion[]): string[] {
  const perCodi = new Map<string, string>();
  const perNom = new Map<string, string>();
  for (const fila of antigues) {
    const full = text(fila[COL_FULL]);
    if (full === "") continue;
    if (text(fila[0]) !== "") perCodi.set(text(fila[0]), full);
    perNom.set(text(fila[1]), full);
  }
  // ponytail: cambiar código y nombre a la vez pierde el enlace y la bossa
  // desaparece; se vuelve a pegar la URL en la H. Un id oculto por fila si pasa.
  return clients.map((c) => perCodi.get(c.codigo) ?? perNom.get(c.nombre) ?? "");
}
