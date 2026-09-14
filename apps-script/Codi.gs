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
 * Dos formas de poner el punto, y la segunda NO necesita ninguna API:
 *
 *   a) Buscar aquí dentro. Necesita una clave con la "Places API (New)"
 *      activada, en Configuració del projecte → Propietats de l'script →
 *      PLACES_API_KEY.
 *
 *   b) Pegar de Google Maps. Se abre Maps como siempre, se busca el sitio,
 *      se copia el enlace (o las coordenadas con el botón derecho) y se
 *      pega en el panel. Sin clave, sin facturación y sin activar nada:
 *      esto solo lee lo que se pega. Y es lo que la oficina ya hacía a mano
 *      —hay filas con las coordenadas escritas dentro de la dirección—,
 *      pero yendo a parar a su columna.
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
  client: ["Client", "Cliente", "Nombre", "Destinatario", "Customer"],
  city: ["Població", "Poblacio", "Población", "Poblacion", "Ciudad", "City"],
  lat: ["_lat", "lat", "latitud"],
  lng: ["_lng", "lng", "longitud"],
  placeId: ["_placeId", "placeid", "place_id"],
  geo: ["_geo", "geo", "precision"],
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(TITOL)
    .addItem("Obrir el cercador", "obrirPanell")
    .addItem("Ajuda: com posar un punt", "ajuda")
    .addToUi();

  /*
    Y se abre solo, sin que nadie vaya al menú.

    Es la diferencia entre una herramienta que se usa y una que se olvida:
    quien entra a escribir direcciones se lo encuentra abierto, y el panel
    ya va siguiendo el cursor. Dentro de la casilla no se puede dibujar
    —Sheets no deja—, así que esto es lo más cerca que se llega: el panel
    al lado, siempre.

    Si falla no pasa nada: hay hojas donde no hay permiso para abrirlo al
    arrancar, y entonces se abre del menú como siempre.
  */
  try {
    obrirPanell();
  } catch (error) {
    // A propósito en silencio: un aviso al abrir la hoja cada mañana cansa
    // más de lo que ayuda, y el menú sigue estando.
  }
}

function obrirPanell() {
  var panell = HtmlService.createHtmlOutputFromFile("Barra").setTitle(TITOL);
  SpreadsheetApp.getUi().showSidebar(panell);
}

/** Qué es cada cosa, para quien abre el menú y no sabe por dónde empezar. */
function ajuda() {
  SpreadsheetApp.getUi().alert(
    TITOL,
    "Per deixar una adreça exacta hi ha dues maneres, totes dues al panell " +
      '"Cercar adreça…":\n\n' +
      "1. ESCRIURE I TRIAR de la llista de Google.\n\n" +
      "2. ENGANXAR de Google Maps: obre Maps, busca el lloc, copia l'enllaç " +
      "(o fes botó dret al mapa → copia les coordenades) i enganxa'l a baix " +
      "del panell. Aquesta no necessita cap clau ni cap API.\n\n" +
      "La casella ambre vol dir que l'adreça està escrita a mà i encara no " +
      "és un punt.",
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
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
 * Dónde está el cursor ahora mismo.
 *
 * El panel lo pregunta cada segundo. Es lo que hace que pinchar una casilla
 * de "Adreça" sea como entrar en un buscador: al caer ahí, el panel carga
 * esa fila, escribe lo que ya hubiera puesto y deja el cursor listo.
 *
 * Y enseña de quién es la fila ("Fila 34 — RICARD CIRCUNS") porque escribir
 * la dirección de una comanda en la fila de otra es el error que más caro
 * sale de todos: el transportista va, y no hay nadie.
 */
function filaActual() {
  var full = SpreadsheetApp.getActiveSheet();
  var rang = full.getActiveRange();
  var fila = rang.getRow();
  var columnes = mapaColumnes(full);

  if (fila < 2 || !columnes.address) {
    return { fila: 0, resum: "Posa el cursor a la fila de la comanda", aAdreca: false };
  }

  var valors = full.getRange(fila, 1, 1, full.getLastColumn()).getValues()[0];
  var adreca = String(valors[columnes.address - 1] || "");
  var client = columnes.client ? String(valors[columnes.client - 1] || "") : "";

  return {
    fila: fila,
    // El cliente antes que la dirección: es lo que se reconoce de un vistazo
    // cuando lo que se está comprobando es "¿es esta la fila?".
    resum: "Fila " + fila + (client ? " — " + client : "") + (adreca ? " · " + adreca : " · sense adreça"),
    adreca: adreca,
    /* Si el cursor está justo en la casilla de la dirección. Entonces el
       panel se pone en marcha solo; si está en otra columna, se queda
       quieto para no robar el teclado a quien está escribiendo medidas. */
    aAdreca: rang.getColumn() === columnes.address,
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

  /*
    Las columnas del punto puede que no estén.

    En la hoja de verdad hay "_lat" y "_lng" —las creó la app— pero no
    "_placeId" ni "_geo". Sin ellas, esto guardaba la dirección buena y
    tiraba el punto exacto a la basura sin decir nada, y la app volvía a
    buscar la dirección como si nadie la hubiera elegido. Se crean al final,
    que es donde las pone la app.
  */
  columnes = assegurarColumnes(full, columnes);

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

/**
 * Guarda el punto que se ha pegado de Google Maps. Sin API.
 *
 * Lo único que se le pide a Google es seguir el enlace corto cuando lo hay
 * —`maps.app.goo.gl` no lleva las coordenadas dentro—, y eso es una visita
 * normal a una página, no una llamada a ninguna API: no hace falta clave ni
 * que nadie active nada.
 *
 * La dirección escrita NO se toca: quien pega un punto está diciendo dónde
 * está la casa, no cómo se llama la calle. Lo que sí se hace es marcar la
 * fila como comprobada y quitarle el ámbar.
 */
function desarPunt(fila, enganxat) {
  var full = SpreadsheetApp.getActiveSheet();
  var columnes = mapaColumnes(full);
  if (!columnes.address) throw new Error('Aquest full no té columna "Adreça".');
  if (!fila || fila < 2) throw new Error("Posa el cursor a la fila de la comanda.");

  var text = String(enganxat || "").trim();
  if (text === "") throw new Error("Enganxa l'enllaç o les coordenades de Google Maps.");

  if (esEnllacCurt(text)) text = seguirEnllac(text);

  var punt = puntDe(text);
  if (!punt) {
    throw new Error(
      "Aquí no hi ha cap punt. Copia l'enllaç de Google Maps, o fes botó dret al mapa i copia les coordenades.",
    );
  }

  columnes = assegurarColumnes(full, columnes);
  full.getRange(fila, columnes.lat).setValue(punt.lat);
  full.getRange(fila, columnes.lng).setValue(punt.lng);
  // Sin ficha de Google no hay identificador de portal: se vacía, que quede
  // claro que el punto viene de una persona y no de una dirección.
  full.getRange(fila, columnes.placeId).setValue("");
  /*
    "portal" igual que si se hubiera elegido de la lista.

    Lo ha señalado una persona en el mapa, que es tan exacto como se puede
    ser. La app lo respeta y no lo vuelve a buscar — si pusiera otra cosa,
    lo sustituiría por lo que dijera el geocodificador, que es justo lo que
    se está corrigiendo.
  */
  full.getRange(fila, columnes.geo).setValue("portal");

  var cel = full.getRange(fila, columnes.address);
  netejarMarca(cel);

  return { lat: punt.lat, lng: punt.lng, address: String(cel.getValue() || "") };
}

/**
 * Sigue un enlace corto hasta el largo, que es el que lleva el punto.
 *
 * Sin seguir los redirecciones: lo que hace falta es la dirección a la que
 * apunta, que viene en la cabecera, no la página entera.
 */
function seguirEnllac(url) {
  var resposta = UrlFetchApp.fetch(url, {
    followRedirects: false,
    muteHttpExceptions: true,
  });
  var desti = (resposta.getHeaders()["Location"] || resposta.getHeaders()["location"] || "");
  return desti || url;
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

/**
 * Crea las columnas del punto que falten, al final de la hoja.
 *
 * Con el nombre que usa la app (`_placeId`, `_geo`): si se llamaran de otra
 * forma, la app no las encontraría y las crearía otra vez al lado.
 *
 * Solo añade cabeceras en la fila 1. No mueve ni borra nada de lo que hay.
 */
function assegurarColumnes(full, columnes) {
  var CAPÇALERES = { lat: "_lat", lng: "_lng", placeId: "_placeId", geo: "_geo" };
  var seguent = full.getLastColumn();

  Object.keys(CAPÇALERES).forEach(function (clau) {
    if (columnes[clau]) return;
    seguent += 1;
    full.getRange(1, seguent).setValue(CAPÇALERES[clau]);
    columnes[clau] = seguent;
  });

  return columnes;
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
