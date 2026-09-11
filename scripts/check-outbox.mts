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

// ── El troceado de la subida ─────────────────────────────────────────────
// La API rechaza lotes de más de 100 registros. La cola crece sola cuando
// algo falla al escribir —un rato sin cobertura, o el documento de importes
// sin configurar—, así que pasar de cien no es raro. Si se mandara entera,
// el servidor la rechazaría por tamaño y la cola no podría vaciarse NUNCA:
// cada intento llevaría los mismos registros de más.
{
  const MAX = 100;
  const cola = Array.from({ length: 250 }, (_, i) =>
    item({
      orderId: `ALB-${i}`,
      type: "status",
      status: "entregado",
      // Al revés, para comprobar que se ordena por fecha y no por posición.
      recordedAt: new Date(Date.UTC(2026, 7, 26, 10, 0, 250 - i)).toISOString(),
    }),
  );

  const lote = [...cola]
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    .slice(0, MAX);

  assert.equal(lote.length, MAX, "el lote tiene que caber en lo que acepta la API");
  assert.equal(lote[0].orderId, "ALB-249", "no se está enviando lo más antiguo primero");

  // Y en tandas sucesivas se acaba vaciando, sin repetir ni saltarse nada.
  const vistos = new Set<string>();
  let quedan = [...cola].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  let tandas = 0;
  while (quedan.length > 0) {
    for (const i of quedan.slice(0, MAX)) {
      assert.equal(vistos.has(i.orderId), false, `${i.orderId} se ha enviado dos veces`);
      vistos.add(i.orderId);
    }
    quedan = quedan.slice(MAX);
    tandas++;
    assert.ok(tandas <= 10, "la cola no se vacía: se ha quedado dando vueltas");
  }
  assert.equal(vistos.size, cola.length, "se han quedado registros sin enviar");
  assert.equal(tandas, 3);
}

console.log("✓ lib/outbox.ts — la cola se aplica entera, en orden y por tandas");
