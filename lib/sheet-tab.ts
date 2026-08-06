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
  const normalized = tabs.map((tab) => ({ tab, key: normalizeHeader(tab) }));

  // 1. Mes + año. Ante varias coincidencias gana la más específica
  //    ("Octubre 2024" por delante de un hipotético "102024" suelto).
  let best: { tab: string; length: number } | null = null;
  for (const needle of monthTabNeedles(month)) {
    for (const { tab, key } of normalized) {
      if (key.includes(needle) && (best === null || needle.length > best.length)) {
        best = { tab, length: needle.length };
      }
    }
  }
  if (best) return best.tab;

  // 2. Solo el nombre del mes, sin año. Válido únicamente si no hay
  //    ambigüedad: con pestañas de varios años, "Octubre" no basta.
  const monthIndex = Number(month.split("-")[1]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;

  const words = monthWords(monthIndex);
  const matches = normalized.filter(({ key }) =>
    words.some((word) => key.includes(word)),
  );
  return matches.length === 1 ? matches[0].tab : null;
}

/** Mensaje de error con la lista de pestañas, para que se vea qué hay. */
export function noTabFoundMessage(tabs: string[], month: string): string {
  return (
    `No se ha encontrado ninguna pestaña para ${month} en el documento.\n` +
    `Pestañas disponibles: ${tabs.map((t) => `"${t}"`).join(", ")}\n\n` +
    "Crea la pestaña de este mes con un nombre que lo incluya " +
    '(por ejemplo "Agost 2026" o "08/2026"), o define GOOGLE_SHEET_TAB ' +
    "con el nombre exacto de la pestaña que quieras usar."
  );
}
