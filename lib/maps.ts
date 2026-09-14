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
type Destino = Pick<Order, "lat" | "lng" | "address"> & {
  city?: string | null;
};

/**
 * La dirección tal y como hay que buscarla: calle Y población.
 *
 * La calle sola no basta. "Carrer Cabrerés, 2" hay en media Cataluña, así
 * que Maps abre la pantalla de resultados —o se planta sin navegar— en vez
 * de arrancar la ruta. La población es justo lo que lo desambigua, y en la
 * comanda viene aparte de la calle: `address` es la calle, `city` el
 * pueblo. Es la misma pareja que ya se junta para geocodificar en
 * `fillMissingCoordinates`.
 */
export function adrecaCompleta(destino: Destino): string {
  return [destino.address.trim(), destino.city?.trim()]
    .filter((tros) => tros)
    .join(", ");
}

/**
 * El punto, en coordenadas si las hay.
 *
 * Se prefieren a la dirección en texto: evita que Maps reinterprete la
 * dirección y mande al transportista a otro sitio. Cuando no las hay
 * —comanda recién apuntada, todavía sin geocodificar— va la dirección
 * entera, con población.
 */
function punt(destino: Destino): string {
  return destino.lat !== null && destino.lng !== null
    ? `${destino.lat},${destino.lng}`
    : adrecaCompleta(destino);
}

/** Navegar hasta una parada, en el navegador. */
export function navUrlFor(order: Destino): string {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", punt(order));
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
