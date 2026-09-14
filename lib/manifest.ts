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
  resolveUbicacio,
  type Coord,
  type NivellUbicacio,
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
    Las que no tienen dirección ni cliente no se buscan: no hay nada que
    buscar. Desde que se pueden crear comandas con solo el número, las hay
    vacías, y preguntarle a Google por una cadena vacía es una llamada
    tirada y un aviso en el log cada vez que se sincroniza.
  */
  const buscables = orders.filter(
    (o) => o.address.trim() !== "" || o.customer.trim() !== "",
  );

  const sensePunt = buscables.filter((o) => o.lat === null || o.lng === null);
  /*
    Las que tienen un punto que no es el portal se vuelven a buscar.

    Aquí entran dos cosas: las que quedaron en la calle o en el pueblo
    —Google puede saber hoy lo que no sabía el mes pasado, y una tienda
    recién dada de alta aparece con el tiempo— y las de antes de que se
    guardara el nivel, que son las que mandaban al pueblo sin decirlo.

    Con tope, porque esto corre cada vez que el transportista abre la app:
    las que queden se reintentan en la siguiente ronda.
  */
  const arevisar = buscables
    .filter(
      (o) =>
        o.lat !== null &&
        o.lng !== null &&
        (o.geoLevel === null || o.geoLevel === "carrer" || o.geoLevel === "poble"),
    )
    .slice(0, MAX_REVISIONES_POR_RONDA);

  const pending = [...sensePunt, ...arevisar];
  if (pending.length === 0) return;

  const resolved: {
    orderId: string;
    lat: number;
    lng: number;
    placeId: string | null;
    geoLevel: NivellUbicacio;
  }[] = [];

  // En serie a propósito: son pocas direcciones nuevas al día y así no se
  // dispara el rate limit de las APIs de Google en un pico.
  for (const order of pending) {
    const ubicacio = await resolveUbicacio({
      address: order.address,
      city: order.city,
      customer: order.customer || null,
    });

    if (!ubicacio) {
      console.warn(
        `Sin punto para el pedido ${order.id}: ni la dirección ("${order.address}") ` +
          `ni el cliente ("${order.customer}") le dicen nada a Google.`,
      );
      continue;
    }

    /*
      Lo que se encuentre se guarda, sea el portal o el pueblo: el
      transportista prefiere que le lleve al pueblo a que el botón no haga
      nada. Lo que NO se hace es fingir que el pueblo es la dirección — el
      nivel viaja con el punto y la tarjeta lo avisa.

      Si lo nuevo es peor que lo que ya había, se queda lo de antes: una
      revisión que hoy devuelve el pueblo no debe borrar el portal que se
      encontró en su día.
    */
    if (esPitjor(ubicacio.nivell, order.geoLevel)) continue;

    if (ubicacio.nivell !== "portal") {
      console.warn(
        `El punto del pedido ${order.id} es ${DESCRIPCIO_NIVELL[ubicacio.nivell]}, ` +
          `no el portal: "${order.address}${order.city ? `, ${order.city}` : ""}". ` +
          `Revisa la dirección en la hoja si la entrega falla.`,
      );
    }

    order.lat = ubicacio.lat;
    order.lng = ubicacio.lng;
    order.placeId = ubicacio.placeId;
    order.geoLevel = ubicacio.nivell;
    resolved.push({
      orderId: order.id,
      lat: ubicacio.lat,
      lng: ubicacio.lng,
      placeId: ubicacio.placeId,
      geoLevel: ubicacio.nivell,
    });
  }

  if (resolved.length > 0) {
    try {
      await cacheCoordinates(resolved, snapshot);
    } catch (error) {
      // Que falle el cacheo no debe tumbar la ruta: solo significa que
      // mañana habrá que volver a buscar.
      console.error("No se pudieron cachear las coordenadas en el Sheet:", error);
    }
  }
}

/** De mejor a peor. Se usa para no sustituir un punto bueno por uno malo. */
const ORDRE_NIVELL: NivellUbicacio[] = ["portal", "negoci", "carrer", "poble"];

function esPitjor(nou: NivellUbicacio, vell: Order["geoLevel"]): boolean {
  if (vell === null) return false;
  return ORDRE_NIVELL.indexOf(nou) > ORDRE_NIVELL.indexOf(vell);
}

const DESCRIPCIO_NIVELL: Record<NivellUbicacio, string> = {
  portal: "el portal",
  negoci: "la ficha del negocio en Google",
  carrer: "la calle, sin número",
  poble: "el centro del pueblo",
};

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
