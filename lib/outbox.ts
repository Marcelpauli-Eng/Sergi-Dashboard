import type { OutboxItem } from "./db.ts";
import type { DeliveryStatus, Manifest, Stop } from "./types.ts";

/**
 * Cómo se ve en pantalla lo que todavía no ha llegado al Google Sheet.
 *
 * Vive aparte de `lib/sync.ts` porque aquello arrastra Dexie —y con Dexie,
 * IndexedDB, que fuera de un navegador no existe— y esto es aritmética pura
 * que conviene poder comprobar sin arrancar nada. Ver
 * `scripts/check-outbox.mts`.
 */

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
const CATEGORIA_DE: Record<DeliveryStatus, Stop["statusCategory"]> = {
  entregado: "entregat",
  incidencia: "incidencia",
  // "pendiente" solo lo genera el deshacer, que devuelve la parada a la ruta.
  pendiente: "pendent",
};

export function applyOutbox(manifest: Manifest, items: OutboxItem[]): Manifest {
  if (items.length === 0) return manifest;

  /*
    Todas las acciones de cada comanda, en el orden en que se hicieron.

    Antes era un `Map` de comanda a UNA acción, y con eso una comanda solo
    podía llevar una cosa pendiente. En cuanto lleva dos —entregarla y
    después corregirle el importe, o entregarla y deshacerlo— la otra se
    perdía y la pantalla enseñaba un estado que no era ni el de antes ni el
    de después.

    El orden hay que ponerlo aquí: la cola sale de Dexie ordenada por su
    clave primaria, que es un UUID al azar, así que "el orden en que salen"
    no es el orden en que pasaron las cosas.
  */
  const porComanda = new Map<string, OutboxItem[]>();
  for (const item of [...items].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
    const cola = porComanda.get(item.orderId);
    if (cola) cola.push(item);
    else porComanda.set(item.orderId, [item]);
  }

  /** Una sola acción sobre una parada. */
  const aplicar = (stop: Stop, pending: OutboxItem): Stop => {
    const type = pending.type || "status";

    if (type === "date") {
      return { ...stop, date: pending.date ?? "" };
    }

    if (type === "price") {
      // Solo el importe. El estado y la hora de entrega se quedan como
      // estaban, que es todo el sentido de este tipo de registro.
      return { ...stop, price: pending.price ?? null };
    }

    if (!pending.status) return stop;

    if (pending.status === "pendiente") {
      // Deshacer: la parada vuelve tal cual estaba, importe incluido. Aquí
      // un importe nulo SÍ borra, al contrario que en una entrega normal.
      return {
        ...stop,
        status: "pendiente",
        statusCategory: "pendent",
        rawStatus: "",
        price: pending.price ?? null,
      };
    }

    return {
      ...stop,
      status: pending.status,
      statusCategory: CATEGORIA_DE[pending.status],
      price: pending.price ?? stop.price,
    };
  };

  const patchDay = (day: Manifest["today"]) => ({
    ...day,
    stops: day.stops.map((stop) => (porComanda.get(stop.id) ?? []).reduce(aplicar, stop)),
  });

  return {
    ...manifest,
    today: patchDay(manifest.today),
    tomorrow: manifest.tomorrow ? patchDay(manifest.tomorrow) : null,
  };
}
