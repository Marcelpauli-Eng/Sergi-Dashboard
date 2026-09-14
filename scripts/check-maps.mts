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
  adrecaCompleta,
  mateixaAdreca,
  appNavUrlFor,
  appRouteUrlFor,
  fullRouteUrlFor,
  navUrlFor,
} from "../lib/maps.ts";

const parada = (
  lat: number | null,
  lng: number | null,
  address = "Carrer Gran 1",
  city: string | null = null,
) => ({
  lat,
  lng,
  address,
  city,
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

// ── Sin coordenadas, la población va con la calle ────────────────────────
// La calle sola es ambigua —"Carrer Cabrerés, 2" hay en varios pueblos— y
// Maps se planta en la pantalla de resultados en vez de arrancar la ruta.
{
  const vic = parada(null, null, "Carrer Cabrerés, 2", "08500 Vic");

  assert.equal(adrecaCompleta(vic), "Carrer Cabrerés, 2, 08500 Vic");
  assert.equal(
    new URL(appNavUrlFor(vic)).searchParams.get("daddr"),
    "Carrer Cabrerés, 2, 08500 Vic",
    "sin la población, Maps no sabe a qué pueblo va",
  );
  assert.equal(
    new URL(navUrlFor(vic)).searchParams.get("destination"),
    "Carrer Cabrerés, 2, 08500 Vic",
  );

  // Sin población, la calle tal cual y sin comas colgando.
  assert.equal(adrecaCompleta(parada(null, null, "Carrer Gran 1")), "Carrer Gran 1");
  assert.equal(adrecaCompleta(parada(null, null, "Carrer Gran 1", "  ")), "Carrer Gran 1");

  // Con coordenadas mandan ellas: la población no las sustituye.
  assert.equal(
    new URL(appNavUrlFor(parada(41.9, 2.25, "Carrer Cabrerés, 2", "08500 Vic"))).searchParams.get("daddr"),
    "41.9,2.25",
  );
}

// ── La misma dirección escrita de otra manera ────────────────────────────
// Decide si unas coordenadas cacheadas siguen valiendo: con esto, corregir
// "cabreres" por "Cabrerés" no cuesta una consulta a Google para acabar en
// el mismo portal. Cambiar el número sí.
{
  assert.ok(mateixaAdreca("Carrer Cabrerés, 2", "carrer cabreres 2"));
  assert.ok(mateixaAdreca("  Carrer  Gran   1 ", "Carrer Gran 1"));
  assert.equal(mateixaAdreca("Carrer Cabrerés, 2", "Carrer Cabrerés, 8"), false);
  assert.equal(
    mateixaAdreca("Carrer Cabrerés, 2, 08500 Vic", "Carrer Cabrerés, 2, 08240 Manresa"),
    false,
    "otro pueblo es otro sitio",
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

console.log("✓ lib/maps.ts — els enllaços obren l'app de mapes, no el navegador");
