/**
 * Comprobación de la cola de salida.
 *
 *   npm run check:outbox
 *
 * `applyOutbox` es lo que hace que la pantalla enseñe lo que acabas de hacer
 * antes de que llegue al Google Sheet. Si se equivoca, el transportista ve un
 * estado que no es ni el de antes ni el de después — y como el resultado se
 * guarda en IndexedDB, el error sobrevive a cerrar la app.
 *
 * Lo que se comprueba es lo que rompió: una comanda con VARIAS acciones
 * encoladas (entregarla y luego corregir el importe, o entregarla y
 * deshacerlo) tiene que acabar como la última, no como una al azar.
 */

import assert from "node:assert/strict";
import { applyOutbox } from "../lib/outbox.ts";
import type { Manifest, Stop } from "../lib/types.ts";

const parada = (extra: Partial<Stop> = {}): Stop => ({
  id: "ALB-1",
  driverId: "sergi",
  creationDate: null,
  date: "2026-08-26",
  priority: 1,
  customer: "Farmàcia Sant Pau",
  address: "Carrer Gran 1",
  city: null,
  billingClient: null,
  phone: null,
  measures: null,
  notes: null,
  status: "pendiente",
  rawStatus: "",
  statusCategory: "pendent",
  price: null,
  lat: null,
  lng: null,
  sequence: 1,
  navUrl: "",
  legDistanceMeters: null,
  legDurationSeconds: null,
  ...extra,
});

const manifiesto = (stop: Stop): Manifest => ({
  driverId: "sergi",
  driverName: "Sergi",
  generatedAt: "2026-08-26T08:00:00.000Z",
  sheetTab: "AGO 26",
  today: {
    date: "2026-08-26",
    stops: [stop],
    optimized: false,
    fullRouteUrl: null,
    totalDistanceMeters: null,
    totalDurationSeconds: null,
  },
  tomorrow: null,
});

let n = 0;
const item = (extra: Record<string, unknown>) =>
  ({
    clientId: `id-${++n}`,
    orderId: "ALB-1",
    syncedAt: null,
    attempts: 0,
    lastError: null,
    ...extra,
  }) as Parameters<typeof applyOutbox>[1][number];

const resultado = (items: Parameters<typeof applyOutbox>[1], inicial = parada()) =>
  applyOutbox(manifiesto(inicial), items).today.stops[0];

// ── Una sola acción ──────────────────────────────────────────────────────
{
  const s = resultado([
    item({ type: "status", status: "entregado", price: 80, recordedAt: "2026-08-26T10:00:00.000Z" }),
  ]);
  assert.equal(s.statusCategory, "entregat");
  assert.equal(s.price, 80);
}

// ── Entregar y DESPUÉS corregir el importe ───────────────────────────────
// Es el caso que se perdía: quedaban dos acciones para la misma comanda y
// solo se aplicaba una.
{
  const s = resultado([
    item({ type: "status", status: "entregado", price: 80, recordedAt: "2026-08-26T10:00:00.000Z" }),
    item({ type: "price", price: 95.25, recordedAt: "2026-08-26T10:05:00.000Z" }),
  ]);
  assert.equal(s.price, 95.25, "el importe corregido no se ha aplicado");
  assert.equal(s.statusCategory, "entregat", "corregir el importe no puede desentregar la comanda");
}

// ── Y da igual en qué orden salgan de la base de datos ───────────────────
// Dexie las devuelve ordenadas por su clave, que es un UUID: el orden real
// lo pone `recordedAt`.
{
  const s = resultado([
    item({ type: "price", price: 95.25, recordedAt: "2026-08-26T10:05:00.000Z" }),
    item({ type: "status", status: "entregado", price: 80, recordedAt: "2026-08-26T10:00:00.000Z" }),
  ]);
  assert.equal(s.price, 95.25, "no se está respetando el orden de los registros");
  assert.equal(s.statusCategory, "entregat");
}

// ── Corregir el importe dos veces: manda la última ───────────────────────
{
  const s = resultado([
    item({ type: "status", status: "entregado", price: 80, recordedAt: "2026-08-26T10:00:00.000Z" }),
    item({ type: "price", price: 95.25, recordedAt: "2026-08-26T10:05:00.000Z" }),
    item({ type: "price", price: 12.5, recordedAt: "2026-08-26T10:09:00.000Z" }),
  ]);
  assert.equal(s.price, 12.5);
}

// ── Entregar y deshacer ──────────────────────────────────────────────────
{
  const s = resultado([
    item({ type: "status", status: "entregado", price: 80, recordedAt: "2026-08-26T10:00:00.000Z" }),
    item({ type: "status", status: "pendiente", price: null, recordedAt: "2026-08-26T10:00:20.000Z" }),
  ]);
  assert.equal(s.statusCategory, "pendent", "deshacer no ha devuelto la comanda a pendiente");
  assert.equal(s.price, null, "deshacer tiene que dejar el importe como estaba");
  assert.equal(s.rawStatus, "");
}

// ── Mover de día y entregar ──────────────────────────────────────────────
{
  const s = resultado([
    item({ type: "date", date: "2026-08-28", recordedAt: "2026-08-26T09:00:00.000Z" }),
    item({ type: "status", status: "incidencia", recordedAt: "2026-08-26T09:30:00.000Z" }),
  ]);
  assert.equal(s.date, "2026-08-28");
  assert.equal(s.statusCategory, "incidencia");
}

// ── Una entrega sin importe no borra el que ya hubiera ───────────────────
// Aquí un nulo significa "no lo toques", al revés que al deshacer.
{
  const s = resultado(
    [item({ type: "status", status: "entregado", price: null, recordedAt: "2026-08-26T10:00:00.000Z" })],
    parada({ price: 40 }),
  );
  assert.equal(s.price, 40);
}

// ── Las comandas que no están en la cola no se tocan ─────────────────────
{
  const s = resultado([
    item({ orderId: "OTRA", type: "status", status: "entregado", recordedAt: "2026-08-26T10:00:00.000Z" }),
  ]);
  assert.equal(s.statusCategory, "pendent");
  assert.equal(s.price, null);
}

console.log("✓ lib/outbox.ts — la cola se aplica entera y en orden");
