/**
 * Elección automática de la pestaña del mes en curso.
 *
 * La hoja de la oficina tiene una pestaña por mes ("Octubre 2024",
 * "Novembre 2024"…), así que apuntar `GOOGLE_SHEET_TAB` a una en concreto
 * obligaría a cambiar la variable de entorno —y a redesplegar— cada día 1.
 * En vez de eso, la app pregunta a Google qué pestañas hay y elige la que
 * corresponde a hoy.
 *
 * Deliberadamente no impone un formato de nombre: reconoce el mes escrito en
 * catalán o castellano, entero o abreviado, con el año de dos o cuatro
 * cifras, y también en forma numérica. Pedirle a la oficina que renombre 22
 * pestañas sería la forma más rápida de que esto dejara de funcionar.
 *
 * `GOOGLE_SHEET_TAB`, si se define, manda: es la vía de escape para cuando
 * haga falta apuntar a una pestaña concreta.
 */

// Con extensión .ts a propósito: scripts/check-sheet.mts importa este módulo
// y lo ejecuta Node directamente, que exige la extensión explícita. Ver la
// nota de "allowImportingTsExtensions" en tsconfig.json.
import { normalizeHeader } from "./sheet-schema.ts";

/** Meses en catalán y castellano, de enero (índice 0) a diciembre. */
const MONTH_NAMES: readonly (readonly string[])[] = [
  ["gener", "enero"],
  ["febrer", "febrero"],
  ["marc", "marzo"], // "març" pierde la cedilla al normalizar
  ["abril", "abril"],
  ["maig", "mayo"],
  ["juny", "junio"],
  ["juliol", "julio"],
  ["agost", "agosto"],
  ["setembre", "septiembre", "setiembre"],
  ["octubre", "octubre"],
  ["novembre", "noviembre"],
  ["desembre", "diciembre"],
];

/**
 * Nombres normalizados que identifican un mes sin decir de qué año es.
 * Incluye la abreviatura de tres letras ("oct", "des"), habitual en pestañas.
 */
function monthWords(monthIndex: number): string[] {
  const words = new Set<string>();
  for (const name of MONTH_NAMES[monthIndex]) {
    words.add(name);
    words.add(name.slice(0, 3));
  }
  return [...words];
}

/**
 * Textos que, encontrados dentro del nombre de una pestaña, la identifican
 * como la de este mes Y este año. Se devuelven para poder mostrarlos en el
 * mensaje de error cuando no hay ninguna coincidencia.
 */
export function monthTabNeedles(month: string): string[] {
  const [year, mm] = month.split("-");
  const monthIndex = Number(mm) - 1;
  if (!year || Number.isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return [];
  }

  const year2 = year.slice(2);
  const needles = new Set<string>();

  for (const word of monthWords(monthIndex)) {
    needles.add(word + year);
    needles.add(word + year2);
    // "2024 Octubre" además de "Octubre 2024".
    needles.add(year + word);
  }

  // Formas numéricas: 10/2024, 2024-10, 10-24.
  needles.add(mm + year);
  needles.add(year + mm);
  needles.add(mm + year2);

  return [...needles];
}

/**
 * Busca entre `tabs` la pestaña correspondiente a `month` ("YYYY-MM").
 *
 * Devuelve `null` si no encuentra ninguna, o si el nombre del mes aparece en
 * varias y no hay forma de decidir. Nunca adivina: es preferible un error
 * explicando qué pestañas hay que leer la del mes equivocado.
 */
export function findMonthTab(tabs: string[], month: string): string | null {
  const entries = tabs.map((tab) => ({
    tab,
    key: normalizeHeader(tab),
    month: parseTabMonth(tab),
  }));

  // 1. La pestaña dice explícitamente este mes de este año.
  const exact = entries.find((entry) => entry.month === month);
  if (exact) return exact.tab;

  // Una pestaña que declara otro mes queda descartada para los intentos
  // laxos que vienen: "Agost 2025" no puede ser el agosto de 2026 por mucho
  // que comparta el nombre del mes.
  const undated = entries.filter((entry) => entry.month === null);

  // 2. Formas que identifican el mes pero que no sabemos fechar por sí
  //    solas, como "08-26".
  let best: { tab: string; length: number } | null = null;
  for (const needle of monthTabNeedles(month)) {
    for (const { tab, key } of undated) {
      if (key.includes(needle) && (best === null || needle.length > best.length)) {
        best = { tab, length: needle.length };
      }
    }
  }
  if (best) return best.tab;

  // 3. Solo el nombre del mes, sin año. Válido únicamente si no hay
  //    ambigüedad: con dos pestañas "Octubre" sueltas no hay forma de saber.
  const monthIndex = Number(month.split("-")[1]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;

  const words = monthWords(monthIndex);
  const matches = undated.filter(({ key }) =>
    words.some((word) => key.includes(word)),
  );
  return matches.length === 1 ? matches[0].tab : null;
}

function isYear(value: number): boolean {
  return value >= 2000 && value <= 2099;
}

/** El año que aparezca entre las cifras del nombre: 2026, o 26 → 2026. */
function yearFrom(digitRuns: string[]): number | null {
  const long = digitRuns.find((run) => run.length === 4 && isYear(Number(run)));
  if (long) return Number(long);
  const short = digitRuns.find((run) => run.length === 2);
  return short ? 2000 + Number(short) : null;
}

function stamp(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * De qué mes es una pestaña, deducido de su nombre. Devuelve "YYYY-MM", o
 * `null` si el nombre no dice mes y año (una pestaña "Resum" o "Històric").
 *
 * Es lo que permite ordenar las pestañas por antigüedad sin depender de en
 * qué orden las tenga colocadas la oficina dentro del documento.
 */
export function parseTabMonth(title: string): string | null {
  const key = normalizeHeader(title);
  const digitRuns = key.match(/\d+/g) ?? [];

  // 1. Nombre del mes. Gana la palabra más larga: en "marc" no debe decidir
  //    la abreviatura "mar", ni "juny" resolverse como "jun" de otro mes.
  let monthIndex = -1;
  let matched = 0;
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    for (const word of monthWords(i)) {
      if (key.includes(word) && word.length > matched) {
        monthIndex = i;
        matched = word.length;
      }
    }
  }

  if (monthIndex >= 0) {
    const year = yearFrom(digitRuns);
    // Sin año no se puede situar en el tiempo: "Octubre" a secas es
    // ambiguo en un documento que abarca dos años.
    return year === null ? null : stamp(year, monthIndex + 1);
  }

  // 2. Forma numérica de seis cifras: 202410 (2024-10) o 102024 (10/2024).
  const run = digitRuns.find((d) => d.length === 6);
  if (run) {
    const yearFirst = Number(run.slice(0, 4));
    const monthLast = Number(run.slice(4));
    if (isYear(yearFirst) && monthLast >= 1 && monthLast <= 12) {
      return stamp(yearFirst, monthLast);
    }
    const yearLast = Number(run.slice(2));
    const monthFirst = Number(run.slice(0, 2));
    if (isYear(yearLast) && monthFirst >= 1 && monthFirst <= 12) {
      return stamp(yearLast, monthFirst);
    }
  }

  return null;
}

/**
 * La pestaña más reciente que no sea posterior a `month`.
 *
 * Es la red de seguridad para cuando aún no se ha creado la del mes nuevo:
 * más vale seguir leyendo la de julio —donde simplemente no habrá pedidos
 * con fecha de hoy— que dejar la app muerta el día 1 hasta que alguien se
 * acuerde de crear la pestaña.
 */
export function findLatestTabUpTo(tabs: string[], month: string): string | null {
  let best: { tab: string; month: string } | null = null;

  for (const tab of tabs) {
    const tabMonth = parseTabMonth(tab);
    if (tabMonth === null || tabMonth > month) continue;
    if (best === null || tabMonth > best.month) best = { tab, month: tabMonth };
  }

  return best?.tab ?? null;
}

/** Mensaje de error con la lista de pestañas, para que se vea qué hay. */
export function noTabFoundMessage(tabs: string[], month: string): string {
  return (
    `No se ha encontrado ninguna pestaña para ${month} en el documento,\n` +
    "ni ninguna anterior de la que tirar.\n" +
    `Pestañas disponibles: ${tabs.map((t) => `"${t}"`).join(", ")}\n\n` +
    "Crea la pestaña de este mes con un nombre que lo incluya " +
    '(por ejemplo "Agost 2026" o "08/2026"), o define GOOGLE_SHEET_TAB ' +
    "con el nombre exacto de la pestaña que quieras usar."
  );
}
