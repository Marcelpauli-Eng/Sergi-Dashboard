"use client";

import Dexie, { type Table } from "dexie";
import type { DeliveryRecord, Manifest } from "./types";

/**
 * Base de datos local (IndexedDB).
 *
 * Regla de oro de esta app: **la interfaz lee siempre de aquí, nunca de la
 * red**. La red solo alimenta esta base de datos en segundo plano. Gracias a
 * eso el modo offline no es un caso especial que haya que probar aparte: es
 * el único modo que existe, y si la app funciona con cobertura, funciona sin
 * ella exactamente igual.
 */

/** El manifiesto descargado. Siempre hay como mucho uno, con clave "current". */
export interface StoredManifest {
  key: "current";
  data: Manifest;
  /** Cuándo se guardó en el móvil, para mostrar "actualizado hace X". */
  savedAt: string;
}

/**
 * Una entrega pendiente de subir al Sheet.
 *
 * Vive aquí desde que el transportista pulsa el botón hasta que el servidor
 * confirma que la ha escrito. Si el móvil se queda sin batería en medio, al
 * encenderlo sigue estando.
 */
export interface OutboxItem extends DeliveryRecord {
  /** `null` mientras esté pendiente de enviar. */
  syncedAt: string | null;
  attempts: number;
  lastError: string | null;
}

class AppDatabase extends Dexie {
  manifest!: Table<StoredManifest, string>;
  outbox!: Table<OutboxItem, string>;

  constructor() {
    super("sergi-dashboard");
    this.version(1).stores({
      manifest: "key",
      // Se indexa syncedAt para poder sacar los pendientes de un tirón.
      outbox: "clientId, orderId, syncedAt",
    });
  }
}

export const db = new AppDatabase();

export async function saveManifest(manifest: Manifest): Promise<void> {
  await db.manifest.put({
    key: "current",
    data: manifest,
    savedAt: new Date().toISOString(),
  });
}

export async function loadManifest(): Promise<StoredManifest | undefined> {
  return db.manifest.get("current");
}

/** Entregas todavía no confirmadas por el servidor. */
export async function pendingOutbox(): Promise<OutboxItem[]> {
  // Dexie no indexa `null`, así que se filtra en memoria. La cola son unas
  // pocas decenas de registros como mucho: el coste es irrelevante.
  return (await db.outbox.toArray()).filter((item) => item.syncedAt === null);
}

/**
 * Borra la sesión local por completo. Se usa al cerrar sesión para que en un
 * móvil compartido no queden los pedidos del turno anterior.
 */
export async function clearLocalData(): Promise<void> {
  await Promise.all([db.manifest.clear(), db.outbox.clear()]);
}
