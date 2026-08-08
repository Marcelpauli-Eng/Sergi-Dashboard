import "server-only";
import { env } from "./env";
import { readSheet, cacheCoordinates, type SheetSnapshot } from "./sheets";
import {
  geocodeAddress,
  optimizeRoute,
  navUrlFor,
  fullRouteUrlFor,
  type Coord,
} from "./routing";
import { today, addDays, type DateString } from "./dates";
import type { Manifest, Order, RouteDay, Stop } from "./types";

/**
 * Coordenadas de la central. Se geocodifican una sola vez por instancia:
 * la dirección de la central no cambia.
 */
let depotCoord: Coord | null = null;

async function getDepotCoord(): Promise<Coord> {
  if (!depotCoord) {
    const coord = await geocodeAddress(env.depotAddress);
    if (!coord) {
      throw new Error(
        `No se ha podido geocodificar la dirección de la central: "${env.depotAddress}". Revisa DEPOT_ADDRESS.`,
      );
    }
    depotCoord = coord;
  }
  return depotCoord;
}

/**
 * Geocodifica los pedidos que aún no tienen coordenadas y las guarda en el
 * Sheet para no repetir el trabajo mañana.
 *
 * Muta los pedidos recibidos: a partir de aquí ya tienen lat/lng.
 *
 * Para las direcciones que tienen ciudad, se concatena para mejorar la
 * precisión del geocoding.
 */
async function fillMissingCoordinates(
  orders: Order[],
  snapshot: SheetSnapshot,
): Promise<void> {
  const pending = orders.filter((o) => o.lat === null || o.lng === null);
  if (pending.length === 0) return;

  const resolved: { orderId: string; lat: number; lng: number }[] = [];

  // En serie a propósito: son pocas direcciones nuevas al día y así no se
  // dispara el rate limit de la Geocoding API en un pico.
  for (const order of pending) {
    // Construir dirección completa con la ciudad si existe
    const fullAddress = order.city
      ? `${order.address}, ${order.city}`
      : order.address;
    const coord = await geocodeAddress(fullAddress);
    if (!coord) {
      console.warn(
        `Dirección no reconocida por Google (pedido ${order.id}): "${fullAddress}"`,
      );
      continue;
    }
    order.lat = coord.lat;
    order.lng = coord.lng;
    resolved.push({ orderId: order.id, lat: coord.lat, lng: coord.lng });
  }

  if (resolved.length > 0) {
    try {
      await cacheCoordinates(resolved, snapshot);
    } catch (error) {
      // Que falle el cacheo no debe tumbar la ruta: solo significa que
      // mañana habrá que volver a geocodificar.
      console.error("No se pudieron cachear las coordenadas en el Sheet:", error);
    }
  }
}

/**
 * Construye la ruta de un día concreto.
 *
 * Solo entran en la optimización los pedidos pendientes: si el transportista
 * sincroniza a media mañana, lo ya entregado no debe seguir apareciendo como
 * parada de la ruta.
 */
async function buildRouteDay(
  date: DateString,
  orders: Order[],
  depot: Coord,
): Promise<RouteDay> {
  const pending = orders.filter((o) => o.status === "pendiente");
  const done = orders.filter((o) => o.status !== "pendiente");

  const route =
    pending.length > 0
      ? await optimizeRoute(depot, pending)
      : {
          ordered: [] as Order[],
          legs: [] as { distanceMeters: number | null; durationSeconds: number | null }[],
          totalDistanceMeters: null,
          totalDurationSeconds: null,
          optimized: true,
        };

  const toStop = (order: Order, index: number, sequence: number): Stop => {
    // `rowNumber` no viaja al cliente: se recalcula al escribir.
    const { rowNumber: _rowNumber, ...rest } = order;
    return {
      ...rest,
      sequence,
      navUrl: navUrlFor(order),
      legDistanceMeters: route.legs[index]?.distanceMeters ?? null,
      legDurationSeconds: route.legs[index]?.durationSeconds ?? null,
    };
  };

  const stops: Stop[] = route.ordered.map((order, index) =>
    toStop(order, index, index + 1),
  );

  // Los ya cerrados van al final, sin número de parada.
  const closed: Stop[] = done
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map((order) => {
      const { rowNumber: _rowNumber, ...rest } = order;
      return {
        ...rest,
        sequence: 0,
        navUrl: navUrlFor(order),
        legDistanceMeters: null,
        legDurationSeconds: null,
      };
    });

  return {
    date,
    stops: [...stops, ...closed],
    optimized: route.optimized,
    fullRouteUrl: fullRouteUrlFor(env.depotAddress, route.ordered),
    totalDistanceMeters: route.totalDistanceMeters,
    totalDurationSeconds: route.totalDurationSeconds,
  };
}

/**
 * Genera el paquete completo que se descarga el transportista: todo lo que
 * necesita para trabajar el día entero sin cobertura.
 *
 * @param driverId - ID del transportista logueado.
 * @param driverName - Nombre del transportista.
 * @param sheetTab - Pestaña del Sheet a leer. Si no se pasa, usa la de env.
 */
export async function buildManifest(
  driverId: string,
  driverName: string,
  sheetTab?: string,
): Promise<Manifest> {
  const snapshot = await readSheet(sheetTab);

  if (snapshot.skipped.length > 0) {
    console.warn(
      `Filas descartadas del Sheet: ${snapshot.skipped
        .map((s) => `fila ${s.rowNumber} (${s.reason})`)
        .join(", ")}`,
    );
  }

  const todayDate = today(env.timezone);
  const normalizedDriver = driverId.toLowerCase();

  // Si el Sheet tiene columna driverId, filtrar por transportista.
  // Si no, todos los pedidos de la pestaña son del transportista logueado.
  const hasDriverColumn = snapshot.orders.some((o) => o.driverId !== "");
  const hasDateColumn = snapshot.orders.some((o) => o.date !== "");

  let mine: Order[];

  if (hasDriverColumn && hasDateColumn) {
    // Modo original: filtrar por transportista y fecha
    const tomorrowDate = addDays(todayDate, 1);
    mine = snapshot.orders.filter(
      (order) =>
        order.driverId === normalizedDriver &&
        (order.date === todayDate || order.date === tomorrowDate),
    );
  } else if (hasDriverColumn) {
    // Filtrar solo por transportista
    mine = snapshot.orders.filter(
      (order) => order.driverId === normalizedDriver,
    );
  } else {
    // Sin columna transportista: todos los pedidos son del usuario
    mine = snapshot.orders;
  }

  await fillMissingCoordinates(mine, snapshot);
  const depot = await getDepotCoord();

  // Si hay fecha, separar hoy y mañana. Si no, todo va en "hoy".
  let todayOrders: Order[];
  let tomorrowOrders: Order[];

  if (hasDateColumn) {
    const tomorrowDate = addDays(todayDate, 1);
    todayOrders = mine.filter((o) => o.date === todayDate);
    tomorrowOrders = mine.filter((o) => o.date === tomorrowDate);
  } else {
    todayOrders = mine;
    tomorrowOrders = [];
  }

  const [todayRoute, tomorrowRoute] = await Promise.all([
    buildRouteDay(todayDate, todayOrders, depot),
    buildRouteDay(
      hasDateColumn ? addDays(todayDate, 1) : todayDate,
      tomorrowOrders,
      depot,
    ),
  ]);

  return {
    driverId: normalizedDriver,
    driverName,
    generatedAt: new Date().toISOString(),
    sheetTab: snapshot.sheetTab,
    today: todayRoute,
    tomorrow: tomorrowRoute.stops.length > 0 ? tomorrowRoute : null,
  };
}
