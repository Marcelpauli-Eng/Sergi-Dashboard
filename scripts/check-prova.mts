/**
 * Comprovació de l'avís de final de prova.
 *
 *   npm run check:prova
 *
 * El que es trenca són les vores: a 8 dies no surt, a 7 sí; avui, demà i
 * després de la data, cadascun amb el seu text. I una data dolenta no surt.
 */

import assert from "node:assert/strict";
import { avisProva } from "../lib/prova.ts";

assert.equal(avisProva(undefined, "2026-12-01"), null, "sense FIN_PRUEBA no surt res");
assert.equal(avisProva("", "2026-12-01"), null);
assert.equal(avisProva("dimarts", "2026-12-01"), null, "una data mal escrita no tomba l'app");
assert.equal(avisProva("2026-02-30", "2026-02-01"), null, "ni una que no existeix");
assert.equal(avisProva("2026-12-19", "2026-12-11"), null, "a 8 dies encara no");
assert.match(avisProva("2026-12-19", "2026-12-12")!, /d'aquí a 7 dies \(el 19 de desembre\)/);
assert.match(avisProva("2026-12-19", "2026-12-18")!, /s'acaba demà/);
assert.match(avisProva(" 2026-12-19 ", "2026-12-19")!, /s'acaba avui/);
assert.match(avisProva("2026-12-19", "2027-01-03")!, /va acabar el 19 de desembre/);

console.log("✓ lib/prova.ts — l'avís de final de prova, la darrera setmana i després");
