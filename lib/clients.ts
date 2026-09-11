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
