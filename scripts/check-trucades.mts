/**
 * Comprobación de las llamadas de la víspera.
 *
 *   npm run check:trucades
 *
 * El cliente prepara las comandas para el día siguiente y el transportista
 * llama la tarde de antes. Lo que se comprueba aquí es que la pantalla
 * ofrezca el día que toca —mañana— y que no dé por resuelto un día que
 * todavía tiene gente a la que llamar.
 */

import assert from "node:assert/strict";
import {
  diaPerDefecte,
  diesPerTrucar,
  etiquetaDia,
  resumTrucades,
  type ComandaTrucable,
} from "../lib/trucades.ts";

const AVUI = "2026-09-11";

const comanda = (extra: Partial<ComandaTrucable> & { id: string }): ComandaTrucable => ({
  date: "",
  phone: "600 11 22 33",
  statusCategory: "pendent",
  ...extra,
});

// ── Los días que hay que llamar ──────────────────────────────────────────
{
  const dies = diesPerTrucar([
    comanda({ id: "A", date: "2026-09-12" }),
    comanda({ id: "B", date: "2026-09-11" }),
    comanda({ id: "C", date: "2026-09-12" }),
    comanda({ id: "D", date: "" }),
    comanda({ id: "E", date: "2026-09-09" }),
  ]);

  assert.deepEqual(
    dies.map((d) => d.date),
    ["2026-09-09", "2026-09-11", "2026-09-12", ""],
    "los días no salen en orden, o 'sense dia' no está al final",
  );
  assert.deepEqual(dies[2].comandas.map((c) => c.id), ["A", "C"]);
}

// ── Una comanda cerrada no se llama ──────────────────────────────────────
// Ya se entregó o ya hubo incidencia: llamar para avisar de una entrega que
// ya está hecha es peor que no llamar.
{
  const dies = diesPerTrucar([
    comanda({ id: "A", date: "2026-09-12", statusCategory: "entregat" }),
    comanda({ id: "B", date: "2026-09-12", statusCategory: "incidencia" }),
    comanda({ id: "C", date: "2026-09-12", statusCategory: "en_curs" }),
  ]);
  assert.equal(dies.length, 1);
  assert.deepEqual(dies[0].comandas.map((c) => c.id), ["C"], "en curs sí se llama");
}

// Un día entero entregado desaparece de la lista, no sale vacío.
{
  assert.deepEqual(
    diesPerTrucar([comanda({ id: "A", date: "2026-09-12", statusCategory: "entregat" })]),
    [],
  );
}

// ── Al entrar se enseña MAÑANA ───────────────────────────────────────────
// Es el día que se llama: el cliente prepara la comanda la víspera.
{
  const dies = diesPerTrucar([
    comanda({ id: "A", date: "2026-09-11" }),
    comanda({ id: "B", date: "2026-09-12" }),
    comanda({ id: "C", date: "2026-09-15" }),
  ]);
  assert.equal(diaPerDefecte(dies, AVUI), "2026-09-12", "no se abre por el día que se llama");
}

// Si mañana no hay nada, el siguiente día que tenga algo.
{
  const dies = diesPerTrucar([
    comanda({ id: "A", date: "2026-09-11" }),
    comanda({ id: "B", date: "2026-09-15" }),
  ]);
  assert.equal(diaPerDefecte(dies, AVUI), "2026-09-11", "hoy también cuenta");

  const soloFuturo = diesPerTrucar([comanda({ id: "B", date: "2026-09-15" })]);
  assert.equal(diaPerDefecte(soloFuturo, AVUI), "2026-09-15");
}

// Y si solo quedan atrasadas o sin día, se abre por ahí: sigue habiendo
// trabajo, y esconderlo es lo que hizo que nadie las mirara.
{
  const atrasadas = diesPerTrucar([comanda({ id: "A", date: "2026-09-09" })]);
  assert.equal(diaPerDefecte(atrasadas, AVUI), "2026-09-09");

  const senseDia = diesPerTrucar([comanda({ id: "A", date: "" })]);
  assert.equal(diaPerDefecte(senseDia, AVUI), "");

  assert.equal(diaPerDefecte([], AVUI), null, "sin nada que llamar no hay día");
}

// ── Cuántas quedan ───────────────────────────────────────────────────────
{
  const comandas = [
    comanda({ id: "A" }),
    comanda({ id: "B" }),
    comanda({ id: "C", phone: null }),
    comanda({ id: "D", phone: "   " }),
  ];

  const sinLlamar = resumTrucades(comandas, {});
  assert.deepEqual(sinLlamar, {
    total: 4,
    ambTelefon: 2,
    senseTelefon: 2,
    trucats: 0,
    perTrucar: 2,
  });

  // Una llamada marcada sale de "por llamar".
  const conUna = resumTrucades(comandas, { A: "2026-09-11T18:05:00.000Z" });
  assert.equal(conUna.trucats, 1);
  assert.equal(conUna.perTrucar, 1);

  // Sin teléfono no cuenta como pendiente de llamar: no se puede llamar.
  const todas = resumTrucades(comandas, {
    A: "2026-09-11T18:05:00.000Z",
    B: "2026-09-11T18:06:00.000Z",
  });
  assert.equal(todas.perTrucar, 0, "el día tiene que poder darse por hecho");
  assert.equal(todas.senseTelefon, 2);
}

// ── Cómo se llama cada día ───────────────────────────────────────────────
{
  assert.equal(etiquetaDia(AVUI, AVUI), "Avui");
  assert.equal(etiquetaDia("2026-09-12", AVUI), "Demà");
  assert.equal(etiquetaDia("2026-09-10", AVUI), "Ahir");
  assert.equal(etiquetaDia("", AVUI), "Sense dia");
  // Uno cualquiera lleva su fecha, que es lo único que lo distingue.
  assert.match(etiquetaDia("2026-09-15", AVUI), /15/);

  // Cambios de mes y de año, que es donde un cálculo de días se rompe.
  assert.equal(etiquetaDia("2026-10-01", "2026-09-30"), "Demà");
  assert.equal(etiquetaDia("2027-01-01", "2026-12-31"), "Demà");
  assert.equal(etiquetaDia("2026-02-28", "2026-03-01"), "Ahir");
}

console.log("✓ lib/trucades.ts — las llamadas de la víspera, día a día");
