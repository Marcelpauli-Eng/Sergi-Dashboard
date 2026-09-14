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

/**
 * Cuántas direcciones ya cacheadas se revisan en cada ronda.
 *
 * Revisar es volver a preguntarle a Google por una dirección que ya tenía
 * coordenadas, para ver si las que hay son el portal o el centro del pueblo.
 * Con tope porque la ruta se calcula cada vez que el transportista abre la
 * app, y sin él la primera del día sería una ráfaga de llamadas.
 */
const MAX_REVISIONES_POR_RONDA = 15;

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
  /*
    Las que no tienen dirección no se geocodifican: no hay nada que buscar.

    Desde que se pueden crear comandas con solo el número, las hay sin
    dirección, y preguntarle a Google por una cadena vacía es una llamada
    tirada y un aviso en el log por cada una, cada vez que se sincroniza.
  */
  const conDireccion = orders.filter((o) => o.address.trim() !== "");

  const sinCoordenadas = conDireccion.filter(
    (o) => o.lat === null || o.lng === null,
  );
  /*
    Las que tienen coordenadas pero no portal son de antes de guardarlo, y
    entre ellas están las que mandaban al transportista al centro del pueblo:
    en su día se guardó lo que Google contestara, fuera el portal o el
    centroide, y como ya había coordenadas no se volvía a preguntar nunca.

    Se vuelven a resolver, pero con tope: son las comandas del día, y un día
    con la hoja entera por estrenar no debe convertirse en cien llamadas a
    Google de golpe. Las que queden se arreglan al día siguiente.
  */
  const sinPortal = conDireccion
    .filter((o) => o.lat !== null && o.lng !== null && o.placeId === null)
    .slice(0, MAX_REVISIONES_POR_RONDA);

  const pending = [...sinCoordenadas, ...sinPortal];
  if (pending.length === 0) return;

  const resolved: {
    orderId: string;
    lat: number;
    lng: number;
    placeId: string | null;
  }[] = [];

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

    if (!coord.precise) {
      /*
        Google ha contestado el centro del pueblo, no el portal.

        Ese punto NO se guarda como si fuera la dirección: guardarlo es lo
        que hacía que el botón de navegar llevara al pueblo y se quedara así
        para siempre. Sin coordenadas, la tarjeta navega con la dirección en
        texto —que al menos la busca Maps— y la parada queda fuera del
        cálculo de ruta, que es lo mismo que pasa con una dirección que
        Google no reconoce.

        Se sigue usando como referencia para ordenar la ruta solo si ya
        venía de la hoja; si no había nada, se deja a null.
      */
      console.warn(
        `Google solo ha sabido situar el pueblo, no la calle (pedido ${order.id}): "${fullAddress}". ` +
          `Revisa la dirección en la hoja; mientras tanto se navega por texto.`,
      );
      continue;
    }

    order.lat = coord.lat;
    order.lng = coord.lng;
    order.placeId = coord.placeId;
    resolved.push({
      orderId: order.id,
      lat: coord.lat,
      lng: coord.lng,
      placeId: coord.placeId,
    });
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

/**
 * Las comandas que le tocan a un transportista.
 *
 * Si la hoja no tiene columna de transportista, hay uno solo y son todas.
 * Exportado para que los informes cuenten EXACTAMENTE lo mismo que la ruta
 * del día: dos filtros parecidos en dos sitios acaban divergiendo, y cuando
 * lo hagan nadie va a entender por qué la comparativa no cuadra con lo que
 * se ve en pantalla.
 */
export function comandasDelTransportista(orders: Order[], driverId: string): Order[] {
  const hasDriverColumn = orders.some((o) => o.driverId !== "");
  if (!hasDriverColumn) return orders;
  return orders.filter((order) => order.driverId === driverId.toLowerCase());
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

  const mine = comandasDelTransportista(snapshot.orders, normalizedDriver);

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
