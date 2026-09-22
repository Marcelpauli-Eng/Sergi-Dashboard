/**
 * Comprobación del camino sin API: pegar de Google Maps.
 *
 *   npm run check:coordenades
 *
 * Lo que se comprueba es que de un enlace se saca el punto DEL SITIO y no
 * el del mapa, que son distintos y se parecen bastante. Si se coge el que
 * no es, el transportista acaba donde estaba centrada la pantalla de quien
 * copió el enlace, que puede ser media calle más allá.
 *
 * Los casos con nombre de "full real" están copiados de la columna de
 * direcciones de "Copia de Transports Winkaplast".
 */

import assert from "node:assert/strict";
import {
  adrecaSenseCoordenades,
  esEnllacCurt,
  puntDe,
} from "../lib/coordenades.ts";

const aprop = (a: number, b: number, tolerancia = 0.0002) =>
  Math.abs(a - b) < tolerancia;

// ── Dos números, tal cual salen del botón derecho del mapa ───────────────
{
  const punt = puntDe("41.5719, 1.7834")!;
  assert.equal(punt.lat, 41.5719);
  assert.equal(punt.lng, 1.7834);
}

// ── Del full real: las coordenadas pegadas dentro de la dirección ────────
{
  const fila = "Cami Llibertat, 6 Coordenadas de Google Maps 41.57193321297131,1.7834358885399193";
  const punt = puntDe(fila)!;
  assert.ok(aprop(punt.lat, 41.5719319));
  assert.ok(aprop(punt.lng, 1.7834359));
  assert.equal(
    adrecaSenseCoordenades(fila),
    "Cami Llibertat, 6",
    "la dirección se queda limpia y las coordenadas van a su columna",
  );
}

// ── Del full real: grados, minutos y segundos ────────────────────────────
{
  const fila = 'Restaurant la Cassoleta Poligono, 10 parcela, 11 Coordenadas Google Maps (41°10\'37.2"N 1°00\'43.9"E)';
  const punt = puntDe(fila)!;
  assert.ok(aprop(punt.lat, 41.177), `lat inesperada: ${punt.lat}`);
  assert.ok(aprop(punt.lng, 1.01219), `lng inesperada: ${punt.lng}`);
  assert.equal(
    adrecaSenseCoordenades(fila),
    "Restaurant la Cassoleta Poligono, 10 parcela, 11",
  );
}

// ── Un enlace de Google Maps: el punto del SITIO, no el del mapa ─────────
// Los dos están dentro del mismo enlace. El "@" es dónde estaba centrada la
// pantalla; el "!3d!4d" es el sitio. Hay que coger el segundo.
{
  const enllac =
    "https://www.google.com/maps/place/Carrer+Cabrer%C3%A9s,+2/@41.9280000,2.2500000,17z/data=!3m1!4b1!4m6!3m5!1s0x12a5:0xabc!8m2!3d41.9301234!4d2.2545678";
  const punt = puntDe(enllac)!;
  assert.ok(aprop(punt.lat, 41.9301234), "hay que coger el punto del sitio");
  assert.ok(aprop(punt.lng, 2.2545678));
}

// ── Un enlace sin sitio: entonces sí, el centro del mapa ─────────────────
{
  const punt = puntDe("https://www.google.com/maps/@41.57,1.78,17z")!;
  assert.ok(aprop(punt.lat, 41.57));
  assert.ok(aprop(punt.lng, 1.78));
}

// ── El enlace de compartir, con ?q= ──────────────────────────────────────
{
  const punt = puntDe("https://maps.google.com/?q=41.3874,2.1686")!;
  assert.ok(aprop(punt.lat, 41.3874));
}

// ── Los cortos hay que seguirlos antes: no llevan el punto dentro ────────
{
  assert.equal(esEnllacCurt("https://maps.app.goo.gl/aBcDeF"), true);
  assert.equal(esEnllacCurt("https://www.google.com/maps/@41.57,1.78,17z"), false);
  assert.equal(puntDe("https://maps.app.goo.gl/aBcDeF"), null);
}

// ── Lo que NO son coordenadas ────────────────────────────────────────────
/*
  Esta es la parte que importa de verdad: una dirección normal no puede
  parecer un punto. "Poligono 3 parcela 146" son dos números seguidos, y si
  se colaran como coordenadas la comanda se iría a la otra punta del mundo
  sin que nadie lo viera.
*/
{
  assert.equal(puntDe("Poligono 3 parcela 146 camí a la venta Nova"), null);
  assert.equal(puntDe("Carrer Sicilia, 173 2º 1ª"), null);
  assert.equal(puntDe("Av. Catalunya, 20 - 9D"), null);
  assert.equal(puntDe("150 x 80 x 220 cm"), null);
  assert.equal(puntDe(""), null);
  // Fuera del mundo, y el 0,0 del Atlántico, que sale de una celda vacía.
  assert.equal(puntDe("120.5, 200.7"), null);
  assert.equal(puntDe("0.0, 0.0"), null);
}

// ── Una dirección sin coordenadas se queda como estaba ───────────────────
{
  assert.equal(
    adrecaSenseCoordenades("Carrer de Miquel Palomares, 10"),
    "Carrer de Miquel Palomares, 10",
  );
}

console.log("✓ lib/coordenades.ts — el punt enganxat de Maps s'entén sense cap API");
