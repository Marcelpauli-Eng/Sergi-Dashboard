/**
 * Comprobación del registro privado de importes.
 *
 *   npm run check:importes
 *
 * Los importes de cada porte viven en la pestaña "Imports" del documento de
 * facturas, que NO comparte la empresa. Lo que se comprueba aquí es la
 * decisión: qué fila se actualiza y cuál se añade.
 *
 * Es donde están los fallos que importan. Dos filas para la misma comanda
 * dejan el importe bueno a suerte de cuál se lea primero, y de ahí sale una
 * factura mal — con el agravante de que nadie lo nota hasta que la cobra.
 */

import assert from "node:assert/strict";
import {
  CABECERA_IMPORTS,
  TAB_IMPORTS,
  parseImporteCelda,
  parseImportes,
  planImportes,
} from "../lib/importes.ts";

const AHORA = "26/08/2026 14:32";

// ── La pestaña ───────────────────────────────────────────────────────────
{
  assert.equal(TAB_IMPORTS, "Imports");
  assert.deepEqual(CABECERA_IMPORTS, ["Comanda", "Import", "Full", "Actualitzat"]);
}

// ── Una celda de dinero NO se lee como una de coordenadas ───────────────
// En dinero, "1.234,50" son mil doscientos treinta y cuatro con cincuenta.
// En una coordenada, "2.156" son 2,156 grados. Leer un importe con la regla
// de las coordenadas lo tira (`null`) y el precio se pierde en silencio.
{
  assert.equal(parseImporteCelda("1.234,50"), 1234.5);
  assert.equal(parseImporteCelda("80,00"), 80);
  assert.equal(parseImporteCelda("80.50"), 80.5, "el punto solo es decimal");
  assert.equal(parseImporteCelda("12.345.678"), 12345678);

  // Una celda que ya viene como número se coge tal cual: Google la devuelve
  // sin formatear y no hay nada que interpretar.
  assert.equal(parseImporteCelda(80.5), 80.5);
  assert.equal(parseImporteCelda(2.156), 2.156, "un número no se reinterpreta");
  assert.equal(parseImporteCelda(0), 0);

  assert.equal(parseImporteCelda(""), null);
  assert.equal(parseImporteCelda(null), null);
  assert.equal(parseImporteCelda(undefined), null);
  assert.equal(parseImporteCelda("pendiente"), null);
  assert.equal(parseImporteCelda(NaN), null);
}

// ── Leer la pestaña ──────────────────────────────────────────────────────
{
  const leidos = parseImportes([
    ["ALB-1042", "80,00", "AGO 26", AHORA],
    ["ALB-1043", 70.5, "AGO 26", AHORA],
    ["ALB-1044", "1.234,50", "AGO 26", AHORA],
  ]);
  assert.equal(leidos.get("ALB-1042"), 80);
  assert.equal(leidos.get("ALB-1043"), 70.5);
  assert.equal(leidos.size, 3);
}

// ── "Sin importe" no es "cero euros" ─────────────────────────────────────
// Guardar el vacío como 0 metería la comanda en la factura por 0 €, en vez
// de dejarla fuera hasta que se le ponga precio.
{
  const leidos = parseImportes([
    ["ALB-1042", "", "AGO 26", AHORA],
    ["ALB-1043", "80,00", "AGO 26", AHORA],
    ["", "99", "AGO 26", AHORA],
    ["ALB-1044", "lo que sea", "AGO 26", AHORA],
  ]);
  assert.equal(leidos.has("ALB-1042"), false, "una celda vacía se ha leído como importe");
  assert.equal(leidos.has("ALB-1044"), false, "un texto se ha leído como importe");
  assert.equal(leidos.size, 1);
  assert.equal(leidos.get("ALB-1043"), 80);
}

{
  assert.deepEqual([...parseImportes([])], []);
}

// ── Guardar por primera vez: filas nuevas ────────────────────────────────
{
  const plan = planImportes(
    [
      { orderId: "ALB-1042", price: 80, sheetTab: "AGO 26" },
      { orderId: "ALB-1043", price: 70.5, sheetTab: "AGO 26" },
    ],
    [],
    AHORA,
  );
  assert.equal(plan.actualizar.length, 0);
  // El importe como NÚMERO y el full como texto: la fila se escribe en
  // crudo, sin dejar que Google interprete nada. Ver `FilaImporte`.
  assert.deepEqual(plan.nuevas, [
    ["ALB-1042", 80, "AGO 26", AHORA],
    ["ALB-1043", 70.5, "AGO 26", AHORA],
  ]);
}

// ── Corregir uno ACTUALIZA su fila, no añade otra ────────────────────────
{
  const plan = planImportes(
    [{ orderId: "ALB-1043", price: 95.25, sheetTab: "AGO 26" }],
    ["ALB-1042", "ALB-1043", "ALB-1044"],
    AHORA,
  );
  assert.equal(plan.nuevas.length, 0, "se ha añadido una fila en vez de actualizar");
  assert.equal(plan.actualizar.length, 1);
  // Fila 3: la cabecera es la 1 y ALB-1043 es el segundo de la lista.
  assert.equal(plan.actualizar[0].fila, 3, "se actualizaría la fila equivocada");
  assert.deepEqual(plan.actualizar[0].valores, ["ALB-1043", 95.25, "AGO 26", AHORA]);
}

// ── Un lote con unos que están y otros que no ────────────────────────────
{
  const plan = planImportes(
    [
      { orderId: "ALB-1042", price: 10, sheetTab: "AGO 26" },
      { orderId: "ALB-9999", price: 20, sheetTab: "AGO 26" },
    ],
    ["ALB-1042"],
    AHORA,
  );
  assert.equal(plan.actualizar.length, 1);
  assert.equal(plan.actualizar[0].fila, 2);
  assert.equal(plan.nuevas.length, 1);
  assert.equal(plan.nuevas[0][0], "ALB-9999");
}

// ── La misma comanda dos veces en el mismo lote ──────────────────────────
// Pasa al deshacer una entrega y volver a marcarla antes de que suba la
// cola. No puede acabar en dos filas.
{
  const plan = planImportes(
    [
      { orderId: "ALB-9999", price: 10, sheetTab: "AGO 26" },
      { orderId: "ALB-9999", price: 20, sheetTab: "AGO 26" },
    ],
    [],
    AHORA,
  );
  assert.equal(plan.nuevas.length, 1, `han salido ${plan.nuevas.length} filas para la misma comanda`);
  assert.equal(plan.nuevas[0][1], 20, "no ha ganado la última");
}

{
  // Y si además ya existía, todas van a la misma fila.
  const plan = planImportes(
    [
      { orderId: "ALB-1042", price: 10, sheetTab: "AGO 26" },
      { orderId: "ALB-1042", price: 20, sheetTab: "AGO 26" },
    ],
    ["ALB-1042"],
    AHORA,
  );
  assert.equal(plan.nuevas.length, 0);
  assert.deepEqual(plan.actualizar.map((a) => a.fila), [2, 2]);
  assert.equal(plan.actualizar.at(-1)?.valores[1], 20);
}

// ── Borrar un importe deja la celda vacía ────────────────────────────────
// Es lo que hace el deshacer. Escribir "0,00" metería la comanda en la
// factura por cero euros.
{
  const plan = planImportes(
    [{ orderId: "ALB-1042", price: null, sheetTab: "AGO 26" }],
    ["ALB-1042"],
    AHORA,
  );
  assert.equal(plan.actualizar[0].valores[1], "", "borrar ha escrito un número");

  // Y lo que se escribe se vuelve a leer como "no hay importe".
  assert.equal(parseImportes([plan.actualizar[0].valores]).has("ALB-1042"), false);
}

// ── El formato es el de la hoja, y la ida y vuelta cuadra ────────────────
{
  const plan = planImportes(
    [
      { orderId: "A", price: 1234.5, sheetTab: null },
      { orderId: "B", price: 0, sheetTab: "AGO 26" },
      { orderId: "C", price: 0.05, sheetTab: "AGO 26" },
    ],
    [],
    AHORA,
  );
  assert.equal(plan.nuevas[0][1], 1234.5);
  assert.equal(plan.nuevas[0][2], "", "un full nulo tiene que quedar en blanco");
  assert.equal(plan.nuevas[1][1], 0, "cero euros SÍ es un importe");

  const leidos = parseImportes(plan.nuevas);
  assert.equal(leidos.get("A"), 1234.5);
  assert.equal(leidos.get("B"), 0, "un cero escrito tiene que leerse como cero");
  assert.equal(leidos.get("C"), 0.05);
}

// ── El nombre del full se guarda como nombre, no como fecha ─────────────
// "JUL 26" escrito dejando que Google interprete se convertía en el 26 de
// julio (un 46229) y el mes se perdía. La fila se escribe en crudo, así que
// aquí tampoco puede colarse ningún apaño de escape.
{
  for (const full of ["JUL 26", "AGO 26", "MARÇ", "2026-08", "1/2"]) {
    const plan = planImportes([{ orderId: "A", price: 1, sheetTab: full }], [], AHORA);
    assert.equal(plan.nuevas[0][2], full, `el full "${full}" se ha guardado tocado`);
  }
}

// ── Un lote vacío no propone nada ────────────────────────────────────────
{
  const plan = planImportes([], ["ALB-1042"], AHORA);
  assert.equal(plan.actualizar.length, 0);
  assert.equal(plan.nuevas.length, 0);
}

// ── Filas en blanco en medio no descuadran los números de fila ───────────
{
  const plan = planImportes(
    [{ orderId: "ALB-1044", price: 5, sheetTab: "AGO 26" }],
    ["ALB-1042", "", "ALB-1044"],
    AHORA,
  );
  assert.equal(plan.actualizar[0].fila, 4);
}

console.log("✓ lib/importes.ts — los importes van al documento privado, una fila por comanda");
