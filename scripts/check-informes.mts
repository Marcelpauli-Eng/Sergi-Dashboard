/**
 * Comprobación de las cuentas de los informes.
 *
 *   npm run check:informes
 *
 * Son los números que se miran para decidir qué se cobra y si un mes ha ido
 * mejor que el anterior. Un error aquí no da ningún fallo visible: da una
 * cifra creíble y equivocada, que es peor.
 *
 * Las mismas cuentas las hace el servidor (para los fulls que se comparan) y
 * el navegador (para el full abierto), así que tienen que salir idénticas
 * vengan de donde vengan.
 */

import assert from "node:assert/strict";
import {
  resumBuit,
  resumirFull,
  totalizar,
  variacio,
  type ComandaResumible,
} from "../lib/informes.ts";

const c = (
  statusCategory: ComandaResumible["statusCategory"],
  price: number | null,
  date = "2026-08-26",
): ComandaResumible => ({ statusCategory, price, date });

// ── Un full vacío ────────────────────────────────────────────────────────
{
  const r = resumirFull("AGO 26", []);
  assert.equal(r.full, "AGO 26");
  assert.equal(r.total, 0);
  assert.equal(r.facturat, 0);
  assert.equal(r.mitjana, 0, "sin entregas la media es cero, no NaN");
  assert.equal(r.mitjanaPerDia, 0);
  assert.deepEqual(r, resumBuit("AGO 26"));
}

// ── Las cuentas de un mes normal ─────────────────────────────────────────
{
  const r = resumirFull("AGO 26", [
    c("entregat", 80, "2026-08-26"),
    c("entregat", 70, "2026-08-26"),
    c("entregat", 50, "2026-08-27"),
    c("incidencia", null),
    c("pendent", null),
    c("en_curs", null),
  ]);

  assert.equal(r.total, 6);
  assert.equal(r.entregats, 3);
  assert.equal(r.incidencies, 1);
  assert.equal(r.pendents, 2, "'en curs' cuenta como pendiente: sigue abierta");
  assert.equal(r.facturat, 200);
  assert.equal(r.ambImport, 3);
  // 200 / 3 son 66,666… y en euros eso son 66,67.
  assert.equal(r.mitjana, 66.67);
  assert.equal(r.diesTreballats, 2, "dos días distintos con entregas");
  assert.equal(r.mitjanaPerDia, 100);
}

// ── "Sin importe" no es "cero euros" ─────────────────────────────────────
// Una entregada sin precio no puede tirar la media hacia abajo: todavía no
// se sabe lo que vale, no es que valga cero.
{
  const r = resumirFull("AGO 26", [
    c("entregat", 100),
    c("entregat", null),
    c("entregat", 0),
  ]);
  assert.equal(r.entregats, 3);
  assert.equal(r.ambImport, 1);
  assert.equal(r.senseImport, 2, "un importe de cero es 'sin poner'");
  assert.equal(r.facturat, 100);
  assert.equal(r.mitjana, 100, "la media es entre las que SÍ tienen importe");
}

// ── Solo cuentan los días de las entregadas ──────────────────────────────
// Una pendiente asignada a un día que aún no ha llegado no es un día
// trabajado; contarla hundiría el "por día".
{
  const r = resumirFull("AGO 26", [
    c("entregat", 100, "2026-08-26"),
    c("pendent", null, "2026-08-27"),
    c("pendent", null, "2026-08-28"),
  ]);
  assert.equal(r.diesTreballats, 1);
  assert.equal(r.mitjanaPerDia, 100);
}

// ── Una entregada sin día no inventa un día ──────────────────────────────
{
  const r = resumirFull("AGO 26", [c("entregat", 60, ""), c("entregat", 40, "2026-08-26")]);
  assert.equal(r.diesTreballats, 1);
  assert.equal(r.facturat, 100);
  assert.equal(r.mitjanaPerDia, 100);
}

// ── Los céntimos no arrastran cola ───────────────────────────────────────
// Sumar en coma flotante deja decimales que luego se ven en pantalla.
{
  const r = resumirFull("AGO 26", [c("entregat", 0.1), c("entregat", 0.2)]);
  assert.equal(r.facturat, 0.3, `0,1 + 0,2 ha dado ${r.facturat}`);
  assert.equal(r.mitjana, 0.15);
}

// ── Los totales de varios fulls ──────────────────────────────────────────
{
  const agost = resumirFull("AGO 26", [
    c("entregat", 80, "2026-08-26"),
    c("entregat", 20, "2026-08-27"),
  ]);
  const juliol = resumirFull("JUL 26", [
    c("entregat", 100, "2026-07-01"),
    c("entregat", null, "2026-07-02"),
    c("incidencia", null),
  ]);

  const total = totalizar([juliol, agost]);
  assert.equal(total.facturat, 200);
  assert.equal(total.entregats, 4);
  assert.equal(total.incidencies, 1);
  assert.equal(total.ambImport, 3);
  assert.equal(total.senseImport, 1);
  assert.equal(total.mitjana, 66.67, "la media global es sobre el total, no la media de medias");
  assert.equal(total.diesTreballats, 4);
  assert.equal(total.mitjanaPerDia, 50);
}

{
  // Sin fulls, ceros y no NaN.
  const total = totalizar([]);
  assert.equal(total.facturat, 0);
  assert.equal(total.mitjana, 0);
  assert.equal(total.mitjanaPerDia, 0);
}

// ── La variación entre meses ─────────────────────────────────────────────
{
  assert.equal(variacio(150, 100), 50);
  assert.equal(variacio(50, 100), -50);
  assert.equal(variacio(100, 100), 0);
  assert.equal(variacio(133.33, 100), 33.3, "un decimal basta");

  // Detrás de un mes a cero no hay porcentaje que valga: "+∞ %" no informa.
  assert.equal(variacio(100, 0), null);
  assert.equal(variacio(0, 0), null);
  assert.equal(variacio(0, 100), -100);
}

console.log("✓ lib/informes.ts — las cuentas de cada full y la comparativa entre ellos");
