/**
 * Comprobación de las fechas del tema de temporada.
 *
 *   npm run check:tema
 *
 * Lo que se rompe son los bordes: el 1 de octubre ya es Halloween, el 1 de
 * noviembre todavía, el 2 ya no. Y `TEMA` en el entorno manda sobre la fecha
 * en las dos direcciones.
 */

import assert from "node:assert/strict";
import { temaDelDia } from "../lib/tema.ts";

assert.equal(temaDelDia("2026-09-30"), "classic");
assert.equal(temaDelDia("2026-10-01"), "halloween", "empieza el 1 de octubre");
assert.equal(temaDelDia("2026-10-31"), "halloween");
assert.equal(temaDelDia("2026-11-01"), "halloween", "Todos los Santos todavía cuenta");
assert.equal(temaDelDia("2026-11-02"), "classic", "el 2 de noviembre vuelve la de siempre");
assert.equal(temaDelDia("2027-01-15"), "classic");
assert.equal(temaDelDia("2027-10-01"), "halloween", "cada año vuelve sola");

assert.equal(temaDelDia("2026-10-15", "classic"), "classic", "TEMA=classic lo quita antes de tiempo");
assert.equal(temaDelDia("2026-06-15", "halloween"), "halloween", "TEMA=halloween lo pone fuera de fecha");
assert.equal(temaDelDia("2026-06-15", "si"), "classic", "otro valor no fuerza nada");

console.log("✓ lib/tema.ts — Halloween del 1 de octubre al 1 de noviembre");
