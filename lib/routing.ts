import "server-only";
import { env } from "./env";
import type { Order } from "./types";
import { adrecaCompleta, nomDeCarrer } from "./maps.ts";

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

/** Lo que Google sabe de una dirección, con lo fino que hila cada respuesta. */
export interface GeocodeResult extends Coord {
  /**
   * Si el punto es el portal y no el centro del pueblo.
   *
   * Google siempre contesta algo: cuando no encuentra el número, o la calle,
   * devuelve el centroide de la población y lo marca como aproximado. Ese
   * punto es el que mandaba al transportista "al pueblo" en vez de a la
   * calle, así que aquí se distingue para no guardarlo como si fuera bueno.
   */
  precise: boolean;
  /**
   * El identificador del sitio en Google. Es lo único que señala un portal
   * sin ambigüedad posible: navegando con él, Maps no vuelve a interpretar
   * la dirección por su cuenta.
   */
  placeId: string | null;
}

/**
 * Qué tipos de resultado son "el pueblo" y no "la calle".
 *
 * Google los devuelve en `results[].types`. Si el más específico que sabe
 * decir es uno de estos, no tiene el portal.
 */
const TIPOS_IMPRECISOS = new Set([
  "locality",
  "sublocality",
  "postal_code",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "political",
  "country",
  "neighborhood",
]);

/**
 * Lo que contestó Google al preguntarle por una dirección.
 *
 * Hay tres respuestas y no dos, porque "no la encuentro" y "ahora no puedo
 * contestarte" se arreglan de forma distinta: la primera es definitiva —esa
 * dirección no existe tal y como está escrita, y volver a preguntar mañana
 * dará lo mismo— y la segunda es de hoy: sin red, sin cuota o con la clave
 * mal, y la misma pregunta mañana sí tiene respuesta.
 *
 * La diferencia importa porque las definitivas se apuntan en la hoja para no
 * volver a preguntarlas nunca —cada consulta se paga— y las de hoy NO: si se
 * apuntaran, un corte de red dejaría la comanda sin coordenadas para
 * siempre.
 */
export type ResultatGeocodificacio =
  | { estat: "ok"; coord: Coord; precise: boolean; placeId: string | null }
  /** Google contestó, y esa dirección no la reconoce. */
  | { estat: "desconeguda" }
  /** No se le ha podido preguntar. Se reintenta más adelante. */
  | { estat: "sense_resposta"; motiu: string };

export async function geocodificar(
  address: string,
): Promise<ResultatGeocodificacio> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", env.google.mapsApiKey);
  // Sesga los resultados ambiguos hacia España.
  url.searchParams.set("region", "es");
  url.searchParams.set("language", "es");

  let data: {
    status: string;
    error_message?: string;
    results?: {
      geometry: { location: { lat: number; lng: number }; location_type?: string };
      place_id?: string;
      types?: string[];
      partial_match?: boolean;
    }[];
  };
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return { estat: "sense_resposta", motiu: `HTTP ${response.status}` };
    }
    data = await response.json();
  } catch (error) {
    return { estat: "sense_resposta", motiu: String(error) };
  }

  if (data.status === "OK" && data.results?.length) {
    const result = data.results[0];
    const { lat, lng } = result.geometry.location;

    /*
      Tres señales, y basta con que falle una para no fiarse:

       - `partial_match`: Google ha tenido que inventarse parte de lo que se
         le pidió (típico cuando el número no existe en esa calle).
       - `location_type: APPROXIMATE`: el punto es un centroide, no un
         portal. "ROOFTOP" es el tejado; "RANGE_INTERPOLATED" y
         "GEOMETRIC_CENTER" son el tramo de calle, que para repartir sirve.
       - `types`: si lo más fino que sabe decir es "locality", lo que ha
         devuelto es el pueblo entero.

      Sin esto, el centroide del pueblo se guardaba como si fuera la
      dirección y el transportista acababa allí, con toda la seguridad del
      mundo.
    */
    const tipoMasEspecifico = result.types?.[0];
    const precise =
      result.partial_match !== true &&
      result.geometry.location_type !== "APPROXIMATE" &&
      (tipoMasEspecifico === undefined || !TIPOS_IMPRECISOS.has(tipoMasEspecifico));

    return {
      estat: "ok",
      coord: { lat, lng },
      precise,
      placeId: result.place_id ?? null,
    };
  }

  /*
    ZERO_RESULTS es la única negativa que es de la dirección. El resto
    —cuota agotada, clave mal, petición malformada, un error de Google— son
    del servicio, y la misma dirección volverá a intentarse.
  */
  if (data.status === "ZERO_RESULTS" || (data.status === "OK" && !data.results?.length)) {
    return { estat: "desconeguda" };
  }
  return {
    estat: "sense_resposta",
    motiu: data.error_message ? `${data.status}: ${data.error_message}` : data.status,
  };
}

/** Las coordenadas a secas, para quien no necesita saber más. */
export async function geocodeAddress(address: string): Promise<Coord | null> {
  const resultat = await geocodificar(address);
  return resultat.estat === "ok" ? resultat.coord : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Buscar el sitio: portal, negocio, calle o pueblo
// ─────────────────────────────────────────────────────────────────────────

/**
 * Hasta dónde afina el punto que hemos encontrado.
 *
 *  - `portal`: la dirección exacta. Es lo que se quiere.
 *  - `negoci`: la ficha del negocio en Google, encontrada por su nombre.
 *    Se usa cuando la dirección escrita no da con el portal —polígonos,
 *    carreteras, naves sin número—, y suele clavarla mejor que el número.
 *  - `carrer`: la calle sin número. No es el portal, pero deja al
 *    transportista en la calle correcta.
 *  - `poble`: el centro del pueblo. El último recurso, y se avisa en la
 *    tarjeta de que es eso.
 */
export type NivellUbicacio = "portal" | "negoci" | "carrer" | "poble";

/** Un sitio ya resuelto, con lo fino que ha quedado. */
export interface Ubicacio extends Coord {
  placeId: string | null;
  nivell: NivellUbicacio;
}

/**
 * Lo que sale de buscar un sitio, con las mismas tres respuestas.
 *
 * "Desconeguda" significa que Google contestó que no a TODOS los peldaños:
 * ni la dirección, ni el negocio, ni la calle, ni el pueblo. Solo entonces
 * se apunta en la hoja para no volver a preguntar.
 */
export type ResultatUbicacio =
  | { estat: "ok"; ubicacio: Ubicacio }
  | { estat: "desconeguda" }
  | { estat: "sense_resposta"; motiu: string };

/**
 * Cuánto se puede alejar del pueblo un negocio para creérselo, en metros.
 *
 * Buscar "Mobles Serra" por el nombre puede devolver una tienda que se llama
 * igual a 200 km. Si el sitio que contesta Google no está cerca del pueblo
 * de la comanda, no es ese: mejor la calle o el pueblo que mandar al
 * transportista a otra provincia.
 */
const RADI_NEGOCI_M = 25_000;

/**
 * Busca un sitio por su nombre (Places API).
 *
 * Es OTRA API que la de geocodificar: el geocodificador solo entiende
 * direcciones —"Carrer Gran 12"—, y no sabe nada de "Fusteria Vilalta". Hay
 * que tener activada "Places API (New)" en el mismo proyecto de Google
 * Cloud; si no lo está, Google contesta 403 y esto devuelve `null`, con lo
 * que la búsqueda sigue por la calle como si el paso no existiera.
 */
export async function findPlaceByName(
  nom: string,
  aprop: Coord | null,
): Promise<Ubicacio | null> {
  const body: Record<string, unknown> = {
    textQuery: nom,
    languageCode: "ca",
    regionCode: "ES",
  };
  if (aprop) {
    // Sesga la búsqueda al pueblo de la comanda: sin esto, un nombre de
    // negocio corriente devuelve el de la otra punta del país.
    body.locationBias = {
      circle: {
        center: { latitude: aprop.lat, longitude: aprop.lng },
        radius: RADI_NEGOCI_M,
      },
    };
  }

  let data: {
    places?: { id?: string; location?: { latitude: number; longitude: number } }[];
  };
  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.google.mapsApiKey,
        "X-Goog-FieldMask": "places.id,places.location,places.formattedAddress",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) {
      // 403 = la Places API no está activada en el proyecto. Se avisa una
      // vez y se sigue: la cascada tiene más peldaños por debajo.
      avisarPlacesUnaVez(response.status, await response.text());
      return null;
    }
    data = (await response.json()) as typeof data;
  } catch {
    return null;
  }

  const place = data.places?.[0];
  if (!place?.location) return null;

  const punt = { lat: place.location.latitude, lng: place.location.longitude };
  // Lejos del pueblo: es otro negocio que se llama igual.
  if (aprop && haversine(aprop, punt) > RADI_NEGOCI_M) return null;

  return { ...punt, placeId: place.id ?? null, nivell: "negoci" };
}

/** El 403 de Places es siempre el mismo y es de configuración: una vez basta. */
let placesAvisada = false;
function avisarPlacesUnaVez(status: number, body: string): void {
  if (placesAvisada) return;
  placesAvisada = true;
  console.warn(
    `No se ha podido buscar por nombre de negocio (Places API respondió ${status}). ` +
      `Si es un 403, activa "Places API (New)" en el proyecto de Google Cloud de GOOGLE_MAPS_API_KEY. ` +
      `Mientras tanto se navega por calle o pueblo. ${body.slice(0, 200)}`,
  );
}

/**
 * Encuentra el mejor punto posible para una comanda, por este orden:
 *
 *   1. La dirección exacta, si Google da con el portal.
 *   2. El negocio por su nombre, si la comanda es de una empresa.
 *   3. La calle sin número.
 *   4. El centro del pueblo.
 *
 * El nivel al que ha llegado va dentro, para que la pantalla pueda decir
 * "esto es la calle, no el portal" en vez de fingir precisión.
 */
export async function resolveUbicacio(dades: {
  address: string;
  city: string | null;
  customer: string | null;
}): Promise<ResultatUbicacio> {
  const adreca = adrecaCompleta({ ...dades, lat: null, lng: null });

  /*
    Si en algún momento Google no ha podido contestar, la comanda NO se
    apunta como desconocida: se reintenta otro día. Apuntarla por un corte
    de red la dejaría sin coordenadas para siempre.
  */
  let hiHaHagutFallada: string | null = null;

  // 1. El portal.
  let poble: { coord: Coord; placeId: string | null } | null = null;
  if (adreca) {
    const exacta = await geocodificar(adreca);
    if (exacta.estat === "ok") {
      if (exacta.precise) {
        return {
          estat: "ok",
          ubicacio: { ...exacta.coord, placeId: exacta.placeId, nivell: "portal" },
        };
      }
      /*
        Impreciso: ESTO es el centroide del pueblo, y ya lo tenemos. Se
        guarda para el final —es mejor que nada— y para sesgar la búsqueda
        del negocio.
      */
      poble = { coord: exacta.coord, placeId: exacta.placeId };
    } else if (exacta.estat === "sense_resposta") {
      hiHaHagutFallada = exacta.motiu;
    }
  }

  if (!poble && dades.city && !hiHaHagutFallada) {
    const nomesPoble = await geocodificar(dades.city);
    if (nomesPoble.estat === "ok") {
      poble = { coord: nomesPoble.coord, placeId: nomesPoble.placeId };
    } else if (nomesPoble.estat === "sense_resposta") {
      hiHaHagutFallada = nomesPoble.motiu;
    }
  }

  // 2. El negocio por su nombre.
  if (dades.customer?.trim()) {
    const consulta = [dades.customer, dades.address, dades.city]
      .filter((tros) => tros && String(tros).trim())
      .join(", ");
    const negoci = await findPlaceByName(consulta, poble?.coord ?? null);
    if (negoci) return { estat: "ok", ubicacio: negoci };
  }

  // 3. La calle sin número.
  const carrer = nomDeCarrer(dades.address);
  if (carrer && carrer !== dades.address.trim()) {
    const nomes = dades.city ? `${carrer}, ${dades.city}` : carrer;
    const trobat = await geocodificar(nomes);
    if (trobat.estat === "ok" && trobat.precise) {
      return {
        estat: "ok",
        ubicacio: { ...trobat.coord, placeId: trobat.placeId, nivell: "carrer" },
      };
    }
    if (trobat.estat === "sense_resposta") hiHaHagutFallada = trobat.motiu;
  }

  // 4. El pueblo, que es mejor que nada.
  if (poble) {
    return {
      estat: "ok",
      ubicacio: { ...poble.coord, placeId: poble.placeId, nivell: "poble" },
    };
  }

  return hiHaHagutFallada
    ? { estat: "sense_resposta", motiu: hiHaHagutFallada }
    : { estat: "desconeguda" };
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
  /**
   * Geometría del recorrido codificada (formato polyline de Google), para
   * dibujar la traza. `null` cuando se cae al orden por prioridad, que no
   * pasa por Google y por tanto no tiene recorrido que dibujar.
   */
  encodedPolyline: string | null;
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
    encodedPolyline: null,
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
  forceOrder: boolean = false,
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
      optimized: true, // Se considera optimizada aunque sea 1 sola parada
          encodedPolyline: null,
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
    optimizeWaypointOrder: !forceOrder,
    languageCode: "es-ES",
    units: "METRIC",
  };

  let data: {
    routes?: {
      optimizedIntermediateWaypointIndex?: number[];
      distanceMeters?: number;
      duration?: string;
      legs?: { distanceMeters?: number; duration?: string }[];
      polyline?: { encodedPolyline?: string };
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
            // Geometría del recorrido, para poder dibujar la traza que sigue
            // las calles en vez de líneas rectas entre paradas.
            "routes.polyline.encodedPolyline",
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
  
  // Si forceOrder es true, Google no devuelve optimizedIntermediateWaypointIndex
  // por lo que generamos un array secuencial [0, 1, 2...]
  const order = forceOrder 
    ? Array.from({ length: routable.length }, (_, i) => i)
    : route?.optimizedIntermediateWaypointIndex;
    
  if (!route || !order || order.length !== routable.length) {
    return fallbackOrder(orders);
  }

  // `order[i]` es el índice original de la parada que ocupa la posición i en la ruta.
  let ordered = order.map((originalIndex) => routable[originalIndex]);
  let legsData = route.legs ?? [];
  
  // Si hemos forzado el orden manualmente, no tiene sentido romperlo aplicando
  // el desempate por prioridad automático.
  if (!forceOrder) {
    // Asegurarnos de que empezamos por la parada más cercana (Google a veces da la vuelta
    // al revés porque la ruta es circular).
    if (ordered.length > 1) {
      const dFirst = haversine(depot, { lat: ordered[0].lat!, lng: ordered[0].lng! });
      const dLast = haversine(depot, { lat: ordered[ordered.length - 1].lat!, lng: ordered[ordered.length - 1].lng! });
      
      if (dLast < dFirst) {
        ordered.reverse();
        if (legsData.length > ordered.length) {
          const reversedLegs = [];
          for (let i = ordered.length; i >= 1; i--) {
            reversedLegs.push(legsData[i]);
          }
          legsData = reversedLegs;
        }
      }
    }

    ordered = applyPriorityTiebreak(depot, ordered, 500);
  }

  // Los tramos vienen alineados con el orden que devolvió Google. Tras el
  // desempate por prioridad ese emparejamiento deja de ser exacto, así que
  // se conservan como estimación del tramo, no como dato al metro.
  const legs = legsData.slice(0, ordered.length).map((leg) => ({
    distanceMeters: leg.distanceMeters ?? null,
    durationSeconds: leg.duration ? parseInt(leg.duration, 10) : null,
  }));
  while (legs.length < ordered.length) {
    legs.push({ distanceMeters: null, durationSeconds: null });
  }

  // Las paradas sin coordenadas van al final: el transportista las ve, pero
  // no entran en el cálculo.
  const unroutable = orders.filter((o) => o.lat === null || o.lng === null);
  for (let i = 0; i < unroutable.length; i++) {
    legs.push({ distanceMeters: null, durationSeconds: null });
  }

  return {
    ordered: [...ordered, ...unroutable],
    legs,
    totalDistanceMeters: route.distanceMeters ?? null,
    totalDurationSeconds: route.duration ? parseInt(route.duration, 10) : null,
    optimized: true,
    encodedPolyline: route.polyline?.encodedPolyline ?? null,
  };
}

/*
  Los enlaces de navegación viven en `lib/maps.ts`: son cadenas de texto y
  la pantalla los necesita también para abrir la app del móvil, cosa que
  desde aquí no puede hacer —este módulo es solo de servidor—. Se
  re-exportan porque medio proyecto los importa de aquí desde siempre.
*/
export { navUrlFor, fullRouteUrlFor, appNavUrlFor, appRouteUrlFor } from "./maps.ts";

