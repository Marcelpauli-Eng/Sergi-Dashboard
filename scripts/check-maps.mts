/**
 * Comprobación de los enlaces de navegación.
 *
 *   npm run check:maps
 *
 * Son cadenas de texto que acaban abriendo una app, así que cuando están
 * mal no fallan: llevan a otro sitio. Lo que se comprueba aquí es que el
 * enlace de la APP sea el de la app —y no el de la web, que es el que
 * enseñaba el mapa dentro de un navegador— y que las paradas intermedias
 * lleguen enteras y en orden.
 */

import assert from "node:assert/strict";
import {
  appNavUrlFor,
  appleNavUrlFor,
  wazeNavUrlFor,
  appRouteUrlFor,
  fullRouteUrlFor,
  navUrlFor,
  nomDeCarrer,
} from "../lib/maps.ts";

const parada = (lat: number | null, lng: number | null, address = "Carrer Gran 1") => ({
  lat,
  lng,
  address,
});

// ── Una parada ───────────────────────────────────────────────────────────
{
  const web = navUrlFor(parada(41.3874, 2.1686));
  assert.ok(web.startsWith("https://www.google.com/maps/dir/"), "la web ha cambiado de sitio");
  assert.equal(new URL(web).searchParams.get("destination"), "41.3874,2.1686");

  const app = appNavUrlFor(parada(41.3874, 2.1686));
  assert.ok(
    app.startsWith("comgooglemaps://"),
    "el enlace de la app tiene que ser el esquema de la app, no una https",
  );
  assert.equal(new URL(app).searchParams.get("daddr"), "41.3874,2.1686");
  assert.equal(new URL(app).searchParams.get("directionsmode"), "driving");
}

// ── Sin coordenadas, la dirección en texto ───────────────────────────────
// Pasa con las comandas recién creadas: todavía no se han geocodificado.
{
  const app = appNavUrlFor(parada(null, null, "Carrer Cabrerés, 2, 08500 Vic"));
  assert.equal(
    new URL(app).searchParams.get("daddr"),
    "Carrer Cabrerés, 2, 08500 Vic",
    "la dirección tiene que llegar entera",
  );
}

// ── La ruta entera ───────────────────────────────────────────────────────
// En el esquema de la app no hay parámetro de paradas intermedias: van
// encadenadas en el destino con "to:". Y el separador es un ESPACIO: un "+"
// escrito tal cual se codifica como un signo de más de verdad y Google Maps
// leería "A+to:B" como el nombre de un sitio.
{
  const stops = [parada(41.1, 2.1), parada(41.2, 2.2), parada(41.3, 2.3)];
  const app = appRouteUrlFor("41.0,2.0", stops)!;
  const params = new URL(app).searchParams;

  assert.ok(app.startsWith("comgooglemaps://"));
  assert.equal(params.get("saddr"), "41.0,2.0", "la salida no es de donde se sale");
  assert.equal(
    params.get("daddr"),
    "41.1,2.1 to:41.2,2.2 to:41.3,2.3",
    "las paradas intermedias no llegan en orden, o el separador está mal",
  );
  assert.equal(app.includes("%2B"), false, "un '+' literal rompe la cadena de paradas");

  // La web sigue como estaba: la última es el destino y las otras waypoints.
  const web = new URL(fullRouteUrlFor("41.0,2.0", stops)!);
  assert.equal(web.searchParams.get("destination"), "41.3,2.3");
  assert.equal(web.searchParams.get("waypoints"), "41.1,2.1|41.2,2.2");
}

// ── Una sola parada: destino y ya ────────────────────────────────────────
{
  const app = appRouteUrlFor("41.0,2.0", [parada(41.1, 2.1)])!;
  assert.equal(new URL(app).searchParams.get("daddr"), "41.1,2.1");
  assert.equal(app.includes("to:"), false, "con una parada no hay nada que encadenar");
}

// ── Los topes ────────────────────────────────────────────────────────────
// Sin paradas no hay ruta, y por encima de diez Google no acepta la URL: se
// navega parada a parada, que es como se reparte de todas formas.
{
  assert.equal(appRouteUrlFor("41.0,2.0", []), null);
  assert.equal(fullRouteUrlFor("41.0,2.0", []), null);

  const moltes = Array.from({ length: 11 }, () => parada(41.1, 2.1));
  assert.equal(appRouteUrlFor("41.0,2.0", moltes), null);
  assert.equal(fullRouteUrlFor("41.0,2.0", moltes), null);
}

// ── El portal exacto, cuando se sabe ─────────────────────────────────────
// Es lo que arregla el "me manda al pueblo, no a la calle": con el place_id
// Google no vuelve a interpretar la dirección, va al portal que geocodificó.
{
  const web = navUrlFor({
    lat: 41.9301,
    lng: 2.2545,
    address: "Carrer Cabrerés, 2",
    city: "Vic",
    placeId: "ChIJabc123",
  });
  const params = new URL(web).searchParams;
  assert.equal(params.get("destination_place_id"), "ChIJabc123");
  assert.equal(
    params.get("destination"),
    "Carrer Cabrerés, 2, Vic",
    "la etiqueta del destino es la dirección entera, con el pueblo",
  );
}

// ── Sin portal y sin coordenadas, la dirección CON el pueblo ─────────────
// "Carrer Gran, 12" a secas lo hay en media comarca: sin el pueblo, Maps
// escoge el que le parece y ahí empieza el viaje al sitio equivocado.
{
  const app = appNavUrlFor({
    lat: null,
    lng: null,
    address: "Carrer Gran, 12",
    city: "Torelló",
    placeId: null,
  });
  assert.equal(new URL(app).searchParams.get("daddr"), "Carrer Gran, 12, Torelló");
}

// ── El punto del pueblo NO se navega por coordenadas ─────────────────────
// Es el caso que hacía que "no marcara exacto": llevar al transportista al
// centro del pueblo con toda la seguridad del mundo. Con `_geo` a "poble"
// se le pasa la dirección escrita y que la busque Maps, que a lo mejor la
// conoce; y si no, al menos el transportista ve qué está buscando.
{
  const alPoble = {
    lat: 41.9301,
    lng: 2.2545,
    address: "Carrer Nou, 44",
    city: "Manlleu",
    placeId: "ChIJpoble",
    geoLevel: "poble" as const,
  };

  assert.equal(
    new URL(navUrlFor(alPoble)).searchParams.get("destination"),
    "Carrer Nou, 44, Manlleu",
  );
  assert.equal(
    new URL(navUrlFor(alPoble)).searchParams.get("destination_place_id"),
    null,
    "el place_id del pueblo es el pueblo: no se manda",
  );
  assert.equal(
    new URL(appNavUrlFor(alPoble)).searchParams.get("daddr"),
    "Carrer Nou, 44, Manlleu",
  );
  assert.ok(wazeNavUrlFor(alPoble).includes("q="), "Waze busca por texto, no por ll");
  assert.ok(appleNavUrlFor(alPoble).includes("Manlleu"));
}

// ── La calle sin número sí es un punto que sirve ──────────────────────────
// No es el portal, pero deja al transportista en la calle correcta, que es
// mucho más de lo que hace el centro del pueblo.
{
  const alCarrer = {
    lat: 41.9312,
    lng: 2.2501,
    address: "Carrer Nou, 44",
    city: "Manlleu",
    placeId: "ChIJcarrer",
    geoLevel: "carrer" as const,
  };
  assert.equal(
    new URL(navUrlFor(alCarrer)).searchParams.get("destination_place_id"),
    "ChIJcarrer",
  );
  assert.ok(wazeNavUrlFor(alCarrer).includes("ll=41.9312,2.2501"));
}

// ── Quedarse con la calle cuando el número no existe ─────────────────────
// Es el peldaño que evita el salto directo al centro del pueblo: si Google
// no tiene el 44, la calle entera sí la conoce.
{
  assert.equal(nomDeCarrer("Carrer Cabrerés, 2"), "Carrer Cabrerés");
  assert.equal(nomDeCarrer("Carrer Nou 44"), "Carrer Nou");
  assert.equal(nomDeCarrer("Avinguda Diagonal, 405 B"), "Avinguda Diagonal");
  assert.equal(nomDeCarrer("Ctra. de Vic, nº 12"), "Ctra. de Vic");
  // Sin número no hay nada que quitar, y un polígono no se toca.
  assert.equal(nomDeCarrer("Polígon Mas Galí"), "Polígon Mas Galí");

  /*
    Y lo que hay de verdad en la hoja de la oficina, que es más sucio: el
    piso y la puerta pegados al número, el guión del "20 - 9D" —que antes
    se quedaba colgando al final— y el "S/N", que no es parte del nombre de
    la calle sino la forma de decir que no hay portal.
  */
  assert.equal(nomDeCarrer("Carrer Sicilia, 173 2º 1ª"), "Carrer Sicilia");
  assert.equal(nomDeCarrer("Av. Catalunya, 20 - 9D"), "Av. Catalunya");
  assert.equal(nomDeCarrer("Camí de la Serra, S/N"), "Camí de la Serra");
  assert.equal(nomDeCarrer("PI Mas de les Animes, C/ Guerau de Liost, 3"), "PI Mas de les Animes, C/ Guerau de Liost");
  // Un número que es del nombre no se toca: "Grup 12 de Setembre".
  assert.equal(nomDeCarrer("Camí de la Serra"), "Camí de la Serra");
}

console.log("✓ lib/maps.ts — els enllaços obren l'app de mapes, no el navegador");
