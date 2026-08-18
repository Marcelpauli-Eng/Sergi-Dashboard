"use client";

import {
  db,
  saveManifest,
  loadManifest,
  pendingOutbox,
  type OutboxItem,
} from "./db";
import type { DeliveryStatus, Manifest, Stop } from "./types";

/**
 * Motor de sincronización.
 *
 * Dos direcciones independientes:
 *  - Bajada: el manifiesto del día, del servidor a IndexedDB.
 *  - Subida: la cola de entregas, de IndexedDB al Google Sheet.
 *
 * Siempre se sube antes de bajar, para que el manifiesto que llega ya
 * refleje lo que acabamos de escribir y no "resucite" un pedido entregado.
 */

export class SessionExpiredError extends Error {
  constructor() {
    super("La sesión ha caducado");
    this.name = "SessionExpiredError";
  }
}

/**
 * `fetch` lanza un TypeError seco ("Failed to fetch") cuando no hay red, el
 * servidor está caído o hay un portal cautivo de por medio. Ese texto no le
 * dice nada a un transportista, así que se traduce a algo accionable.
 */
async function request(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error("Sin conexión. Estás viendo los datos descargados.");
  }
}

/**
 * Cuánto tiempo se sigue confiando en lo que dice el móvil por encima de lo
 * que responde el servidor, para una entrega ya subida.
 *
 * Hace falta porque entre que escribimos en el Google Sheet y que esa
 * escritura se ve al releerlo puede pasar un momento; y en modo demo sobre
 * Vercel, la petición siguiente puede atender otra instancia que no conozca
 * la entrega. Sin este margen, una parada recién entregada reaparecería
 * como pendiente, que es el peor error posible en esta app.
 */
const TRUST_LOCAL_MS = 10 * 60 * 1000;

/** Entregas que deben imponerse sobre lo que diga el servidor. */
async function locallyAuthoritative(): Promise<OutboxItem[]> {
  const cutoff = Date.now() - TRUST_LOCAL_MS;
  return (await db.outbox.toArray()).filter(
    (item) =>
      item.syncedAt === null || new Date(item.recordedAt).getTime() > cutoff,
  );
}

/**
 * Borra de la cola lo ya confirmado hace tiempo, para que no crezca sin
 * límite en un móvil que lleve meses con la app instalada.
 */
async function pruneOutbox(): Promise<void> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const stale = (await db.outbox.toArray()).filter(
    (item) =>
      item.syncedAt !== null && new Date(item.recordedAt).getTime() < cutoff,
  );
  if (stale.length > 0) {
    await db.outbox.bulkDelete(stale.map((item) => item.clientId));
  }
}

/**
 * Aplica sobre un manifiesto las entregas que manda el móvil.
 *
 * Sin esto, cada sincronización devolvería los pedidos a "pendiente" y el
 * transportista vería reaparecer paradas que ya ha hecho.
 */
/**
 * La categoría que le toca a un estado recién marcado.
 *
 * El dashboard reparte los pedidos por `statusCategory`, no por `status`.
 * Parchear solo el segundo dejaba la parada en la pestaña donde estaba: se
 * marcaba entregada, la hoja se actualizaba correctamente, y en la pantalla
 * seguía apareciendo en Avui hasta la siguiente descarga completa del
 * manifiesto. Y como este manifiesto parcheado se guarda en IndexedDB, el
 * estado incoherente sobrevivía a cerrar la app.
 */
const CATEGORIA_DE: Record<
  Exclude<DeliveryStatus, "pendiente">,
  Stop["statusCategory"]
> = {
  entregado: "entregat",
  incidencia: "incidencia",
};

export function applyOutbox(manifest: Manifest, items: OutboxItem[]): Manifest {
  if (items.length === 0) return manifest;

  const byOrderId = new Map(items.map((item) => [item.orderId, item]));
  const patchDay = (day: Manifest["today"]) => ({
    ...day,
    stops: day.stops.map((stop) => {
      const pending = byOrderId.get(stop.id);
      if (!pending) return stop;
      const type = pending.type || "status";
      if (type === "date") {
        return { ...stop, date: pending.date ?? "" };
      }
      if (!pending.status) return stop;
      return {
        ...stop,
        status: pending.status,
        statusCategory: CATEGORIA_DE[pending.status],
      };
    }),
  });

  return {
    ...manifest,
    today: patchDay(manifest.today),
    tomorrow: manifest.tomorrow ? patchDay(manifest.tomorrow) : null,
  };
}

/**
 * Marca un pedido como entregado o con incidencia.
 *
 * El orden importa: primero se persiste en la cola local y se actualiza la
 * pantalla, y solo después se intenta enviar. Así el botón responde al
 * instante y el registro sobrevive aunque el móvil se apague acto seguido.
 */
export async function recordDelivery(
  orderId: string,
  status: Exclude<DeliveryStatus, "pendiente">,
  note: string | null = null,
): Promise<void> {
  const item: OutboxItem = {
    clientId: crypto.randomUUID(),
    orderId,
    type: "status",
    status,
    recordedAt: new Date().toISOString(),
    note,
    syncedAt: null,
    attempts: 0,
    lastError: null,
  };

  await db.transaction("rw", db.outbox, db.manifest, async () => {
    await db.outbox.put(item);

    const stored = await loadManifest();
    if (stored) {
      await db.manifest.put({
        ...stored,
        data: applyOutbox(stored.data, [item]),
      });
    }
  });

  void flushOutbox().catch(() => {});
}

/**
 * Asigna una fecha a un pedido en el calendario.
 */
export async function recordDateAssignment(
  orderId: string,
  date: string | null,
): Promise<void> {
  const item: OutboxItem = {
    clientId: crypto.randomUUID(),
    orderId,
    type: "date",
    date: date,
    recordedAt: new Date().toISOString(),
    syncedAt: null,
    attempts: 0,
    lastError: null,
  };

  await db.transaction("rw", db.outbox, db.manifest, async () => {
    await db.outbox.put(item);

    const stored = await loadManifest();
    if (stored) {
      await db.manifest.put({
        ...stored,
        data: applyOutbox(stored.data, [item]),
      });
    }
  });

  void flushOutbox().catch(() => {});
}

/**
 * Obtiene la pestaña del Sheet actualmente seleccionada.
 * Se guarda en localStorage para persistir entre sesiones.
 */
export function getSelectedTab(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("selectedSheetTab");
}

/**
 * Guarda la pestaña seleccionada.
 */
export function setSelectedTab(tab: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("selectedSheetTab", tab);
}

const CUSTOM_ORDER_KEY = "customStopOrder";

/**
 * Recupera el orden personalizado que el transportista ha definido
 * arrastrando las tarjetas con el dedo.
 */
export function getCustomOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_ORDER_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Guarda el orden personalizado (array de IDs de pedido).
 */
export function setCustomOrder(orderIds: string[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CUSTOM_ORDER_KEY, JSON.stringify(orderIds));
}

/**
 * Aplica el orden personalizado a una lista de stops.
 * Los IDs conocidos mantienen su posición; los nuevos se añaden al final.
 */
export function applyCustomOrder<T extends { id: string }>(
  items: T[],
  savedOrder: string[],
): T[] {
  if (savedOrder.length === 0) return items;

  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered: T[] = [];
  const used = new Set<string>();

  // Primero los que están en el orden guardado
  for (const id of savedOrder) {
    const item = byId.get(id);
    if (item) {
      ordered.push(item);
      used.add(id);
    }
  }

  // Después los nuevos que no estaban en el orden guardado
  for (const item of items) {
    if (!used.has(item.id)) {
      ordered.push(item);
    }
  }

  return ordered;
}

/** Envía al servidor las entregas pendientes. Devuelve cuántas se subieron. */
export async function flushOutbox(): Promise<number> {
  const pending = await pendingOutbox();
  if (pending.length === 0) return 0;
  if (typeof navigator !== "undefined" && !navigator.onLine) return 0;

  const sheetTab = getSelectedTab();

  const response = await request("/api/deliveries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      records: pending.map(({ clientId, orderId, type, status, date, recordedAt, note }) => ({
        clientId,
        orderId,
        type: type || "status",
        status,
        date,
        recordedAt,
        note,
      })),
      ...(sheetTab ? { sheetTab } : {}),
    }),
  });

  if (response.status === 401) throw new SessionExpiredError();

  if (!response.ok) {
    const message = `El servidor respondió ${response.status}`;
    await db.transaction("rw", db.outbox, async () => {
      for (const item of pending) {
        await db.outbox.update(item.clientId, {
          attempts: item.attempts + 1,
          lastError: message,
        });
      }
    });
    throw new Error(message);
  }

  const result = (await response.json()) as {
    applied: string[];
    notFound: string[];
  };

  const now = new Date().toISOString();
  const resolved = new Set([...result.applied, ...result.notFound]);

  await db.transaction("rw", db.outbox, async () => {
    for (const item of pending) {
      if (!resolved.has(item.orderId)) continue;
      // Los `notFound` también se cierran: el pedido ya no está en el Sheet,
      // reintentar eternamente no lo va a devolver.
      await db.outbox.update(item.clientId, {
        syncedAt: now,
        lastError: result.notFound.includes(item.orderId)
          ? "El pedido ya no existe en el Google Sheet"
          : null,
      });
    }
  });

  return result.applied.length;
}

/**
 * Descarga el manifiesto del día y lo guarda en IndexedDB.
 *
 * @param sheetTab - Pestaña del Sheet a leer. Si se pasa, se añade como
 *   parámetro al endpoint. Si no, el servidor usa la de env.
 */
export async function refreshManifest(sheetTab?: string): Promise<void> {
  const tab = sheetTab ?? getSelectedTab();
  const url = tab
    ? `/api/manifest?tab=${encodeURIComponent(tab)}`
    : "/api/manifest";

  const response = await request(url, { cache: "no-store" });

  if (response.status === 401) throw new SessionExpiredError();
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    // Se propaga el error pero NO se toca el manifiesto guardado: es
    // preferible una ruta de hace dos horas que una pantalla en blanco.
    throw new Error(body.error ?? `El servidor respondió ${response.status}`);
  }

  const manifest = (await response.json()) as Manifest;
  await saveManifest(applyOutbox(manifest, await locallyAuthoritative()));
  await pruneOutbox();
}

export interface SyncOutcome {
  uploaded: number;
  refreshed: boolean;
  error: string | null;
}

/**
 * Ciclo completo: sube lo pendiente y baja el manifiesto actualizado.
 *
 * Nunca lanza: devuelve el resultado para que la interfaz pueda mostrar un
 * aviso discreto sin romper la pantalla. La única excepción que sí se
 * propaga es la sesión caducada, porque requiere que el usuario actúe.
 *
 * @param sheetTab - Pestaña del Sheet. Se pasa a refreshManifest.
 */
export async function syncNow(sheetTab?: string): Promise<SyncOutcome> {
  let uploaded = 0;
  let error: string | null = null;

  try {
    uploaded = await flushOutbox();
  } catch (e) {
    if (e instanceof SessionExpiredError) throw e;
    error = e instanceof Error ? e.message : "Error subiendo entregas";
  }

  try {
    await refreshManifest(sheetTab);
    return { uploaded, refreshed: true, error };
  } catch (e) {
    if (e instanceof SessionExpiredError) throw e;
    return {
      uploaded,
      refreshed: false,
      error: error ?? (e instanceof Error ? e.message : "Error de sincronización"),
    };
  }
}
