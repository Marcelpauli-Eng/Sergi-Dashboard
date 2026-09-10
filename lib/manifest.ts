import "server-only";
import { env } from "./env";
import {
  readImportes,
  readSheet,
  cacheCoordinates,
  type SheetSnapshot,
} from "./sheets";
import {
  geocodeAddress,
  navUrlFor,
  type Coord,
} from "./routing";
import { today } from "./dates";
import type { Manifest, Order, Stop } from "./types";

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

/**
 * Avisa del fallo de los importes una sola vez por proceso.
 *
 * Es casi siempre el mismo y es de configuración: sin el documento privado
 * no hay dónde leerlos. Escupir la traza entera en cada sincronización
 * —cada vez que alguien abre la app o vuelve a la pestaña— entierra en el
 * log cualquier otra cosa que sí sea nueva.
 */
let yaAvisado = false;
function avisarUnaVez(error: unknown): void {
  if (yaAvisado) return;
  yaAvisado = true;
  const mensaje = error instanceof Error ? error.message : String(error);
  console.warn(`No se han podido leer los importes: ${mensaje}`);
}

export async function buildManifest(
  driverId: string,
  driverName: string,
  sheetTab?: string,
): Promise<Manifest> {
  /*
    Las dos lecturas van en paralelo porque son documentos distintos: los
    pedidos salen de la hoja que comparte la empresa y los importes del
    archivo privado del transportista. Una espera a la otra no aporta nada.
  */
  const [snapshot, importes] = await Promise.all([
    readSheet(sheetTab),
    readImportes().catch((error) => {
      // Que no se puedan leer los importes no puede dejar sin ruta a nadie:
      // se sigue con los pedidos y sin precios, que es lo accesorio.
      avisarUnaVez(error);
      return new Map<string, number>();
    }),
  ]);

  if (snapshot.skipped.length > 0) {
    console.warn(
      `Filas descartadas del Sheet: ${snapshot.skipped
        .map((s) => `fila ${s.rowNumber} (${s.reason})`)
        .join(", ")}`,
    );
  }

  const todayDate = today(env.timezone);
  const normalizedDriver = driverId.toLowerCase();

  const hasDriverColumn = snapshot.orders.some((o) => o.driverId !== "");

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
      // El único sitio de donde sale un importe. `readSheet` ya no lee la
      // columna de la hoja de repartos: ver el porqué allí.
      price: importes.get(order.id) ?? null,
      sequence: index + 1,
      navUrl: navUrlFor(order),
      legDistanceMeters: null,
      legDurationSeconds: null,
    };
  });

  return {
    driverId: normalizedDriver,
    driverName,
    generatedAt: new Date().toISOString(),
    sheetTab: snapshot.sheetTab ?? "",
    today: {
      date: todayDate,
      stops: stops, // Enviamos TODOS los stops aquí para que el dashboard los reparta
      optimized: false,
      fullRouteUrl: null,
      totalDistanceMeters: null,
      totalDurationSeconds: null,
    },
    tomorrow: null,
  };
}
