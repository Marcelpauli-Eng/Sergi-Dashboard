/**
 * Comprobación de la aritmética de fechas del calendario.
 *
 *   npm run check:dates
 *
 * Un día del calendario no es un instante. Todo el cálculo va en UTC sobre
 * strings `YYYY-MM-DD` justo para que no dependa de la hora ni de la zona,
 * y estos casos son los que se rompen si alguien lo cambia por objetos Date
 * locales: el domingo (que en JavaScript es el día 0 de la semana) y las
 * semanas a caballo entre dos meses.
 */

import assert from "node:assert/strict";
import { getWeekGrid, getMonthGrid } from "../lib/dates.ts";

// ── La semana va de lunes a domingo ──────────────────────────────────────
{
  // Miércoles 26 de agosto de 2026.
  const semana = getWeekGrid("2026-08-26");
  assert.equal(semana.length, 7);
  assert.equal(semana[0], "2026-08-24", "la semana tiene que empezar el lunes");
  assert.equal(semana[6], "2026-08-30", "la semana tiene que acabar el domingo");
}

// ── El domingo cae en la semana que YA ha empezado ───────────────────────
{
  // Es el caso que rompe: getUTCDay() del domingo es 0, no 7.
  assert.equal(getWeekGrid("2026-08-30")[0], "2026-08-24");
  assert.equal(getWeekGrid("2026-08-24")[0], "2026-08-24", "el lunes es su propio lunes");
}

// ── Una semana a caballo entre dos meses sigue siendo siete días seguidos ─
{
  assert.deepEqual(getWeekGrid("2026-09-01"), [
    "2026-08-31",
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-05",
    "2026-09-06",
  ]);
}

// ── Y entre dos años ─────────────────────────────────────────────────────
{
  assert.deepEqual(getWeekGrid("2027-01-01"), [
    "2026-12-28",
    "2026-12-29",
    "2026-12-30",
    "2026-12-31",
    "2027-01-01",
    "2027-01-02",
    "2027-01-03",
  ]);
}

// ── El mes sigue cuadrando en semanas enteras ────────────────────────────
{
  for (const [year, month] of [[2026, 2], [2026, 8], [2028, 2], [2027, 1]] as [number, number][]) {
    const grid = getMonthGrid(year, month);
    assert.equal(grid.length % 7, 0, `${year}-${month} no cuadra en semanas enteras`);
    assert.deepEqual(
      getWeekGrid(grid[0]),
      grid.slice(0, 7),
      `la primera fila de ${year}-${month} no es una semana de lunes a domingo`,
    );
  }
}

console.log("✓ lib/dates.ts — semanas y meses cuadran");
