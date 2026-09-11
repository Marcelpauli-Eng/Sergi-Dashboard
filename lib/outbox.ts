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
/** La hora local de un registro, "HH:MM", como se enseña en el informe del día. */
function horaDe(iso: string): string | null {
  const quan = new Date(iso);
  if (Number.isNaN(quan.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(quan.getHours())}:${p(quan.getMinutes())}`;
}

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
        deliveredTime: null,
        incidentNote: null,
      };
    }

    return {
      ...stop,
      status: pending.status,
      statusCategory: CATEGORIA_DE[pending.status],
      price: pending.price ?? stop.price,
      // La hora sale del propio registro, que es el mismo valor que acabará
      // en la hoja. Sin esto, el informe del día no enseñaba la hora de lo
      // que se acababa de marcar hasta la siguiente descarga.
      deliveredTime: horaDe(pending.recordedAt),
      incidentNote: pending.note ?? stop.incidentNote,
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

/**
 * Cuántos registros caben en una subida.
 *
 * Tiene que ser el mismo tope que valida la API. Mandarlo todo de golpe
 * funcionaba mientras la cola fuera corta, pero la cola crece sola cuando
 * algo falla al escribir: basta con estar un rato sin cobertura para pasar
 * de cien, y a partir de ahí el servidor rechazaba el lote entero por
 * tamaño y la cola ya no podía vaciarse nunca.
 */
export const MAX_POR_ENVIO = 100;

export interface Tanda<T> {
  /** El full donde hay que escribir esta tanda. */
  sheetTab: string | null;
  /** Lo que se manda ahora. Todo del mismo full. */
  items: T[];
  /** Cuántos pendientes se quedan para la siguiente tanda. */
  quedan: number;
}

/**
 * Qué parte de la cola se sube ahora.
 *
 * Una tanda es de UN SOLO full, y ahí está todo el asunto. Antes se mandaba
 * la cola entera con el full que estuviera abierto en ese momento, así que
 * marcar una entrega en JUL 26, quedarse sin cobertura y cambiar de full
 * antes de que subiera escribía en AGO 26: allí esa comanda no existe, el
 * servidor contestaba "no encontrada" y la entrega se perdía para siempre
 * sin que nadie se enterara.
 *
 * Los más antiguos primero, que es el orden en que pasaron las cosas: la
 * hoja tiene que acabar reflejando el último estado, no uno intermedio.
 *
 * `fullActual` es para los registros que quedaran en la cola de una versión
 * anterior, que no llevan full: se escriben donde se habrían escrito antes.
 */
export function seleccionarTanda<
  T extends { recordedAt: string; sheetTab?: string | null },
>(pendientes: T[], fullActual: string | null, max: number = MAX_POR_ENVIO): Tanda<T> {
  const ordenados = [...pendientes].sort((a, b) =>
    a.recordedAt.localeCompare(b.recordedAt),
  );

  const fullDe = (item: T) => item.sheetTab ?? fullActual;

  if (ordenados.length === 0) return { sheetTab: fullActual, items: [], quedan: 0 };

  const sheetTab = fullDe(ordenados[0]);
  const items = ordenados.filter((item) => fullDe(item) === sheetTab).slice(0, max);

  return { sheetTab, items, quedan: ordenados.length - items.length };
}
