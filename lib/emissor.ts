/**
 * Quién emite la factura, guardado en el documento privado.
 *
 * Vive en la pestaña "Emissor", al lado de "Clients", por lo mismo que ella:
 * es un dato de la empresa y no del teléfono. Cambiar de móvil no puede
 * perder el NIF con el que se factura, y dos dispositivos no pueden estar
 * emitiendo con domicilios distintos.
 *
 * Una sola fila: emisor no hay más que uno. Se comprueba con
 * `scripts/check-facturacio.mts`; el transporte está en `lib/sheets.ts`.
 */

import type { DatosFacturacion } from "./factura.ts";
import { text } from "./sheet-cells.ts";

export type Emissor = DatosFacturacion["emisor"];

export const TAB_EMISSOR = "Emissor";

/** El orden manda: es el de las columnas A a G de la pestaña. */
export const CABECERA_EMISSOR = [
  "Nom",
  "NIF",
  "Adreça",
  "CP",
  "Població",
  "Província",
  "Telèfon",
];

/**
 * La fila tal y como se escribe.
 *
 * Todo texto, con apóstrofo delante, por lo mismo que en los clientes: un CP
 * como "08458" perdería el cero, y un teléfono como "938451529" se
 * convertiría en un número con el que nadie va a hacer cuentas.
 */
export function emissorAFila(emissor: Emissor): string[] {
  return [
    emissor.nombre,
    emissor.nif,
    emissor.direccion,
    emissor.cp,
    emissor.poblacion,
    emissor.provincia,
    emissor.telefono,
  ].map((valor) => (valor === "" ? "" : `'${valor}`));
}

/**
 * El emisor a partir de su fila.
 *
 * Sin nombre no hay emisor: la pestaña recién creada tiene la cabecera y
 * nada debajo, y eso no es un emisor en blanco, es que todavía no se ha
 * guardado ninguno. Quien llama se queda entonces con el suyo.
 */
export function filaAEmissor(fila: unknown[] | undefined): Emissor | null {
  if (!fila) return null;
  const nombre = text(fila[0]);
  if (nombre === "") return null;

  return {
    nombre,
    nif: text(fila[1]),
    direccion: text(fila[2]),
    cp: text(fila[3]),
    poblacion: text(fila[4]),
    provincia: text(fila[5]),
    telefono: text(fila[6]),
  };
}
