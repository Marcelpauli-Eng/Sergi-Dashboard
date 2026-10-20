/**
 * L'avís de final de prova, per als clients que el fan servir de prova.
 *
 * El servidor de programes (`servidor.sh fin <client> <data>`) deixa
 * FIN_PRUEBA=AAAA-MM-DD al .env del client, que arriba a l'entorn del
 * contenidor. La darrera setmana i després surt una franja a dalt. Només
 * avisa: l'app funciona igual abans i després de la data. Sense FIN_PRUEBA,
 * o amb una data mal escrita, no surt res: un avís no pot tombar l'app.
 */

import { addDays, type DateString } from "./dates.ts";

/** Des de quants dies abans s'avisa (el mateix que el panell del servidor). */
export const DIES_AVIS = 7;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export function avisProva(fi: string | null | undefined, avui: DateString): string | null {
  const data = fi?.trim();
  if (!data || !DATA.test(data) || addDays(data, 0) !== data) return null;
  const dies = Math.round((Date.parse(data) - Date.parse(avui)) / 86_400_000);
  if (dies > DIES_AVIS) return null;
  const quan = new Intl.DateTimeFormat("ca-ES", { day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(`${data}T00:00:00Z`));
  if (dies < 0) return `La teva prova de Reparto va acabar el ${quan}. Avisa'ns si vols continuar fent-lo servir.`;
  const termini = dies === 0 ? "avui" : dies === 1 ? "demà" : `d'aquí a ${dies} dies`;
  return `La teva prova de Reparto s'acaba ${termini} (el ${quan}). Si vols continuar fent-lo servir, avisa'ns abans d'aquesta data.`;
}
