/**
 * A quién hay que llamar, y de qué día.
 *
 * El cliente prepara las comandas para el día siguiente, así que las
 * llamadas se hacen la víspera: hay que poder llamar a las comandas de
 * MAÑANA estando en el día de hoy. Hasta ahora el teléfono solo estaba a
 * mano en las paradas de la ruta del día —el resto había que ir a buscarlas
 * al calendario, día por día, y abrir cada ficha.
 *
 * Aquí están las cuentas y nada más, sin React y sin localStorage, para
 * poder comprobarlas: ver `scripts/check-trucades.mts`. La pantalla está en
 * `components/trucades.tsx` y lo que se recuerda de cada llamada, en
 * `lib/sync.ts` junto al resto de preferencias del móvil.
 */

import { addDays } from "./dates.ts";

/** Lo poco que hace falta de una comanda para saber si hay que llamar. */
export interface ComandaTrucable {
  id: string;
  /** Día de reparto. "" cuando todavía no tiene ninguno. */
  date: string;
  phone: string | null;
  statusCategory: "pendent" | "en_curs" | "entregat" | "incidencia";
}

export interface DiaTrucades<T> {
  /** "" son las que no tienen día asignado. */
  date: string;
  comandas: T[];
}

/** Una comanda cerrada ya no se llama: o se entregó, o tuvo incidencia. */
function estaOberta(comanda: ComandaTrucable): boolean {
  return comanda.statusCategory === "pendent" || comanda.statusCategory === "en_curs";
}

/**
 * Los días que tienen algo que llamar, del más antiguo al más reciente.
 *
 * Entran también los días que ya pasaron —una comanda que se quedó atrás
 * sigue necesitando una llamada, y a veces es justo la que más— y al final
 * las que no tienen día, que son las que hay que llamar precisamente para
 * ponérselo.
 *
 * Las que no tienen teléfono se quedan igualmente: que no se pueda llamar es
 * un dato, y esconderlas haría creer que ese día está resuelto.
 */
export function diesPerTrucar<T extends ComandaTrucable>(comandas: T[]): DiaTrucades<T>[] {
  const perDia = new Map<string, T[]>();

  for (const comanda of comandas) {
    if (!estaOberta(comanda)) continue;
    const cola = perDia.get(comanda.date);
    if (cola) cola.push(comanda);
    else perDia.set(comanda.date, [comanda]);
  }

  return [...perDia.entries()]
    .map(([date, llista]) => ({ date, comandas: llista }))
    .sort((a, b) => {
      // "Sense dia" al final: no es un día, es un cajón.
      if (a.date === "") return 1;
      if (b.date === "") return -1;
      return a.date.localeCompare(b.date);
    });
}

/**
 * Qué día se enseña al entrar.
 *
 * Mañana, porque es la víspera lo que se llama. Si mañana no hay nada, el
 * primer día de hoy en adelante que tenga algo; y si tampoco, lo primero que
 * haya —comandas atrasadas o sin día—, que sigue siendo trabajo pendiente.
 */
export function diaPerDefecte<T>(dies: DiaTrucades<T>[], avui: string): string | null {
  if (dies.length === 0) return null;

  const dema = addDays(avui, 1);
  if (dies.some((dia) => dia.date === dema)) return dema;

  const proper = dies.find((dia) => dia.date !== "" && dia.date >= avui);
  return proper ? proper.date : dies[0].date;
}

export interface ResumTrucades {
  total: number;
  /** Cuántas se pueden llamar. */
  ambTelefon: number;
  senseTelefon: number;
  trucats: number;
  /** Las que quedan: tienen teléfono y todavía no se han llamado. */
  perTrucar: number;
}

/**
 * Cómo va un día.
 *
 * `trucades` es lo que se ha ido marcando en este móvil: comanda → cuándo se
 * llamó.
 */
export function resumTrucades<T extends ComandaTrucable>(
  comandas: T[],
  trucades: Readonly<Record<string, string>>,
): ResumTrucades {
  let ambTelefon = 0;
  let trucats = 0;
  let perTrucar = 0;

  for (const comanda of comandas) {
    const teTelefon = (comanda.phone ?? "").trim() !== "";
    const trucada = trucades[comanda.id] !== undefined;
    if (teTelefon) ambTelefon++;
    if (trucada) trucats++;
    if (teTelefon && !trucada) perTrucar++;
  }

  return {
    total: comandas.length,
    ambTelefon,
    senseTelefon: comandas.length - ambTelefon,
    trucats,
    perTrucar,
  };
}

/**
 * Cómo se llama un día en los botones: "Avui", "Demà", "dv. 12 set".
 *
 * Los tres de alrededor con su nombre porque son los que se usan; el resto
 * con la fecha, que es lo único que los distingue.
 */
export function etiquetaDia(date: string, avui: string, locale = "es-ES"): string {
  if (date === "") return "Sense dia";
  if (date === avui) return "Avui";
  if (date === addDays(avui, 1)) return "Demà";
  if (date === addDays(avui, -1)) return "Ahir";

  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
