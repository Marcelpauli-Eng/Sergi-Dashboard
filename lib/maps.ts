import type { Order } from "./types.ts";

/**
 * Los enlaces para navegar hasta una parada, o hasta todas.
 *
 * Aparte de `lib/routing.ts` porque aquello habla con Google y arrastra
 * `server-only`, y esto son cadenas de texto: la pantalla las necesita
 * también para abrir la app de mapas desde el móvil. Se comprueban sin red
 * en `scripts/check-maps.mts`.
 *
 * De cada sitio hay dos versiones:
 *
 *  - La `https://`, que en un ordenador abre Google Maps en el navegador.
 *  - La `comgooglemaps://`, que abre la APP de Google Maps del móvil.
 *
 * Hacen falta las dos. La app instalada en el móvil es una PWA: cuando
 * abre un enlace `https://` de Google Maps no se lo pasa a la app, lo
 * enseña dentro de un navegador —que es el "Google Maps de internet", sin
 * la voz ni el coche—. El esquema propio sí salta a la app. Y al revés: en
 * un ordenador, o en un móvil sin Google Maps instalado, el esquema no lo
 * entiende nadie y hace falta la web.
 */

/** Lo que hace falta de una parada para poder llevar a alguien hasta ella. */
type Destino = Pick<Order, "lat" | "lng" | "address"> &
  Partial<Pick<Order, "city" | "placeId">>;

/**
 * La dirección entera, con el pueblo.
 *
 * Sin el pueblo, "Carrer Gran, 12" hay en media comarca y Maps escoge el que
 * le parece. La ciudad vive en su propia columna de la hoja, así que aquí se
 * juntan las dos.
 */
function adreca(destino: Destino): string {
  return destino.city ? `${destino.address}, ${destino.city}` : destino.address;
}

/**
 * El punto, en coordenadas si las hay.
 *
 * Se prefieren a la dirección en texto: evita que Maps reinterprete la
 * dirección y mande al transportista a otro sitio. Y las que hay guardadas
 * son del portal: las que solo sitúan el pueblo no se guardan —ver
 * `fillMissingCoordinates`—, justamente para que aquí se caiga al texto,
 * que Maps sí busca, en vez de navegar al centro del pueblo.
 */
function punt(destino: Destino): string {
  return destino.lat !== null && destino.lng !== null
    ? `${destino.lat},${destino.lng}`
    : adreca(destino);
}

/**
 * Navegar hasta una parada, en el navegador.
 *
 * Cuando se sabe el `placeId` se manda ese, con la dirección de etiqueta:
 * es el portal exacto de Google y con él Maps no vuelve a interpretar nada.
 * Sin él, las coordenadas; y sin coordenadas, la dirección con su pueblo.
 */
export function navUrlFor(order: Destino): string {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  if (order.placeId) {
    /*
      Con `destination_place_id`, `destination` es solo lo que se lee en
      pantalla —Google exige que vaya, pero manda el identificador—. Se pone
      la dirección para que el transportista vea a dónde va.
    */
    url.searchParams.set("destination", adreca(order));
    url.searchParams.set("destination_place_id", order.placeId);
  } else {
    url.searchParams.set("destination", punt(order));
  }
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}

/**
 * Navegar hasta una parada, en la APP de Google Maps.
 *
 * `comgooglemaps://` es el esquema de la app para iPhone. Si no está
 * instalada no lo entiende nadie y no pasa nada —por eso quien lo usa tiene
 * preparada la vuelta a la web: ver `obrirMaps`.
 */
export function appNavUrlFor(order: Destino): string {
  const url = new URL("comgooglemaps://");
  url.searchParams.set("daddr", punt(order));
  url.searchParams.set("directionsmode", "driving");
  return url.toString();
}

/**
 * La ruta entera con todas las paradas, en el navegador.
 *
 * La URL API de Google admite como máximo 9 paradas intermedias, así que
 * por encima de eso devolvemos `null` y el transportista navega parada a
 * parada, que es como se trabaja en reparto de todas formas.
 */
export function fullRouteUrlFor(
  depotAddress: string,
  stops: Destino[],
): string | null {
  if (stops.length === 0) return null;
  if (stops.length > 10) return null;

  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", depotAddress);
  url.searchParams.set("destination", punt(stops[stops.length - 1]));
  if (stops.length > 1) {
    url.searchParams.set("waypoints", stops.slice(0, -1).map(punt).join("|"));
  }
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}

/**
 * La ruta entera en la APP de Google Maps.
 *
 * El esquema de la app no tiene parámetro de paradas intermedias: se
 * encadenan en el destino con "to:", que es como lo entiende Google Maps
 * desde siempre — `daddr=primera+to:segunda+to:tercera`.
 */
export function appRouteUrlFor(
  depotAddress: string,
  stops: Destino[],
): string | null {
  if (stops.length === 0) return null;
  if (stops.length > 10) return null;

  const url = new URL("comgooglemaps://");
  url.searchParams.set("saddr", depotAddress);
  /*
    Con un espacio delante del "to:", no con un "+".

    En una query, el "+" ES el espacio ya codificado; escribirlo tal cual lo
    codificaría como un signo de más de verdad (`%2B`) y Google Maps leería
    "A+to:B" como el nombre de un sitio en vez de como dos paradas.
  */
  url.searchParams.set("daddr", stops.map(punt).join(" to:"));
  url.searchParams.set("directionsmode", "driving");
  return url.toString();
}

/**
 * Abre la app de mapas, y si no está instalada, la web.
 *
 * Un esquema propio que nadie entiende no da error: simplemente no pasa
 * nada, y el botón se queda muerto. Por eso se programa la vuelta a la web
 * y se cancela si la app llega a abrirse.
 *
 * Cómo se sabe que se ha abierto: el navegador pasa a segundo plano y la
 * página se esconde. Sin esa comprobación, al volver de Google Maps te
 * encontrarías el navegador con el mapa cargado encima.
 */
export function obrirMaps(appUrl: string, webUrl: string | null): void {
  if (typeof window === "undefined") return;

  if (webUrl) {
    const tornada = setTimeout(() => {
      window.location.href = webUrl;
    }, 1500);
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) clearTimeout(tornada);
      },
      { once: true },
    );
  }

  window.location.href = appUrl;
}
