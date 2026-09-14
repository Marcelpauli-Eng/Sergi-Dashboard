/**
 * Cercador d'adreces per al full de comandes — PER A LA CÒPIA DE PROVES.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  AIXÒ NO VA AL FULL DE VERITAT FINS QUE ESTIGUI PROVAT. Ver README.md.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Qué resuelve: la oficina escribe la dirección a mano, y una dirección
 * escrita hay que adivinarla después. Cuando Google no da con el número
 * contesta el centro del pueblo, y allí acaba el transportista.
 *
 * Qué hace:
 *
 *  1. Menú "Adreces" → "Cercar adreça…". Se abre un panel al lado, se
 *     escribe, se ELIGE de la lista de Google y la fila queda con la
 *     dirección buena, la población, y el punto exacto en _lat/_lng/
 *     _placeId/_geo — las mismas columnas que usa la app.
 *
 *  2. Al escribir una dirección a mano, la celda se marca en ámbar con una
 *     nota: "sense comprovar". Es el aviso de que eso todavía no es un punto,
 *     es texto. Al elegirla del panel, la marca se va.
 *
 * Lo que NO hace: escribir en ninguna otra columna, borrar nada, ni tocar
 * filas que no sean la que está seleccionada.
 *
 * Hace falta una clave de Google con la "Places API (New)" activada, en
 * Configuració del projecte → Propietats de l'script → PLACES_API_KEY.
 */

/** El nombre del menú y del panel, en un sitio para no repetirlo. */
var TITOL = "Adreces";

/**
 * Las cabeceras que se buscan en la fila 1, por orden de preferencia.
 *
 * Son las mismas que entiende la app (`lib/sheet-schema.ts`): si allí se
 * añade un alias, aquí también. La comparación ignora mayúsculas, acentos y
 * signos, así que "Adreça", "ADRECA" y "adreca" son la misma columna.
 */
var COLUMNES = {
  address: ["Adreça", "Adreca", "Direccion", "Dirección", "Domicilio", "Address"],
  city: ["Població", "Poblacio", "Población", "Poblacion", "Ciudad", "City"],
  lat: ["_lat", "lat", "latitud"],
  lng: ["_lng", "lng", "longitud"],
  placeId: ["_placeId", "placeid", "place_id"],
  geo: ["_geo", "geo", "precision"],
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(TITOL)
    .addItem("Cercar adreça…", "obrirPanell")
    .addToUi();
}

function obrirPanell() {
  var panell = HtmlService.createHtmlOutputFromFile("Barra").setTitle(TITOL);
  SpreadsheetApp.getUi().showSidebar(panell);
}

/**
 * Marca en ámbar la dirección escrita a mano.
 *
 * No impide escribirla —la oficina tiene que poder trabajar rápido— pero
 * deja a la vista cuáles no se han comprobado. Es lo que convierte "no me
 * marca exacto" en algo que se ve ANTES de salir a repartir.
 *
 * Se instala como activador de "En editar" (ver README): sin instalar, un
 * `onEdit` simple no puede escribir notas en algunos casos.
 */
function alEditar(e) {
  if (!e || !e.range) return;
  var full = e.range.getSheet();
  var columnes = mapaColumnes(full);
  if (!columnes.address) return;

  // Solo la columna de la dirección, y nunca la cabecera.
  if (e.range.getColumn() !== columnes.address || e.range.getRow() < 2) return;

  var text = String(e.range.getValue() || "").trim();
  if (text === "") {
    netejarMarca(e.range);
    return;
  }

  e.range.setBackground("#fff3cd");
  e.range.setNote(
    "Adreça escrita a mà: encara no és un punt.\n" +
      'Tria-la amb "' + TITOL + ' → Cercar adreça…" per deixar-la exacta.',
  );

  // El punto de antes ya no vale: era de la dirección anterior.
  esborrarPunt(full, e.range.getRow(), columnes);
}

/** Quita el ámbar y la nota: la dirección ya está comprobada. */
function netejarMarca(rang) {
  rang.setBackground(null);
  rang.setNote(null);
}

/**
 * Lo que el panel necesita saber al abrirse: dónde está parado el cursor.
 *
 * Se enseña en el panel ("Fila 34 — RICARD CIRCUNS") para que nadie escriba
 * la dirección de una comanda en la fila de otra, que es el error que más
 * caro sale de todos.
 */
function filaActual() {
  var full = SpreadsheetApp.getActiveSheet();
  var fila = full.getActiveRange().getRow();
  if (fila < 2) return { fila: 0, resum: "Posa el cursor a la fila de la comanda" };

  var columnes = mapaColumnes(full);
  var valors = full.getRange(fila, 1, 1, full.getLastColumn()).getValues()[0];

  var adreca = columnes.address ? valors[columnes.address - 1] : "";
  return {
    fila: fila,
    resum: "Fila " + fila + (adreca ? " — " + adreca : " — sense adreça"),
    adreca: String(adreca || ""),
  };
}

/**
 * Busca direcciones en Google mientras se escribe.
 *
 * El `sessionToken` junta todo lo tecleado con la elección final: Google lo
 * cobra como UNA búsqueda en vez de una llamada por letra.
 */
function buscarAdreces(text, sessionToken) {
  if (!text || text.length < 3) return [];

  var resposta = aGoogle("https://places.googleapis.com/v1/places:autocomplete", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      input: text,
      languageCode: "ca",
      regionCode: "ES",
      sessionToken: sessionToken,
      includedRegionCodes: ["es"],
    }),
  });

  var suggeriments = (resposta.suggestions || [])
    .filter(function (s) {
      // Las sugerencias de búsqueda no llevan sitio detrás: no se guardan.
      return s.placePrediction && s.placePrediction.placeId;
    })
    .map(function (s) {
      var format = s.placePrediction.structuredFormat || {};
      return {
        placeId: s.placePrediction.placeId,
        principal: (format.mainText || {}).text || (s.placePrediction.text || {}).text || "",
        secundari: (format.secondaryText || {}).text || "",
      };
    });

  return suggeriments;
}

/**
 * Escribe en la fila la dirección elegida, con su punto.
 *
 * Escribe SOLO estas celdas de ESTA fila. Lo demás de la hoja no se toca.
 */
function desarAdreca(fila, placeId, sessionToken) {
  var full = SpreadsheetApp.getActiveSheet();
  var columnes = mapaColumnes(full);
  if (!columnes.address) throw new Error('Aquest full no té columna "Adreça".');
  if (!fila || fila < 2) throw new Error("Posa el cursor a la fila de la comanda.");

  var detall = aGoogle(
    "https://places.googleapis.com/v1/places/" +
      encodeURIComponent(placeId) +
      "?languageCode=ca&sessionToken=" +
      encodeURIComponent(sessionToken || ""),
    {
      method: "get",
      headers: {
        "X-Goog-FieldMask": "id,formattedAddress,location,addressComponents,displayName",
      },
    },
  );

  var lloc = repartir(detall);
  if (!lloc) throw new Error("Google no ha donat coordenades d'aquesta adreça.");

  var cel = full.getRange(fila, columnes.address);
  cel.setValue(lloc.address);
  netejarMarca(cel);

  if (columnes.city && lloc.city) full.getRange(fila, columnes.city).setValue(lloc.city);
  if (columnes.lat) full.getRange(fila, columnes.lat).setValue(lloc.lat);
  if (columnes.lng) full.getRange(fila, columnes.lng).setValue(lloc.lng);
  if (columnes.placeId) full.getRange(fila, columnes.placeId).setValue(lloc.placeId);
  // "portal": la eligió una persona de la lista de Google. No hay nada más
  // exacto que eso, y la app ya no la vuelve a buscar.
  if (columnes.geo) full.getRange(fila, columnes.geo).setValue("portal");

  return lloc;
}

/* ── Fontanería ─────────────────────────────────────────────────────────── */

/** Una llamada a Google con la clave de las propiedades del script. */
function aGoogle(url, opcions) {
  var clau = PropertiesService.getScriptProperties().getProperty("PLACES_API_KEY");
  if (!clau) {
    throw new Error(
      "Falta la clau: Configuració del projecte → Propietats de l'script → PLACES_API_KEY.",
    );
  }

  opcions = opcions || {};
  opcions.headers = opcions.headers || {};
  opcions.headers["X-Goog-Api-Key"] = clau;
  opcions.muteHttpExceptions = true;

  var resposta = UrlFetchApp.fetch(url, opcions);
  var codi = resposta.getResponseCode();
  if (codi === 403) {
    throw new Error(
      'La clau no té activada la "Places API (New)" al projecte de Google Cloud.',
    );
  }
  if (codi >= 400) {
    throw new Error("Google ha respost " + codi + ": " + resposta.getContentText().slice(0, 200));
  }
  return JSON.parse(resposta.getContentText());
}

/**
 * Reparte lo que contesta Google entre las dos columnas de la hoja.
 *
 * Mismo criterio que `lib/llocs.ts` en la app, para que una dirección
 * elegida desde el panel y otra elegida desde la app se escriban igual.
 */
function repartir(detall) {
  var lat = (detall.location || {}).latitude;
  var lng = (detall.location || {}).longitude;
  if (!detall.id || typeof lat !== "number" || typeof lng !== "number") return null;

  var tros = function (tipus) {
    var trobat = (detall.addressComponents || []).filter(function (c) {
      return (c.types || []).indexOf(tipus) !== -1;
    })[0];
    return trobat ? trobat.longText || trobat.shortText : null;
  };

  var carrer = tros("route");
  var numero = tros("street_number");
  var poble = tros("locality") || tros("postal_town");
  var cp = tros("postal_code");

  var address = carrer ? (numero ? carrer + ", " + numero : carrer) : "";

  // El nombre del negocio delante, que es como se encuentra una nave. Solo
  // si aporta: para una casa, Google devuelve la calle como nombre.
  var nom = (detall.displayName || {}).text || "";
  if (nom && carrer && nom.indexOf(carrer) !== 0 && address.indexOf(nom) === -1) {
    address = address ? nom + ", " + address : nom;
  }

  if (!address) {
    address = (detall.formattedAddress || "").replace(/,\s*(Espanya|España|Spain)$/, "");
  }

  return {
    placeId: detall.id,
    address: address,
    city: [cp, poble].filter(Boolean).join(" "),
    lat: lat,
    lng: lng,
  };
}

/** En qué columna está cada cosa, buscándolo por la cabecera de la fila 1. */
function mapaColumnes(full) {
  var capçaleres = full.getRange(1, 1, 1, full.getLastColumn()).getValues()[0];
  var normalitzades = capçaleres.map(normalitzar);

  var mapa = {};
  Object.keys(COLUMNES).forEach(function (clau) {
    for (var i = 0; i < COLUMNES[clau].length; i++) {
      var on = normalitzades.indexOf(normalitzar(COLUMNES[clau][i]));
      if (on !== -1) {
        mapa[clau] = on + 1; // Las columnas se numeran desde 1.
        break;
      }
    }
  });
  return mapa;
}

/** Minúsculas, sin acentos y sin signos: "Població" y "POBLACIO" son igual. */
function normalitzar(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Vacía el punto de una fila: la dirección ha cambiado y ya no es el suyo. */
function esborrarPunt(full, fila, columnes) {
  ["lat", "lng", "placeId", "geo"].forEach(function (clau) {
    if (columnes[clau]) full.getRange(fila, columnes[clau]).clearContent();
  });
}
