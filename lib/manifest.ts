import "server-only";
import { env } from "./env";
import {
  readImportes,
  readSheet,
  cacheCoordinates,
  type CoordCacheada,
  type SheetSnapshot,
} from "./sheets";
import {
  geocodeAddress,
  geocodificar,
  navUrlFor,
  type Coord,
} from "./routing";
import { adrecaCompleta, normalitzaAdreca } from "./maps";
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
 * Cuántas direcciones distintas se buscan como mucho en una sincronización.
 *
 * Hay tope porque la primera vez que esto corre sobre una hoja con meses de
 * trabajo dentro hay cientos de direcciones sin coordenadas, y buscarlas
 * todas de una tacada son minutos: la petición reventaría por tiempo y el
 * transportista se quedaría mirando la rueda. Con tope, cada sincronización
 * se come un trozo y en unas cuantas está todo hecho. Mientras tanto no se
 * pierde nada: una comanda sin coordenadas navega por su dirección en
 * texto, que desde `adrecaCompleta` lleva calle y población.
 */
const MAX_PER_SINCRONITZACIO = 20;

/**
 * Solo una tanda a la vez en todo el proceso.
 *
 * La app sincroniza al abrirse y al volver a la pestaña, así que es normal
 * que dos peticiones se solapen. Sin esto las dos buscarían las mismas
 * direcciones —se paga cada consulta— y las dos escribirían las mismas
 * celdas.
 *
 * La que espera no se lleva el resultado: lo encontrado se guarda en la
 * hoja, no en sus comandas, así que sus paradas salen por texto y aparecen
 * con coordenadas en la sincronización siguiente. Es a propósito: pagar dos
 * veces por la misma calle para adelantar un minuto no compensa.
 */
let geocodificantAra: Promise<void> | null = null;

/**
 * Una parada a la que hay que ir: no está entregada y no se sabe dónde cae.
 *
 * Entregadas fuera. Una comanda cerrada no se navega nunca más, y en una
 * hoja con el histórico dentro son la inmensa mayoría: buscarlas sería
 * pagarle a Google por direcciones a las que ya nadie va. Las de incidencia
 * SÍ entran, que son justo las que hay que volver a intentar.
 */
function toca(order: Order): boolean {
  if (order.statusCategory === "entregat") return false;
  if (adrecaCompleta(order) === "") return false;
  if (order.lat !== null && order.lng !== null) return false;
  /*
    Ya se preguntó por esta misma dirección y Google no la reconoció. No se
    vuelve a preguntar hasta que alguien la corrija —y cuando la corrija,
    `geoAddress` dejará de coincidir y volverá a entrar aquí—.
  */
  if (order.geoAddress && normalitzaAdreca(order.geoAddress) === normalitzaAdreca(adrecaCompleta(order))) {
    return false;
  }
  return true;
}

/**
 * Busca las coordenadas de las comandas que están por repartir y las guarda
 * en el Sheet.
 *
 * Se llama en cada sincronización, no solo al generar la ruta: la comanda se
 * navega desde la bossa mucho antes de que nadie pulse "Generar ruta", y
 * hasta ahora las que se abrían desde allí no tenían coordenadas y salían
 * por texto. Como lo que se busca se guarda en la hoja, la segunda vez ya no
 * se paga: el trabajo de verdad es solo el de las comandas nuevas y el de
 * las direcciones que alguien haya corregido.
 *
 * Muta los pedidos recibidos: a partir de aquí ya tienen lat/lng.
 */
export async function geocodificarPendents(
  orders: Order[],
  snapshot: SheetSnapshot,
): Promise<void> {
  if (geocodificantAra) return geocodificantAra;
  const tanda = geocodificarTanda(orders, snapshot).finally(() => {
    geocodificantAra = null;
  });
  geocodificantAra = tanda;
  return tanda;
}

async function geocodificarTanda(
  orders: Order[],
  snapshot: SheetSnapshot,
): Promise<void> {
  /*
    Agrupadas por dirección, no por comanda.

    El mismo cliente sale muchas veces —la ferretería de siempre, tres veces
    por semana— y todas esas filas llevan la misma calle. Preguntando por
    comanda se pagaría la misma consulta una vez por fila; preguntando por
    dirección se paga una y se reparte el resultado entre todas.
  */
  const perAdreca = new Map<string, { adreca: string; comandes: Order[] }>();
  for (const order of orders) {
    if (!toca(order)) continue;
    const adreca = adrecaCompleta(order);
    const clau = normalitzaAdreca(adreca);
    const grup = perAdreca.get(clau);
    if (grup) grup.comandes.push(order);
    else perAdreca.set(clau, { adreca, comandes: [order] });
  }
  if (perAdreca.size === 0) return;

  const tanda = [...perAdreca.values()].slice(0, MAX_PER_SINCRONITZACIO);
  const resolved: CoordCacheada[] = [];

  // En serie a propósito: son pocas direcciones nuevas al día y así no se
  // dispara el rate limit de la Geocoding API en un pico.
  for (const { adreca, comandes } of tanda) {
    const resultat = await geocodificar(adreca);

    if (resultat.estat === "sense_resposta") {
      /*
        No se ha podido preguntar —sin red, sin cuota, la clave mal—. Ni se
        apunta ni se sigue: si el servicio no contesta, las de detrás
        tampoco van a contestar, y cada una es otra espera que el
        transportista paga mirando la rueda. Se reintenta en la siguiente
        sincronización.
      */
      console.warn(`Geocoding sin respuesta (${resultat.motiu}); se reintenta luego.`);
      break;
    }

    if (resultat.estat === "desconeguda") {
      /*
        Google contestó que no la conoce. Se apunta la dirección SIN
        coordenadas: deja constancia de que ya se preguntó y evita repetir
        la misma consulta en cada sincronización, para siempre. En cuanto
        alguien corrija la dirección dejará de coincidir y se volverá a
        buscar.
      */
      console.warn(`Dirección no reconocida por Google: "${adreca}"`);
      for (const order of comandes) {
        order.geoAddress = adreca;
        resolved.push({ orderId: order.id, address: adreca, lat: null, lng: null });
      }
      continue;
    }

    for (const order of comandes) {
      order.lat = resultat.coord.lat;
      order.lng = resultat.coord.lng;
      order.geoAddress = adreca;
      resolved.push({
        orderId: order.id,
        address: adreca,
        lat: resultat.coord.lat,
        lng: resultat.coord.lng,
      });
    }
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
 * Lo mismo, pero solo para las comandas de una ruta concreta y sin tope.
 *
 * Aquí sí hace falta esperar a tenerlas todas: sin coordenadas una parada se
 * queda fuera del cálculo de la ruta, y quien acaba de pulsar "Generar ruta"
 * está esperando precisamente a eso.
 */
export async function fillMissingCoordinates(
  orders: Order[],
  snapshot: SheetSnapshot,
): Promise<void> {
  const pending = orders.filter(
    (o) => (o.lat === null || o.lng === null) && adrecaCompleta(o) !== "",
  );
  if (pending.length === 0) return;

  const resolved: CoordCacheada[] = [];

  for (const order of pending) {
    const adreca = adrecaCompleta(order);
    const coord = await geocodeAddress(adreca);
    if (!coord) {
      console.warn(
        `Dirección no reconocida por Google (pedido ${order.id}): "${adreca}"`,
      );
      continue;
    }
    order.lat = coord.lat;
    order.lng = coord.lng;
    order.geoAddress = adreca;
    resolved.push({ orderId: order.id, address: adreca, lat: coord.lat, lng: coord.lng });
  }

  if (resolved.length > 0) {
    try {
      await cacheCoordinates(resolved, snapshot);
    } catch (error) {
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

  /*
    Buscar las coordenadas que falten forma parte de sincronizar.

    Antes solo pasaba al generar la ruta, y una comanda que se abre desde la
    bossa —que es donde se mira antes de salir— llegaba sin coordenadas y se
    navegaba por texto. Se espera a que acabe porque lo que encuentra tiene
    que salir en ESTE manifiesto; que no tumbe la sincronización si Google
    falla, que las paradas se ven igual sin coordenadas.
  */
  try {
    await geocodificarPendents(snapshot.orders, snapshot);
  } catch (error) {
    console.error("No se han podido geocodificar las comandas pendientes:", error);
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
