/**
 * El script de la hoja, ejecutado de verdad contra una hoja de mentira.
 *
 *   npm run check:apps-script-full
 *
 * Por qué: el Apps Script no se puede probar sin pegarlo en un documento, y
 * pegarlo para descubrir que escribe en la columna equivocada es descubrirlo
 * tarde. Aquí se le pone delante una hoja falsa —con las columnas REALES de
 * "Copia de Transports Winkaplast"— y un Google de mentira, y se mira qué
 * celdas toca.
 *
 * Lo que se comprueba es lo que no se puede deshacer: que escribe en la fila
 * que toca, en las columnas que toca, y que no roza ninguna otra.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const arrel = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Las cabeceras de la copia de verdad, tal cual están hoy. */
const CAPÇALERES = [
  "Columna 1",
  "Client",
  "Adreça",
  "Població",
  "Telefòn",
  "Mides",
  "Nº Comanda",
  "Prioritat",
  "Estat de l'entrega",
  "Data entrega",
  "Comentaris/Observacions",
  "Incidencia",
  "_lat",
  "_lng",
];

/* ── Una hoja de mentira que se deja mirar ──────────────────────────────── */

interface Cel·la {
  valor: unknown;
  fons?: string | null;
  nota?: string | null;
}

function fullFals() {
  // Fila 1 las cabeceras; después, dos comandas copiadas de la hoja real.
  const cel·les = new Map<string, Cel·la>();
  const posar = (fila: number, columna: number, valor: unknown) =>
    cel·les.set(`${fila}:${columna}`, { valor });

  CAPÇALERES.forEach((c, i) => posar(1, i + 1, c));

  posar(2, 2, "DUNIA GONZALEZ");
  posar(2, 3, "Camí del tortells, S/N Camino particular, llamar entes.");
  posar(2, 4, "43737 EL MOLAR");
  posar(2, 13, 41.1631066);
  posar(2, 14, 0.7105267);

  posar(3, 2, "SAVELIY LABUTIN");
  posar(3, 3, "Calle Bruc, 9");
  posar(3, 4, "08010 BARCELONA");

  let ultimaColumna = CAPÇALERES.length;
  let seleccio = { fila: 2, columna: 3 };

  const cel = (fila: number, columna: number): Cel·la => {
    const clau = `${fila}:${columna}`;
    if (!cel·les.has(clau)) cel·les.set(clau, { valor: "" });
    return cel·les.get(clau)!;
  };

  const rang = (fila: number, columna: number, nFiles = 1, nColumnes = 1) => ({
    getRow: () => fila,
    getColumn: () => columna,
    getValue: () => cel(fila, columna).valor,
    getValues: () => {
      const files: unknown[][] = [];
      for (let f = 0; f < nFiles; f++) {
        const filaValors: unknown[] = [];
        for (let c = 0; c < nColumnes; c++) filaValors.push(cel(fila + f, columna + c).valor);
        files.push(filaValors);
      }
      return files;
    },
    setValue: (valor: unknown) => {
      cel(fila, columna).valor = valor;
      if (columna > ultimaColumna) ultimaColumna = columna;
    },
    setBackground: (fons: string | null) => (cel(fila, columna).fons = fons),
    setNote: (nota: string | null) => (cel(fila, columna).nota = nota),
    clearContent: () => (cel(fila, columna).valor = ""),
    getSheet: () => full,
  });

  const full = {
    getRange: rang,
    getLastColumn: () => ultimaColumna,
    getActiveRange: () => rang(seleccio.fila, seleccio.columna),
    // Para el banco de pruebas, no para el script:
    _cel: cel,
    _seleccionar: (fila: number, columna: number) => (seleccio = { fila, columna }),
    _capçalera: (columna: number) => String(cel(1, columna).valor),
  };

  return full;
}

/* ── Un Google de mentira ───────────────────────────────────────────────── */

const RESPOSTA_DETALL = {
  id: "ChIJxyz",
  formattedAddress: "Carrer Cabrerés, 2, 08500 Vic, Barcelona, Espanya",
  location: { latitude: 41.9301234, longitude: 2.2545678 },
  displayName: { text: "Carrer Cabrerés" },
  addressComponents: [
    { longText: "2", types: ["street_number"] },
    { longText: "Carrer Cabrerés", types: ["route"] },
    { longText: "Vic", types: ["locality"] },
    { longText: "08500", types: ["postal_code"] },
  ],
};

/** Las llamadas que se le han hecho, para poder mirarlas después. */
const trucades: { url: string; opcions?: Record<string, unknown> }[] = [];

function googleFals() {
  return {
    fetch: (url: string, opcions?: Record<string, unknown>) => {
      trucades.push({ url, opcions });

      // El enlace corto: se contesta con la redirección, sin API.
      if (url.includes("maps.app.goo.gl")) {
        return {
          getResponseCode: () => 302,
          getHeaders: () => ({
            Location:
              "https://www.google.com/maps/place/Lloc/@41.90,2.20,17z/data=!3m1!4b1!8m2!3d41.9301234!4d2.2545678",
          }),
          getContentText: () => "",
        };
      }

      if (url.includes("places:autocomplete")) {
        return {
          getResponseCode: () => 200,
          getHeaders: () => ({}),
          getContentText: () =>
            JSON.stringify({
              suggestions: [
                {
                  placePrediction: {
                    placeId: "ChIJxyz",
                    structuredFormat: {
                      mainText: { text: "Carrer Cabrerés, 2" },
                      secondaryText: { text: "08500 Vic" },
                    },
                  },
                },
                // Una sugerencia sin sitio detrás: no se puede guardar.
                { queryPrediction: { text: { text: "carrer cabreres" } } },
              ],
            }),
        };
      }

      return {
        getResponseCode: () => 200,
        getHeaders: () => ({}),
        getContentText: () => JSON.stringify(RESPOSTA_DETALL),
      };
    },
  };
}

/* ── Cargar los .gs con todo eso alrededor ──────────────────────────────── */

const codi =
  readFileSync(join(arrel, "apps-script/Coordenades.gs"), "utf8") +
  "\n" +
  readFileSync(join(arrel, "apps-script/Codi.gs"), "utf8");

function carregar(full: ReturnType<typeof fullFals>) {
  const SpreadsheetApp = {
    getActiveSheet: () => full,
    getUi: () => {
      throw new Error("El banc de proves no obre finestres");
    },
  };
  const PropertiesService = {
    getScriptProperties: () => ({ getProperty: () => "CLAU-DE-MENTIDA" }),
  };
  /* La caché del documento: es donde el disparador deja apuntada la
     dirección recién escrita para que el panel la recoja. */
  const memoria = new Map<string, string>();
  const CacheService = {
    getDocumentCache: () => ({
      put: (clau: string, valor: string) => memoria.set(clau, valor),
      get: (clau: string) => memoria.get(clau) ?? null,
    }),
  };

  return new Function(
    "SpreadsheetApp",
    "PropertiesService",
    "UrlFetchApp",
    "HtmlService",
    "CacheService",
    `${codi}\nreturn { desarAdreca, desarPunt, alEditar, filaActual, mapaColumnes, buscarAdreces };`,
  )(SpreadsheetApp, PropertiesService, googleFals(), {}, CacheService) as {
    desarAdreca: (fila: number, placeId: string, token: string) => { address: string };
    desarPunt: (fila: number, text: string) => { lat: number; lng: number };
    alEditar: (e: unknown) => void;
    filaActual: () => {
      fila: number;
      resum: string;
      adreca: string;
      aAdreca: boolean;
      buscar?: boolean;
      versio: string;
    };
    mapaColumnes: (full: unknown) => Record<string, number>;
    buscarAdreces: (text: string, token: string) => { placeId: string }[];
  };
}

/* ── Las columnas de la hoja real ───────────────────────────────────────── */
{
  const full = fullFals();
  const gs = carregar(full);
  const mapa = gs.mapaColumnes(full);

  assert.equal(mapa.address, 3, 'la columna "Adreça" de la còpia és la C');
  assert.equal(mapa.city, 4, '"Població" és la D');
  assert.equal(mapa.client, 2, '"Client" és la B');
  assert.equal(mapa.lat, 13);
  assert.equal(mapa.lng, 14);
  // Las que no existen todavía en esa hoja.
  assert.equal(mapa.placeId, undefined);
  assert.equal(mapa.precisio, undefined);
  assert.equal(mapa.geoAddress, undefined);
}

/* ── Elegir una dirección de la lista ───────────────────────────────────── */
{
  const full = fullFals();
  const gs = carregar(full);

  const abans = String(full._cel(3, 6).valor); // Mides, que no se toca
  gs.desarAdreca(3, "ChIJxyz", "token-1");

  assert.equal(full._cel(3, 3).valor, "Carrer Cabrerés, 2", "l'adreça, a la seva columna");
  assert.equal(full._cel(3, 4).valor, "08500 Vic", "la població, a la seva");
  assert.equal(full._cel(3, 13).valor, 41.9301234);
  assert.equal(full._cel(3, 14).valor, 2.2545678);

  // Las columnas que faltaban, creadas al final y con el nombre de la app.
  assert.equal(full._capçalera(15), "_placeId");
  assert.equal(full._capçalera(16), "_precisio");
  assert.equal(full._capçalera(17), "_geo");
  assert.equal(full._cel(3, 15).valor, "ChIJxyz");
  assert.equal(full._cel(3, 16).valor, "portal");
  /*
    Y la dirección que se acaba de guardar, que es lo que hace que la app dé
    el punto por bueno. Sin esto, la siguiente sincronización vería la
    dirección cambiada, geocodificaría otra vez y se cargaría el portal que
    ha elegido una persona.
  */
  assert.equal(full._cel(3, 17).valor, "Carrer Cabrerés, 2, 08500 Vic");

  // Y nada más: ni otras columnas de esta fila, ni la fila de al lado.
  assert.equal(full._cel(3, 6).valor, abans, "les mides no es toquen");
  assert.equal(full._cel(3, 2).valor, "SAVELIY LABUTIN", "el client tampoc");
  assert.equal(
    full._cel(2, 3).valor,
    "Camí del tortells, S/N Camino particular, llamar entes.",
    "la fila de sobre no es toca",
  );
}

/* ── Pegar un enlace de Maps: sin API ───────────────────────────────────── */
{
  const full = fullFals();
  const gs = carregar(full);
  trucades.length = 0;

  const punt = gs.desarPunt(2, "https://maps.app.goo.gl/aBcDeF");

  assert.ok(Math.abs(punt.lat - 41.9301234) < 0.0002);
  assert.equal(full._cel(2, 13).valor, 41.9301234);
  assert.equal(full._cel(2, 14).valor, 2.2545678);
  assert.equal(full._cel(2, 16).valor, "portal");
  assert.equal(full._cel(2, 15).valor, "", "sense fitxa de Google no hi ha placeId");
  assert.equal(
    full._cel(2, 17).valor,
    "Camí del tortells, S/N Camino particular, llamar entes., 43737 EL MOLAR",
    "el punt es queda lligat a l'adreça que hi ha escrita, perquè l'app no el refaci",
  );

  assert.equal(
    full._cel(2, 3).valor,
    "Camí del tortells, S/N Camino particular, llamar entes.",
    "enganxar un punt NO toca l'adreça escrita",
  );

  // Lo único que se le ha pedido a Google es seguir el enlace: ninguna API.
  assert.equal(trucades.length, 1);
  assert.ok(trucades[0].url.includes("maps.app.goo.gl"));
  assert.equal(
    (trucades[0].opcions as { followRedirects?: boolean }).followRedirects,
    false,
  );
  assert.ok(
    !JSON.stringify(trucades).includes("places.googleapis.com"),
    "la via d'enganxar no pot trucar a cap API de Places",
  );
}

/* ── Pegar unas coordenadas a pelo ──────────────────────────────────────── */
{
  const full = fullFals();
  const gs = carregar(full);
  trucades.length = 0;

  gs.desarPunt(3, "41.5719, 1.7834");
  assert.equal(full._cel(3, 13).valor, 41.5719);
  assert.equal(trucades.length, 0, "unes coordenades no necessiten ni sortir a internet");

  // Y lo que no es un punto, no pasa.
  assert.throws(
    () => gs.desarPunt(3, "Poligono 3 parcela 146"),
    /cap punt/,
    "una adreça normal no pot colar-se com a coordenades",
  );
  assert.equal(full._cel(3, 13).valor, 41.5719, "i no toca res quan falla");
}

/* ── Escribir a mano: el aviso en ámbar ─────────────────────────────────── */
{
  const full = fullFals();
  const gs = carregar(full);

  // Antes tenía punto; se cambia la dirección a mano.
  full._cel(2, 3).valor = "Carrer Nou, 12";
  gs.alEditar({ range: full.getRange(2, 3) });

  assert.equal(full._cel(2, 3).fons, "#fff3cd", "la casella es marca");
  assert.ok(String(full._cel(2, 3).nota).includes("mà"), "i diu per què");
  assert.equal(full._cel(2, 13).valor, "", "el punt vell s'esborra: era d'una altra adreça");
  assert.equal(full._cel(2, 14).valor, "");

  /*
    Y el ámbar aguanta aunque el panel no se pueda abrir.

    En este banco de pruebas `getUi()` revienta a propósito —no hay ventanas
    que abrir—, que es lo que pasa de verdad cuando edita alguien que no
    instaló el activador. Lo que NO puede pasar es que por eso se pierda la
    marca, que es lo importante de esta función.
  */
  assert.equal(full._cel(2, 3).fons, "#fff3cd", "l'ambre no depèn que s'obri el panell");

  // Una edición en otra columna no hace nada.
  full._cel(3, 6).valor = "100 x 80 cm";
  gs.alEditar({ range: full.getRange(3, 6) });
  assert.equal(full._cel(3, 6).fons, undefined, "les mides no es marquen");
}

/* ── El panel sigue al cursor ───────────────────────────────────────────── */
{
  const full = fullFals();
  const gs = carregar(full);

  full._seleccionar(3, 3); // en la casilla de la dirección
  const aAdreca = gs.filaActual();
  assert.equal(aAdreca.fila, 3);
  assert.equal(aAdreca.aAdreca, true, "el cursor és a Adreça: el panell s'engega");
  assert.equal(aAdreca.adreca, "Calle Bruc, 9");
  assert.ok(
    aAdreca.resum.includes("SAVELIY LABUTIN"),
    "el panell diu de quin client és la fila, que és com es comprova que no t'has equivocat",
  );

  full._seleccionar(3, 6); // en las medidas
  assert.equal(gs.filaActual().aAdreca, false, "en una altra columna es queda quiet");

  full._seleccionar(1, 3); // en la cabecera
  assert.equal(gs.filaActual().fila, 0, "la capçalera no és cap comanda");
}

/* ── Escribir en la casilla: el panel se queda en ESA fila ──────────────── */
/*
  El caso que fallaba de verdad: al dar Enter, el cursor baja una fila. Si
  el panel solo mirara el cursor, cargaría la fila de abajo —vacía— y la
  dirección recién escrita se quedaría sin comprobar, que es justo la que
  hay que dejar exacta.
*/
{
  const full = fullFals();
  const gs = carregar(full);

  // Escribe en la dirección de la fila 3 y da Enter: el cursor baja a la 4.
  full._cel(3, 3).valor = "Carrer Nou, 12";
  gs.alEditar({ range: full.getRange(3, 3) });
  full._seleccionar(4, 3);

  const despres = gs.filaActual();
  assert.equal(despres.fila, 3, "el panell es queda a la fila que s'acaba d'escriure");
  assert.equal(despres.adreca, "Carrer Nou, 12", "amb el text que s'hi ha posat");
  assert.equal(despres.aAdreca, true, "i es posa en marxa sol");
  assert.equal(despres.buscar, true, "i busca sense esperar que ningú teclegi al panell");
  assert.ok(despres.resum.includes("SAVELIY LABUTIN"), "dient de quin client és");

  /*
    Y la versión cambia con cada edición, aunque sea la misma fila: es lo
    que hace que el panel se entere. Sin esto, escribir dos direcciones
    seguidas en la misma casilla solo recargaría el panel la primera vez.
  */
  const abans = despres.versio;
  full._cel(3, 3).valor = "Carrer Nou, 14";
  gs.alEditar({ range: full.getRange(3, 3) });
  assert.notEqual(gs.filaActual().versio, abans, "cada edició és informació nova");

  /*
    Pero si el cursor se va a OTRA casilla de dirección, manda el cursor:
    es que alguien ha ido allí a propósito.
  */
  full._seleccionar(2, 3);
  const altra = gs.filaActual();
  assert.equal(altra.fila, 2, "el cursor mana quan és a una altra adreça");
  assert.equal(altra.buscar, false, "i aquí no es busca sol: ningú ho ha demanat");
}

/* ── La lista de sugerencias ────────────────────────────────────────────── */
{
  const full = fullFals();
  const gs = carregar(full);

  const llista = gs.buscarAdreces("carrer cabreres", "token-1");
  assert.equal(llista.length, 1, "el que no és un lloc no entra a la llista");
  assert.equal(llista[0].placeId, "ChIJxyz");
  assert.deepEqual(gs.buscarAdreces("ca", "token-1"), [], "amb dues lletres ni es pregunta");
}

console.log(
  "✓ apps-script/ — el script escriu on toca a les columnes reals de la còpia",
);
