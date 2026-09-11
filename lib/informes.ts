/**
 * Las cuentas de un full: cuánto se ha facturado, cuántas comandas, a cómo
 * sale cada una.
 *
 * Vive aparte de la pantalla porque las hace el servidor —comparar doce
 * meses son doce lecturas de Google, y mandar todas las comandas al
 * navegador para que sume allí es tirar ancho de banda— y también el
 * navegador, para el full que está abierto, que sale de lo que ya hay en
 * IndexedDB y así refleja lo que acabas de escribir sin esperar a nada.
 *
 * Sin dependencias de servidor ni de React a propósito: ver
 * `scripts/check-informes.mts`.
 */

/** Lo mínimo que hace falta saber de una comanda para contarla. */
export interface ComandaResumible {
  statusCategory: "pendent" | "en_curs" | "entregat" | "incidencia";
  price: number | null;
  /** Fecha de reparto, `YYYY-MM-DD`. Vacía si todavía no tiene día. */
  date: string;
}

export interface ResumFull {
  /** Nombre de la pestaña. */
  full: string;
  total: number;
  entregats: number;
  incidencies: number;
  pendents: number;
  /** Entregadas que ya tienen importe puesto. */
  ambImport: number;
  /** Entregadas a las que todavía les falta el importe. */
  senseImport: number;
  /** Suma de los importes de las entregadas. */
  facturat: number;
  /** Por entrega con importe. `0` si no hay ninguna. */
  mitjana: number;
  /** Días distintos con alguna entrega. */
  diesTreballats: number;
  /** Facturado por día trabajado. `0` si no se trabajó ningún día. */
  mitjanaPerDia: number;
}

/** Un resumen vacío, para un full que no se ha podido leer. */
export function resumBuit(full: string): ResumFull {
  return {
    full,
    total: 0,
    entregats: 0,
    incidencies: 0,
    pendents: 0,
    ambImport: 0,
    senseImport: 0,
    facturat: 0,
    mitjana: 0,
    diesTreballats: 0,
    mitjanaPerDia: 0,
  };
}

export function resumirFull(full: string, comandas: ComandaResumible[]): ResumFull {
  const resum = resumBuit(full);
  resum.total = comandas.length;

  const dies = new Set<string>();

  for (const c of comandas) {
    switch (c.statusCategory) {
      case "entregat": {
        resum.entregats++;
        // Un importe de cero no es "cobrado cero", es que no se ha puesto:
        // lo pone el transportista al entregar y por defecto va en blanco.
        if (c.price !== null && c.price > 0) {
          resum.ambImport++;
          resum.facturat += c.price;
        } else {
          resum.senseImport++;
        }
        if (c.date) dies.add(c.date);
        break;
      }
      case "incidencia":
        resum.incidencies++;
        break;
      default:
        resum.pendents++;
    }
  }

  // Se redondea a céntimos al final y no a cada suma: sumar cien importes en
  // coma flotante deja una cola de decimales que luego se ve en pantalla.
  resum.facturat = Math.round(resum.facturat * 100) / 100;
  resum.diesTreballats = dies.size;
  resum.mitjana =
    resum.ambImport > 0 ? Math.round((resum.facturat / resum.ambImport) * 100) / 100 : 0;
  resum.mitjanaPerDia =
    dies.size > 0 ? Math.round((resum.facturat / dies.size) * 100) / 100 : 0;

  return resum;
}

/** Lo que suman varios fulls juntos. */
export function totalizar(mesos: ResumFull[]): ResumFull {
  const total = resumBuit("Total");
  const dies = mesos.reduce((n, m) => n + m.diesTreballats, 0);

  for (const m of mesos) {
    total.total += m.total;
    total.entregats += m.entregats;
    total.incidencies += m.incidencies;
    total.pendents += m.pendents;
    total.ambImport += m.ambImport;
    total.senseImport += m.senseImport;
    total.facturat += m.facturat;
  }

  total.facturat = Math.round(total.facturat * 100) / 100;
  total.diesTreballats = dies;
  total.mitjana =
    total.ambImport > 0 ? Math.round((total.facturat / total.ambImport) * 100) / 100 : 0;
  total.mitjanaPerDia = dies > 0 ? Math.round((total.facturat / dies) * 100) / 100 : 0;

  return total;
}

/**
 * Cuánto sube o baja un mes respecto al anterior, en tanto por ciento.
 *
 * `null` cuando no hay con qué comparar: el primer mes de la lista, o uno
 * detrás de otro que facturó cero. Un "+∞ %" no informa de nada.
 */
export function variacio(actual: number, anterior: number): number | null {
  if (anterior === 0) return null;
  return Math.round(((actual - anterior) / anterior) * 1000) / 10;
}
