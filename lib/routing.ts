import "server-only";
import { env } from "./env";
import type { Order } from "./types";

/**
 * Cálculo de la ruta del día.
 *
 * Estrategia acordada: se optimiza por tiempo de conducción real (Google
 * Routes API) y la prioridad del Sheet actúa solo como desempate entre
 * paradas que están prácticamente igual de cerca.
 */

export interface Coord {
  lat: number;
  lng: number;
}

/**
 * Distancia en línea recta entre dos puntos, en metros.
 *
 * No sustituye a la distancia por carretera: se usa únicamente para estimar
 * lo que costaría intercambiar dos paradas contiguas en el desempate por
 * prioridad, donde solo importa el orden de magnitud y pedirle otra matriz
 * a Google no compensaría.
 */
export function haversine(a: Coord, b: Coord): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ─────────────────────────────────────────────────────────────────────────
// Geocoding
// ─────────────────────────────────────────────────────────────────────────

/**
 * Convierte una dirección en coordenadas.
 *
 * Devuelve `null` si Google no la reconoce, en cuyo caso el pedido sigue
 * apareciendo en la lista (el transportista puede navegar por texto) pero
 * queda fuera del cálculo de ruta.
 */
export async function geocodeAddress(address: string): Promise<Coord | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", env.google.mapsApiKey);
  // Sesga los resultados ambiguos hacia España.
  url.searchParams.set("region", "es");
  url.searchParams.set("language", "es");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;

  const data = (await response.json()) as {
    status: string;
    results?: { geometry: { location: { lat: number; lng: number } } }[];
  };

  if (data.status !== "OK" || !data.results?.length) return null;
  const { lat, lng } = data.results[0].geometry.location;
  return { lat, lng };
}

// ─────────────────────────────────────────────────────────────────────────
// Optimización
// ─────────────────────────────────────────────────────────────────────────

export interface OptimizedRoute {
  /** Los pedidos en el orden en que hay que visitarlos. */
  ordered: Order[];
  /** Distancia y duración de cada tramo, alineadas con `ordered`. */
  legs: { distanceMeters: number | null; durationSeconds: number | null }[];
  totalDistanceMeters: number | null;
  totalDurationSeconds: number | null;
  optimized: boolean;
}

/** Orden de respaldo: solo por prioridad. Se usa si Google no responde. */
function fallbackOrder(orders: Order[]): OptimizedRoute {
  const ordered = [...orders].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  );
  return {
    ordered,
    legs: ordered.map(() => ({ distanceMeters: null, durationSeconds: null })),
    totalDistanceMeters: null,
    totalDurationSeconds: null,
    optimized: false,
  };
}

/**
 * Si dos paradas contiguas están prácticamente a la misma distancia, las
 * intercambia para que vaya antes la más prioritaria.
 *
 * El umbral es cuánto desvío extra estamos dispuestos a aceptar a cambio de
 * respetar la prioridad. Con 500 m, una parada urgente adelanta a otra que
 * está en la misma calle, pero nunca provoca un rodeo real.
 */
function applyPriorityTiebreak(
  depot: Coord,
  ordered: Order[],
  thresholdMeters: number,
): Order[] {
  const coordOf = (order: Order): Coord | null =>
    order.lat !== null && order.lng !== null
      ? { lat: order.lat, lng: order.lng }
      : null;

  const result = [...ordered];

  // Una sola pasada de burbuja: basta para el desempate y no reordena la ruta.
  for (let i = 0; i < result.length - 1; i++) {
    const current = result[i];
    const next = result[i + 1];

    // Solo intercambiamos si el siguiente es MÁS prioritario (número menor).
    if (next.priority >= current.priority) continue;

    const a = coordOf(current);
    const b = coordOf(next);
    if (!a || !b) continue;

    const before = i === 0 ? depot : coordOf(result[i - 1]);
    const after = i + 2 < result.length ? coordOf(result[i + 2]) : null;
    if (!before) continue;

    // Coste actual: ...→ a → b → ...   Coste tras el swap: ...→ b → a → ...
    const costNow =
      haversine(before, a) + haversine(a, b) + (after ? haversine(b, after) : 0);
    const costSwapped =
      haversine(before, b) + haversine(b, a) + (after ? haversine(a, after) : 0);

    if (costSwapped - costNow <= thresholdMeters) {
      result[i] = next;
      result[i + 1] = current;
    }
  }

  return result;
}

/**
 * Pide a Google el orden óptimo de las paradas.
 *
 * Origen y destino son la central: se plantea como ruta circular para que el
 * optimizador tenga libertad total sobre el orden de las paradas intermedias.
 * Si el transportista no vuelve a base, el último tramo simplemente no se
 * muestra.
 *
 * La Routes API admite hasta 25 paradas intermedias con optimización, que
 * cubre de sobra una jornada.
 */
export async function optimizeRoute(
  depot: Coord,
  orders: Order[],
): Promise<OptimizedRoute> {
  const routable = orders.filter((o) => o.lat !== null && o.lng !== null);

  // Sin coordenadas suficientes no hay nada que optimizar.
  if (routable.length === 0) return fallbackOrder(orders);
  if (routable.length === 1) {
    const rest = orders.filter((o) => o.lat === null || o.lng === null);
    return {
      ordered: [...routable, ...rest],
      legs: [...routable, ...rest].map(() => ({
        distanceMeters: null,
        durationSeconds: null,
      })),
      totalDistanceMeters: null,
      totalDurationSeconds: null,
      optimized: true,
    };
  }

  const point = (c: Coord) => ({
    location: { latLng: { latitude: c.lat, longitude: c.lng } },
  });

  const body = {
    origin: point(depot),
    destination: point(depot),
    intermediates: routable.map((o) => point({ lat: o.lat!, lng: o.lng! })),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    optimizeWaypointOrder: true,
    languageCode: "es-ES",
    units: "METRIC",
  };

  let data: {
    routes?: {
      optimizedIntermediateWaypointIndex?: number[];
      distanceMeters?: number;
      duration?: string;
      legs?: { distanceMeters?: number; duration?: string }[];
    }[];
  };

  try {
    const response = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": env.google.mapsApiKey,
          "X-Goog-FieldMask": [
            "routes.optimizedIntermediateWaypointIndex",
            "routes.distanceMeters",
            "routes.duration",
            "routes.legs.distanceMeters",
            "routes.legs.duration",
          ].join(","),
        },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      console.error(
        `Routes API falló (${response.status}): ${(await response.text()).slice(0, 300)}`,
      );
      return fallbackOrder(orders);
    }

    data = await response.json();
  } catch (error) {
    console.error("Routes API inaccesible, se usa el orden por prioridad:", error);
    return fallbackOrder(orders);
  }

  const route = data.routes?.[0];
  const order = route?.optimizedIntermediateWaypointIndex;
  if (!route || !order || order.length !== routable.length) {
    return fallbackOrder(orders);
  }

  // `optimizedIntermediateWaypointIndex[i]` es el índice original de la
  // parada que ocupa la posición i en la ruta optimizada.
  let ordered = order.map((originalIndex) => routable[originalIndex]);
  ordered = applyPriorityTiebreak(depot, ordered, 500);

  // Los tramos vienen alineados con el orden que devolvió Google. Tras el
  // desempate por prioridad ese emparejamiento deja de ser exacto, así que
  // se conservan como estimación del tramo, no como dato al metro.
  const legs = (route.legs ?? []).slice(0, ordered.length).map((leg) => ({
    distanceMeters: leg.distanceMeters ?? null,
    durationSeconds: leg.duration ? parseInt(leg.duration, 10) : null,
  }));
  while (legs.length < ordered.length) {
    legs.push({ distanceMeters: null, durationSeconds: null });
  }

  // Las paradas sin coordenadas van al final: el transportista las ve, pero
  // no entran en el cálculo.
  const unroutable = orders.filter((o) => o.lat === null || o.lng === null);
  for (const _ of unroutable) {
    legs.push({ distanceMeters: null, durationSeconds: null });
  }

  return {
    ordered: [...ordered, ...unroutable],
    legs,
    totalDistanceMeters: route.distanceMeters ?? null,
    totalDurationSeconds: route.duration ? parseInt(route.duration, 10) : null,
    optimized: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Enlaces de navegación
// ─────────────────────────────────────────────────────────────────────────

/**
 * Enlace que abre la navegación hacia una parada. En un móvil con Google
 * Maps instalado abre la app directamente; si no, la web.
 *
 * Se prefieren las coordenadas a la dirección en texto: evita que Maps
 * reinterprete la dirección y mande al transportista a otro sitio.
 */
export function navUrlFor(order: Pick<Order, "lat" | "lng" | "address">): string {
  const destination =
    order.lat !== null && order.lng !== null
      ? `${order.lat},${order.lng}`
      : order.address;

  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", destination);
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}

/**
 * Enlace que abre la ruta completa con todas las paradas en Google Maps.
 *
 * La URL API de Google admite como máximo 9 paradas intermedias, así que
 * por encima de eso devolvemos `null` y el transportista navega parada a
 * parada, que es como se trabaja en reparto de todas formas.
 */
export function fullRouteUrlFor(
  depotAddress: string,
  stops: Pick<Order, "lat" | "lng" | "address">[],
): string | null {
  if (stops.length === 0) return null;
  if (stops.length > 10) return null;

  const asPoint = (s: Pick<Order, "lat" | "lng" | "address">) =>
    s.lat !== null && s.lng !== null ? `${s.lat},${s.lng}` : s.address;

  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", depotAddress);
  url.searchParams.set("destination", asPoint(stops[stops.length - 1]));
  if (stops.length > 1) {
    url.searchParams.set(
      "waypoints",
      stops.slice(0, -1).map(asPoint).join("|"),
    );
  }
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}
