/**
 * Los avisos al cliente: qué pasos hay y qué se le dice en cada uno.
 *
 * El mensaje sale del móvil de empresa por WhatsApp o SMS (ver `whatsappHref`
 * en lib/format.ts), así que aquí no hay envío: solo el texto. Aritmética
 * pura, comprobada en `scripts/check-format.mts`.
 */

import type { Stop } from "./types.ts";

/** En el orden en que pasan. El índice es lo que decide el paso siguiente. */
export const PASSOS = [
  { id: "rebuda", nom: "Comanda rebuda" },
  { id: "fabrica", nom: "Ha sortit de fàbrica" },
  { id: "cami", nom: "En camí" },
  { id: "10min", nom: "Arribem en 10 minuts" },
  { id: "lliurat", nom: "Lliurat" },
] as const;

export type Pas = (typeof PASSOS)[number]["id"];

/**
 * El registro de avisos: pestaña "Avisos" del documento privado, junto a
 * "Imports". Una fila por aviso mandado, para poder mirar qué se le dijo a
 * cada cliente y cuándo. El transporte está en `writeAvisos` (lib/sheets.ts).
 */
export const TAB_AVISOS = "Avisos";

/** El orden manda. "Id" va la última: es para la app, no para leerla. */
export const CABECERA_AVISOS = ["Data i hora", "Comanda", "Client", "Telèfon", "Pas", "Missatge", "Full", "Id"];

export interface AvisEntrada {
  /** El `clientId` del registro de la cola: lo que impide duplicar al reintentar. */
  clientId: string;
  /** Ya formateada en la zona horaria de la hoja. */
  quan: string;
  codi: string;
  customer: string;
  phone: string | null;
  pas: Pas;
  text: string;
  sheetTab: string | null;
}

/**
 * Las filas a añadir: las de este lote menos las que ya estén en la pestaña.
 *
 * Es la única escritura de la cola que AÑADE en vez de reescribir. Todo lo
 * demás es idempotente porque reenviar pisa las mismas celdas con lo mismo;
 * aquí un reintento tras un timeout —escrito, pero sin respuesta— metería el
 * aviso dos veces. `idsExistents` es la columna "Id" tal cual se lee.
 */
export function filesAvisos(avisos: AvisEntrada[], idsExistents: string[]): string[][] {
  const vistos = new Set(idsExistents);
  const files: string[][] = [];
  for (const a of avisos) {
    if (vistos.has(a.clientId)) continue;
    vistos.add(a.clientId);
    files.push([a.quan, a.codi, a.customer, a.phone ?? "", nomPas(a.pas), a.text, a.sheetTab ?? "", a.clientId]);
  }
  return files;
}

/**
 * Cuándo se avisó cada paso de una comanda (ISO, del momento de pulsar
 * enviar). Vive en el móvil: ver `getAvisos` en lib/sync.ts.
 */
export type AvisosComanda = Partial<Record<Pas, string>>;

/**
 * Lo guardado en el móvil, ya con la forma de ahora.
 *
 * La primera versión guardaba solo el último aviso, `{ pas, at }`, y así
 * no había manera de enseñar a qué hora salió cada paso. Lo que quedara
 * guardado así se convierte en vez de tirarse.
 */
export function normalitzarAvisos(guardat: Record<string, unknown>): Record<string, AvisosComanda> {
  const avisos: Record<string, AvisosComanda> = {};
  for (const [comanda, valor] of Object.entries(guardat)) {
    const antic = valor as { pas?: Pas; at?: string };
    avisos[comanda] =
      antic.pas && antic.at ? { [antic.pas]: antic.at } : (valor as AvisosComanda);
  }
  return avisos;
}

/**
 * El paso más avanzado que se ha avisado.
 *
 * Por el orden de los pasos y no por la hora: si se reenvía "Comanda
 * rebuda" después de "En camí", el pedido sigue en camino.
 */
export function ultimPas(avisos: AvisosComanda | undefined): Pas | undefined {
  return PASSOS.findLast((p) => avisos?.[p.id])?.id;
}

/** El que toca: el siguiente al último que se mandó, o el primero si no hay ninguno. */
export function pasProposat(ultim: Pas | undefined): Pas {
  const i = PASSOS.findIndex((p) => p.id === ultim);
  return PASSOS[Math.min(i + 1, PASSOS.length - 1)].id;
}

export function nomPas(pas: Pas): string {
  return PASSOS.find((p) => p.id === pas)?.nom ?? pas;
}

/**
 * El texto que le llega al cliente, en castellano y firmado con la empresa.
 *
 * `empresa` es el emisor de Ajustes > Facturació; vacío si no se ha puesto,
 * y entonces el mensaje va sin firma.
 */
export function missatge(pas: Pas, stop: Pick<Stop, "customer" | "codi">, empresa: string): string {
  const hola = stop.customer ? `Hola, ${stop.customer}. ` : "Hola. ";
  const firma = empresa ? `\n— ${empresa}` : "";

  // La hora de "Lliurat" es la de abrir la hoja, que es cuando se entrega.
  const ara = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const textos: Record<Pas, string> = {
    rebuda: `${hola}Hemos recibido tu pedido ${stop.codi}. Te avisaremos en cada paso.`,
    fabrica: `${hola}Tu pedido ${stop.codi} ha salido de fábrica.`,
    cami: `${hola}Tu pedido ${stop.codi} ya está en camino.`,
    "10min": "Estamos a 10 minutos. ¿Hay alguien para recibirlo?",
    lliurat: `Pedido ${stop.codi} entregado a las ${ara}. ¡Gracias${stop.customer ? `, ${stop.customer}` : ""}!`,
  };

  return textos[pas] + firma;
}
