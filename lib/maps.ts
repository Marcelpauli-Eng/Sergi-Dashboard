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
  placeId?: string | null;
  geoLevel?: Order["geoLevel"];
};

/**
 * La dirección tal y como hay que buscarla: calle Y población.
 *
 * La calle sola no basta. "Carrer Cabrerés, 2" hay en media Cataluña, así
 * que Maps abre la pantalla de resultados —o se planta sin navegar— en vez
 * de arrancar la ruta. La población es justo lo que lo desambigua, y en la
 * comanda viene aparte de la calle: `address` es la calle, `city` el
 * pueblo.
 */
export function adrecaCompleta(destino: Destino): string {
  return [destino.address.trim(), destino.city?.trim()]
    .filter((tros) => tros)
    .join(", ");
}

/**
 * La misma dirección escrita de dos maneras es la misma dirección.
 *
 * Se compara así, y no letra a letra, porque corregir "carrer" por "Carrer"
 * o quitar un espacio de más no mueve el portal ni un metro: volver a
 * geocodificar por eso es pagar una consulta a Google para acabar en el
 * mismo sitio. Los acentos también caen: la oficina escribe "Cabreres" y
 * "Cabrerés" el mismo día.
 */
export function normalitzaAdreca(adreca: string): string {
  return adreca
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Si dos direcciones llevan al mismo sitio. */
export function mateixaAdreca(a: string, b: string): boolean {
  return normalitzaAdreca(a) === normalitzaAdreca(b);
}

/**
 * Si el punto guardado es el sitio, o solo la zona.
 *
 * `portal` y `negoci` son el sitio: se navega por coordenadas, que es lo que
 * evita que Maps reinterprete nada. `carrer` deja en la calle correcta, que
 * para repartir sirve. `poble` es el centro del pueblo, y ahí las
 * coordenadas son justo lo que NO se quiere: mejor darle a Maps la
 * dirección escrita y que la busque él, que a lo mejor la conoce.
 */
function puntDeFiar(destino: Destino): boolean {
  if (destino.lat === null || destino.lng === null) return false;
  return destino.geoLevel !== "poble";
}

/**
 * El punto, en coordenadas si las hay.
 *
 * Se prefieren a la dirección en texto: evita que Maps reinterprete la
 * dirección y mande al transportista a otro sitio. Cuando no las hay —o
 * cuando las que hay solo sitúan el pueblo— va la dirección entera, con
 * población, que Maps al menos busca.
 */
function punt(destino: Destino): string {
  return puntDeFiar(destino)
    ? `${destino.lat},${destino.lng}`
    : adrecaCompleta(destino) || `${destino.lat},${destino.lng}`;
}

/**
 * Quita el número de una dirección para quedarse con la calle.
 *
 * "Carrer Cabrerés, 2" → "Carrer Cabrerés". Sirve para el peldaño de la
 * calle: cuando el número no existe o Google no lo tiene, la calle entera
 * sí la conoce, y deja al transportista en el sitio correcto.
 *
 * Primero se va el piso y la puerta y después el número, en ese orden: en
 * la hoja real hay "Carrer Sicilia, 173 2º 1ª" y "Av. Catalunya, 20 - 9D",
 * y quitando solo lo último quedaba la calle con el número pegado —o peor,
 * con el guión suelto al final—.
 */
export function nomDeCarrer(address: string): string {
  let carrer = address.trim();

  /*
    El piso y la puerta, tantas veces como haya.

    Son las formas que se escriben de verdad: "2º 1ª", "3r 2a", "- 9D",
    "bajos", "local", "esc B", "pta 4". Se repite porque van en cadena
    —"173 2º 1ª" son dos— y una sola pasada dejaría la mitad.
  */
  const pisos =
    /[\s,;-]+(\d+\s*[ºªoa°]\s*|\d+\s*[a-zA-Z]\b|(baixos|bajos|local|escala|esc|porta|pta|pis|planta|atico|àtic)\b\.?\s*[a-zA-Z0-9]*)$/iu;
  let abans = "";
  while (abans !== carrer) {
    abans = carrer;
    carrer = carrer.replace(pisos, "").trim();
  }

  /*
    El "S/N" —sin número— también se va.

    Es una forma de decir que no hay portal, no parte del nombre de la
    calle, y dejándolo dentro Google busca un sitio que se llama así.
  */
  carrer = carrer.replace(/[\s,;-]+s\s*\/?\s*n\.?$/iu, "");

  // Y ahora sí, el número del portal.
  carrer = carrer.replace(/[,;]?\s*(n[.ºo]*|num(ero)?\.?)?\s*\d+\s*$/u, "");

  // Lo que quede colgando: comas, guiones, puntos suspensivos de nada.
  return carrer.replace(/[\s,;.\-]+$/u, "").trim();
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
  if (order.placeId && order.geoLevel !== "poble") {
    /*
      Con `destination_place_id`, `destination` es solo lo que se lee en
      pantalla —Google exige que vaya, pero manda el identificador—. Se pone
      la dirección para que el transportista vea a dónde va.
    */
    url.searchParams.set("destination", adrecaCompleta(order));
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
 * Navegar con Apple Mapes.
 *
 * Mismo criterio que con Google: las coordenadas solo cuando son del sitio.
 * Si lo que hay es el centro del pueblo, se le pasa la dirección escrita.
 */
export function appleNavUrlFor(order: Destino): string {
  return `http://maps.apple.com/?daddr=${encodeURIComponent(punt(order))}&dirflg=d`;
}

/**
 * Navegar con Waze.
 *
 * Waze tiene dos parámetros distintos: `ll` para coordenadas y `q` para
 * buscar por texto. No se pueden confundir —un `ll` con una dirección
 * dentro no lleva a ninguna parte—, así que se elige el que toca.
 */
export function wazeNavUrlFor(order: Destino): string {
  if (puntDeFiar(order)) {
    return `https://waze.com/ul?ll=${order.lat},${order.lng}&navigate=yes`;
  }
  return `https://waze.com/ul?q=${encodeURIComponent(adrecaCompleta(order))}&navigate=yes`;
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
