/**
 * Comprobación del buscador de direcciones.
 *
 *   npm run check:llocs
 *
 * Lo que se comprueba es el reparto: lo que contesta Google viene en un
 * montón de trozos y aquí se decide cuál va a "Adreça" y cuál a "Població".
 * Si eso se tuerce, la hoja acaba con la dirección en la columna del pueblo
 * y nadie lo ve hasta que el transportista no encuentra la casa.
 */

import assert from "node:assert/strict";
import { cosAutocomplete, parseDetall, parseSuggeriments } from "../lib/llocs.ts";

// ── La lista mientras se escribe ─────────────────────────────────────────
{
  const resposta = {
    suggestions: [
      {
        placePrediction: {
          placeId: "ChIJ1",
          structuredFormat: {
            mainText: { text: "Carrer Cabrerés, 2" },
            secondaryText: { text: "08500 Vic, Barcelona" },
          },
        },
      },
      // Una sugerencia de búsqueda, sin sitio detrás: no se puede guardar.
      { queryPrediction: { text: { text: "carrer cabreres" } } },
    ],
  };

  const llista = parseSuggeriments(resposta);
  assert.equal(llista.length, 1, "lo que no es un sitio no entra en la lista");
  assert.equal(llista[0].placeId, "ChIJ1");
  assert.equal(llista[0].principal, "Carrer Cabrerés, 2");
  assert.equal(llista[0].secundari, "08500 Vic, Barcelona");

  assert.deepEqual(parseSuggeriments(null), [], "sin respuesta, lista vacía");
}

// ── El sesgo a la zona ───────────────────────────────────────────────────
// Sin él, "Carrer Major" devuelve los de toda España y la lista no sirve.
{
  const amb = cosAutocomplete("carrer major", { lat: 41.93, lng: 2.25 }, "tok-1");
  assert.equal(amb.sessionToken, "tok-1");
  assert.ok(amb.locationBias, "con central conocida, se sesga a su alrededor");

  const sense = cosAutocomplete("carrer major", null, "tok-1");
  assert.equal(sense.locationBias, undefined, "sin central, se busca sin sesgo");
}

// ── La dirección elegida, repartida en las dos columnas ──────────────────
{
  const lloc = parseDetall({
    id: "ChIJ1",
    formattedAddress: "Carrer Cabrerés, 2, 08500 Vic, Barcelona, Espanya",
    location: { latitude: 41.9301, longitude: 2.2545 },
    displayName: { text: "Carrer Cabrerés" },
    addressComponents: [
      { longText: "2", types: ["street_number"] },
      { longText: "Carrer Cabrerés", types: ["route"] },
      { longText: "Vic", types: ["locality"] },
      { longText: "08500", types: ["postal_code"] },
    ],
  })!;

  assert.equal(lloc.address, "Carrer Cabrerés, 2");
  assert.equal(lloc.city, "08500 Vic", "la población va con su código postal");
  assert.equal(lloc.lat, 41.9301);
  assert.equal(lloc.placeId, "ChIJ1");
}

// ── Un negocio: el nombre delante, que es como se encuentra ──────────────
// Las naves y los polígonos no se buscan por el número del portal.
{
  const lloc = parseDetall({
    id: "ChIJ2",
    location: { latitude: 42.0, longitude: 2.3 },
    displayName: { text: "Fusteria Vilalta" },
    addressComponents: [
      { longText: "12", types: ["street_number"] },
      { longText: "Carretera de Vic", types: ["route"] },
      { longText: "Torelló", types: ["locality"] },
      { longText: "08570", types: ["postal_code"] },
    ],
  })!;

  assert.equal(lloc.address, "Fusteria Vilalta, Carretera de Vic, 12");
  assert.equal(lloc.city, "08570 Torelló");
}

// ── Sin desglose, la dirección entera menos el país ──────────────────────
{
  const lloc = parseDetall({
    id: "ChIJ3",
    formattedAddress: "Polígon Mas Galí, 08560 Manlleu, Espanya",
    location: { latitude: 42.0, longitude: 2.28 },
  })!;
  assert.equal(lloc.address, "Polígon Mas Galí, 08560 Manlleu");
}

// ── Sin coordenadas no se guarda ─────────────────────────────────────────
// Una dirección sin punto es justo lo que no queremos escribir en la hoja.
{
  assert.equal(parseDetall({ id: "ChIJ4", formattedAddress: "Vic" }), null);
  assert.equal(parseDetall(null), null);
}

console.log("✓ lib/llocs.ts — l'adreça triada es reparteix bé entre les dues columnes");
