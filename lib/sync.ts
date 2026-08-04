"use client";

import {
  db,
  saveManifest,
  loadManifest,
  pendingOutbox,
  type OutboxItem,
} from "./db";
import type { DeliveryStatus, Manifest } from "./types";

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
 * Aplica sobre un manifiesto las entregas que aún no han llegado al
 * servidor.
 *
 * Sin esto, cada sincronización con la cola llena devolvería los pedidos a
 * "pendiente" y el transportista vería reaparecer paradas que ya ha hecho.
 */
function applyOutbox(manifest: Manifest, items: OutboxItem[]): Manifest {
  if (items.length === 0) return manifest;

  const byOrderId = new Map(items.map((item) => [item.orderId, item]));
  const patchDay = (day: Manifest["today"]) => ({
    ...day,
    stops: day.stops.map((stop) => {
      const pending = byOrderId.get(stop.id);
      return pending ? { ...stop, status: pending.status } : stop;
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

  // Intento inmediato, sin bloquear a quien llamó: si no hay cobertura
  // fallará en silencio y quedará para el próximo flush.
  void flushOutbox().catch(() => {});
}

/** Envía al servidor las entregas pendientes. Devuelve cuántas se subieron. */
export async function flushOutbox(): Promise<number> {
  const pending = await pendingOutbox();
  if (pending.length === 0) return 0;
  if (typeof navigator !== "undefined" && !navigator.onLine) return 0;

  const response = await fetch("/api/deliveries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      records: pending.map(({ clientId, orderId, status, recordedAt, note }) => ({
        clientId,
        orderId,
        status,
        recordedAt,
        note,
      })),
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

/** Descarga el manifiesto del día y lo guarda en IndexedDB. */
export async function refreshManifest(): Promise<void> {
  const response = await fetch("/api/manifest", { cache: "no-store" });

  if (response.status === 401) throw new SessionExpiredError();
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    // Se propaga el error pero NO se toca el manifiesto guardado: es
    // preferible una ruta de hace dos horas que una pantalla en blanco.
    throw new Error(body.error ?? `El servidor respondió ${response.status}`);
  }

  const manifest = (await response.json()) as Manifest;
  const stillPending = await pendingOutbox();
  await saveManifest(applyOutbox(manifest, stillPending));
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
 */
export async function syncNow(): Promise<SyncOutcome> {
  let uploaded = 0;
  let error: string | null = null;

  try {
    uploaded = await flushOutbox();
  } catch (e) {
    if (e instanceof SessionExpiredError) throw e;
    error = e instanceof Error ? e.message : "Error subiendo entregas";
  }

  try {
    await refreshManifest();
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
