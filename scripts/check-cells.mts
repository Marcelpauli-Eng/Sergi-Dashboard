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
  filaNovaComanda,
  fusionarBulto,
  parseNumber,
  parsePriority,
  parseStatus,
  parseStatusCategory,
  text,
} from "../lib/sheet-cells.ts";
import type { Order } from "../lib/types.ts";
import type { ColumnKey } from "../lib/sheet-schema.ts";

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

// ── Las comandas de varios bultos ────────────────────────────────────────
// La oficina escribe un bulto por FILA: la primera lleva la dirección y el
// cliente, y las demás solo las medidas, con el mismo nº de comanda. Son
// una sola entrega. Antes se descartaban por "ID duplicado" y con ellas se
// iban las medidas de los otros paquetes: en JUL 26 de la hoja real, la
// comanda C260601098 ocupa cuatro filas y el transportista veía una.
{
  const comanda = (extra: Partial<Order>): Order => ({
    id: "C260601098",
    driverId: "",
    creationDate: null,
    date: "",
    priority: NO_PRIORITY,
    customer: "",
    address: "",
    city: null,
    billingClient: null,
    phone: null,
    measures: null,
    notes: null,
    bultos: 1,
    deliveredTime: null,
    incidentNote: null,
    status: "pendiente",
    rawStatus: "",
    statusCategory: "pendent",
    price: null,
    lat: null,
    lng: null,
    placeId: null,
  geoLevel: null,
    rowNumber: 58,
    rowNumbers: [58],
    ...extra,
  });

  const base = comanda({
    customer: "PAU MANENT",
    address: "AV. DE LA MARE DE DEU DE MONTSERRAT, 34",
    city: "08024 BARCELONA",
    phone: "615 99 68 92",
    measures: "100 x 110 x 138 cm",
    lat: 41.413,
    lng: 2.162,
    placeId: null,
  geoLevel: null,
  });

  let junta = base;
  for (const [i, mides] of ["100 x 80 x 133 cm", "150 x 110 x 190 cm", "220 x 80 x 200 cm"].entries()) {
    junta = fusionarBulto(junta, comanda({ measures: mides, rowNumber: 59 + i, rowNumbers: [59 + i] }));
  }

  assert.equal(junta.bultos, 4, "el transportista no sabría cuántos paquetes carga");
  assert.deepEqual(junta.rowNumbers, [58, 59, 60, 61], "no se marcarían todas las filas");
  assert.equal(
    junta.measures,
    "100 x 110 x 138 cm · 100 x 80 x 133 cm · 150 x 110 x 190 cm · 220 x 80 x 200 cm",
  );

  // Lo de la comanda manda; el bulto solo rellena huecos.
  assert.equal(junta.customer, "PAU MANENT");
  assert.equal(junta.address, "AV. DE LA MARE DE DEU DE MONTSERRAT, 34");
  assert.equal(junta.phone, "615 99 68 92");
  assert.equal(junta.lat, 41.413);
}

// Un bulto que trae un dato que a la comanda le falta, lo rellena.
{
  const vacia = (extra: Partial<Order>): Order => ({
    id: "C1", driverId: "", creationDate: null, date: "", priority: NO_PRIORITY,
    customer: "", address: "A", city: null, billingClient: null, phone: null,
    measures: null, notes: null, bultos: 1, deliveredTime: null, incidentNote: null,
    status: "pendiente", rawStatus: "", statusCategory: "pendent", price: null,
    lat: null, lng: null, placeId: null, geoLevel: null, rowNumber: 2, rowNumbers: [2], ...extra,
  });

  const junta = fusionarBulto(
    vacia({ measures: "1 palet" }),
    vacia({ customer: "TANCAL", phone: "674123106", priority: 10, date: "2026-07-14", rowNumber: 3, rowNumbers: [3] }),
  );
  assert.equal(junta.customer, "TANCAL", "un hueco tiene que rellenarse");
  assert.equal(junta.phone, "674123106");
  assert.equal(junta.date, "2026-07-14");
  // Un "Urgent" en cualquier bulto sube la comanda entera: mismo viaje.
  assert.equal(junta.priority, 10, "la prioridad más alta manda");
  // Y el estado NO se toca: una fila pendiente deja la parada en la ruta.
  assert.equal(junta.statusCategory, "pendent");
}

// ── La fila de una comanda creada a mano ─────────────────────────────────
// Cada dato va a SU columna, y en la hoja real no están en orden: el nº de
// comanda es la G y el cliente la B. Si un hueco entre columnas se escribe
// como agujero en vez de como celda vacía, `append` corre todo lo de la
// derecha una columna: el teléfono acabaría en la del estado de la entrega.
{
  // El mapa de la hoja real de JUL 26.
  const real: Partial<Record<string, number>> = {
    creationDate: 0, customer: 1, address: 2, city: 3, phone: 4,
    measures: 5, id: 6, priority: 8, status: 9, notes: 12,
  };

  const fila = filaNovaComanda(
    {
      id: "C260700999X",
      customer: "TALLERS PRAT",
      city: "08500 Vic",
      phone: "650 11 22 33",
      creationDate: "12/09/2026",
      notes: "Trucar abans",
    },
    real as Partial<Record<ColumnKey, number>>,
  );

  assert.equal(fila[6], "C260700999X", "el nº de comanda no cae en su columna");
  assert.equal(fila[1], "TALLERS PRAT");
  assert.equal(fila[3], "08500 Vic");
  assert.equal(fila[4], "650 11 22 33");
  assert.equal(fila[0], "12/09/2026");
  assert.equal(fila[12], "Trucar abans");
  assert.equal(fila.length, 13);
  // Los huecos, vacíos de verdad y no agujeros.
  for (const i of [2, 5, 7, 8, 9, 10, 11]) {
    assert.equal(fila[i], "", `la columna ${i} tendría que ir vacía`);
    assert.equal(i in fila, true, `la columna ${i} es un agujero, no una celda`);
  }
}

// Lo que la hoja no tiene, no se escribe; y lo vacío tampoco.
{
  const fila = filaNovaComanda(
    { id: "A-1", customer: "  ", notes: "hola", driverId: "sergi" },
    { id: 0, customer: 1, notes: 2 },
  );
  assert.deepEqual(fila, ["A-1", "", "hola"], "un campo vacío o sin columna se ha colado");
}

console.log("✓ lib/sheet-cells.ts — las celdas se leen como las escribe la oficina");
