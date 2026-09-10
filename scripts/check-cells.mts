/**
 * Comprobación de cómo se lee una celda del Sheet.
 *
 *   npm run check:cells
 *
 * Es la frontera con el mundo real: la oficina rellena la hoja a mano y
 * escribe "Entregat", "ENTREGADO", "x" o "Sí" según el día. Si aquí se
 * interpreta mal una celda, una parada entregada reaparece en la ruta o —
 * peor — una pendiente desaparece de ella sin que nadie se entere.
 */

import assert from "node:assert/strict";
import {
  NO_PRIORITY,
  columnLetter,
  parseNumber,
  parsePriority,
  parseStatus,
  parseStatusCategory,
  text,
} from "../lib/sheet-cells.ts";

// ── Letra de columna ─────────────────────────────────────────────────────
// Decide en qué celda se escribe. Equivocarse aquí es escribir el estado de
// la entrega encima de otra columna.
{
  assert.equal(columnLetter(0), "A");
  assert.equal(columnLetter(25), "Z");
  // El salto a dos letras: no es "AA" = 26 en base 26, la A no vale cero.
  assert.equal(columnLetter(26), "AA");
  assert.equal(columnLetter(27), "AB");
  assert.equal(columnLetter(51), "AZ");
  assert.equal(columnLetter(52), "BA");
  assert.equal(columnLetter(701), "ZZ");
  assert.equal(columnLetter(702), "AAA");
}

// ── Texto ────────────────────────────────────────────────────────────────
{
  assert.equal(text("  hola  "), "hola");
  assert.equal(text(null), "");
  assert.equal(text(undefined), "");
  assert.equal(text(0), "0", "un cero es un cero, no una celda vacía");
  assert.equal(text(false), "false");
}

// ── Números ──────────────────────────────────────────────────────────────
{
  // La coma decimal es como escribe la oficina.
  assert.equal(parseNumber("12,50"), 12.5);
  assert.equal(parseNumber("12.50"), 12.5);
  assert.equal(parseNumber(80), 80);
  assert.equal(parseNumber(0), 0, "cero es un número, no un vacío");

  // Lo que no es número no puede convertirse en uno.
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber(null), null);
  assert.equal(parseNumber(undefined), null);
  assert.equal(parseNumber("Urgent"), null);
  assert.equal(parseNumber("--"), null);
}

// ── Prioridad ────────────────────────────────────────────────────────────
// La hoja la escribe en número o en palabra, y la palabra tiene que contar:
// un "Urgent" que no se entiende manda la parada al final de la ruta.
{
  assert.equal(parsePriority(1), 1);
  assert.equal(parsePriority("3"), 3);

  for (const urgente of ["Urgent", "urgente", "URGENTE", "Alta", "Alt"]) {
    assert.equal(parsePriority(urgente), 10, `"${urgente}" tendría que ser urgente`);
  }
  for (const normal of ["Normal", "MEDIA", "Mitja"]) {
    assert.equal(parsePriority(normal), 20, `"${normal}" tendría que ser normal`);
  }
  for (const baja of ["Baixa", "baja", "BAIX"]) {
    assert.equal(parsePriority(baja), 30, `"${baja}" tendría que ser baja`);
  }

  // Y el orden entre ellas es el que dice el nombre.
  assert.ok(parsePriority("Urgent") < parsePriority("Normal"));
  assert.ok(parsePriority("Normal") < parsePriority("Baixa"));
  assert.ok(parsePriority("Baixa") < parsePriority(""), "sin prioridad va la última");

  // Vacío o ilegible: al final, nunca por delante.
  assert.equal(parsePriority(""), NO_PRIORITY);
  assert.equal(parsePriority(null), NO_PRIORITY);
  assert.equal(parsePriority("lo que sea"), NO_PRIORITY);
}

// ── Estado de la entrega ─────────────────────────────────────────────────
{
  // Vacío es pendiente: es como está la hoja antes de tocar nada.
  assert.equal(parseStatus(""), "pendiente");
  assert.equal(parseStatus(null), "pendiente");

  for (const v of ["Entregat", "ENTREGADO", "entregada", "Sí", "si", "OK", "x", "1", "true"]) {
    assert.equal(parseStatus(v), "entregado", `"${v}" tendría que ser entregado`);
  }
  for (const v of ["Incidència", "INCIDENCIA", "Ausente", "Rebutjat", "No entregat", "ko"]) {
    assert.equal(parseStatus(v), "incidencia", `"${v}" tendría que ser incidencia`);
  }

  // Lo que no se reconoce se queda pendiente: mejor una parada de más en la
  // ruta que una que desaparece.
  assert.equal(parseStatus("Recollir"), "pendiente");
  assert.equal(parseStatus("Entregat -"), "pendiente");
}

// ── Categoría de la pantalla ─────────────────────────────────────────────
{
  assert.equal(parseStatusCategory(""), "pendent");
  assert.equal(parseStatusCategory("Entregat"), "entregat");
  assert.equal(parseStatusCategory("Incidència"), "incidencia");

  // Lo que solo distingue la categoría: un reparto empezado sigue abierto.
  for (const v of ["En curs", "EN CURSO", "En camino", "en ruta"]) {
    assert.equal(parseStatusCategory(v), "en_curs", `"${v}" tendría que estar en curso`);
  }
}

// ── Las dos lecturas del estado no pueden contradecirse ──────────────────
// Son dos funciones con dos listas, y la pantalla usa una y el Sheet la
// otra. Si divergen, una parada sale entregada en un sitio y pendiente en
// el otro. "En curs" es la única diferencia buscada: para el Sheet todavía
// no hay nada que escribir.
{
  const valores = [
    "", "Entregat", "ENTREGADO", "entregada", "si", "Sí", "OK", "x", "1", "true",
    "Incidència", "Ausente", "Rebutjat", "no entregat", "ko",
    "En curs", "en ruta", "Recollir", "cualquier cosa", null, undefined,
  ];
  const equivalente = { pendiente: "pendent", entregado: "entregat", incidencia: "incidencia" };
  for (const v of valores) {
    const categoria = parseStatusCategory(v);
    if (categoria === "en_curs") {
      assert.equal(parseStatus(v), "pendiente", `"${v}" en curso tiene que ser pendiente para el Sheet`);
      continue;
    }
    assert.equal(
      equivalente[parseStatus(v)],
      categoria,
      `"${v}" se lee distinto en la pantalla que en el Sheet`,
    );
  }
}

console.log("✓ lib/sheet-cells.ts — las celdas se leen como las escribe la oficina");
