import "server-only";
import { env } from "./env";
import { readSheet, cacheCoordinates, type SheetSnapshot } from "./sheets";
import {
  geocodeAddress,
  navUrlFor,
  type Coord,
} from "./routing";
<<<<<<< HEAD
import { today, type DateString } from "./dates";
import type { Manifest, Order, RouteDay, Stop } from "./types";
=======
import { today, addDays } from "./dates";
import type { Manifest, Order, Stop } from "./types";
>>>>>>> fb86f0cd51128e7f6cb444779cd21e1844280e1a

/**
 * Coordenadas de la central. Se geocodifican una sola vez por instancia:
 * la dirección de la central no cambia.
 */
let depotCoord: Coord | null = null;

export async function getDepotCoord(): Promise<Coord> {
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
export async function fillMissingCoordinates(
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

<<<<<<< HEAD
  // Qué entra en la ruta: todo lo que no está entregado.
  //
  // No se filtra por fecha a propósito. En la hoja no hay ninguna columna
  // que diga qué día toca entregar cada pedido —la fecha que tiene es la de
  // cuándo entró— y quién decide el orden y el día es el propio
  // transportista. Filtrar por fecha dejaría la pantalla vacía.
  //
  // Los ya entregados se quedan fuera: son la mayoría de la hoja y no hay
  // nada que hacer con ellos. Las incidencias sí entran, porque siguen
  // pendientes de resolver; buildRouteDay las coloca al final, fuera de la
  // ruta optimizada.
  //
  // Sin columna de transportista hay un solo repartidor y no se filtra por
  // él. En cuanto la columna exista, el filtro se aplica solo.
  const mine = snapshot.orders.filter(
    (order) =>
      (!snapshot.hasDriverColumn || order.driverId === normalizedDriver) &&
      order.status !== "entregado",
  );

  await fillMissingCoordinates(mine, snapshot);
  const depot = await getDepotCoord();

  const todayRoute = await buildRouteDay(todayDate, mine, depot);
=======
  const hasDriverColumn = snapshot.orders.some((o) => o.driverId !== "");
  const hasDateColumn = snapshot.orders.some((o) => o.date !== "");

  let mine: Order[];

  if (hasDriverColumn) {
    mine = snapshot.orders.filter(
      (order) => order.driverId === normalizedDriver,
    );
  } else {
    mine = snapshot.orders;
  }

  const sorted = [...mine].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  );

  const stops: Stop[] = sorted.map((order, index) => {
    const { rowNumber: _rowNumber, ...rest } = order;
    return {
      ...rest,
      sequence: index + 1,
      navUrl: navUrlFor(order),
      legDistanceMeters: null,
      legDurationSeconds: null,
    };
  });
>>>>>>> fb86f0cd51128e7f6cb444779cd21e1844280e1a

  return {
    driverId: normalizedDriver,
    driverName,
    generatedAt: new Date().toISOString(),
<<<<<<< HEAD
    today: todayRoute,
    // Sin fecha de reparto no hay forma de saber qué es "mañana".
=======
    sheetTab: snapshot.sheetTab ?? "",
    today: {
      date: todayDate,
      stops: stops, // Enviamos TODOS los stops aquí para que el dashboard los reparta
      optimized: false,
      fullRouteUrl: null,
      totalDistanceMeters: null,
      totalDurationSeconds: null,
    },
>>>>>>> fb86f0cd51128e7f6cb444779cd21e1844280e1a
    tomorrow: null,
  };
}
