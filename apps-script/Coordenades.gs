/**
 * Leer el punto de lo que se pega de Google Maps. Sin ninguna API.
 *
 * Es la misma lógica que `lib/coordenades.ts` de la app, escrita otra vez
 * porque en Apps Script no hay forma de importar nada: el script vive dentro
 * del documento y no ve el repositorio.
 *
 * Está copiada a propósito y hay que tocar las dos a la vez. Lo que manda es
 * la de la app, que es la que tiene pruebas (`npm run check:coordenades`);
 * esta se comprueba pasándole los mismos casos con
 * `scripts/check-apps-script.mts`, que la lee de aquí y la ejecuta.
 */

/** Un punto que caiga fuera de esto no es un punto: es un número suelto. */
function puntValid(lat, lng) {
  if (isNaN(lat) || isNaN(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  // 0,0 es el Atlántico: sale de un campo vacío, no de un sitio.
  return lat !== 0 || lng !== 0;
}

/** ¿Es un enlace corto de Maps, de los que hay que seguir antes de leer? */
function esEnllacCurt(text) {
  return /\b(maps\.app\.goo\.gl|goo\.gl\/maps)\b/i.test(text);
}

/** Grados, minutos y segundos → grados y punto decimal. */
function desDeGMS(graus, minuts, segons, signe) {
  var valor =
    Number(graus) +
    Number(minuts || 0) / 60 +
    Number(String(segons || 0).replace(",", ".")) / 3600;
  return /[SWOso]/.test(signe) ? -valor : valor;
}

/**
 * El punto que haya dentro de lo que se ha pegado, si lo hay.
 *
 * Por orden de fiabilidad, no de aparición: en un enlace de Google Maps hay
 * hasta tres puntos distintos y solo uno es el del sitio.
 */
function puntDe(text) {
  var brut = String(text || "").trim();
  if (brut === "") return null;

  // 1. El punto del SITIO. El "@" que sale antes en el mismo enlace es dónde
  //    estaba centrado el mapa al copiar, que no es lo mismo.
  var delSitio = brut.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (delSitio && puntValid(Number(delSitio[1]), Number(delSitio[2]))) {
    return { lat: Number(delSitio[1]), lng: Number(delSitio[2]) };
  }

  // 2. El "?q=41.57,1.78" de los enlaces de compartir.
  var deLaQuery = brut.match(/[?&](?:q|query|ll|daddr)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (deLaQuery && puntValid(Number(deLaQuery[1]), Number(deLaQuery[2]))) {
    return { lat: Number(deLaQuery[1]), lng: Number(deLaQuery[2]) };
  }

  // 3. El centro del mapa. Peor que los de arriba, pero cuando es lo único
  //    que hay, es lo que hay.
  var delMapa = brut.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (delMapa && puntValid(Number(delMapa[1]), Number(delMapa[2]))) {
    return { lat: Number(delMapa[1]), lng: Number(delMapa[2]) };
  }

  // 4. Grados, minutos y segundos: 41°10'37.2"N 1°00'43.9"E.
  var gms = brut.match(
    /(\d+)\s*°\s*(\d+)?\s*['′]?\s*([\d.,]+)?\s*["″]?\s*([NSns])[,\s]+(\d+)\s*°\s*(\d+)?\s*['′]?\s*([\d.,]+)?\s*["″]?\s*([EWOewo])/,
  );
  if (gms) {
    var latG = desDeGMS(gms[1], gms[2] || "0", gms[3] || "0", gms[4]);
    var lngG = desDeGMS(gms[5], gms[6] || "0", gms[7] || "0", gms[8]);
    if (puntValid(latG, lngG)) return { lat: latG, lng: lngG };
  }

  /*
    5. Dos números sueltos, como los da el botón derecho del mapa.

    Con punto decimal a propósito: dos enteros seguidos ("Polígon 3 parcela
    146") no son coordenadas, y sin esta condición cualquier dirección con
    dos números parecería un punto y la comanda se iría a la otra punta del
    mundo sin que nadie lo viera.
  */
  var solts = brut.match(/(-?\d{1,3}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)/);
  if (solts && puntValid(Number(solts[1]), Number(solts[2]))) {
    return { lat: Number(solts[1]), lng: Number(solts[2]) };
  }

  return null;
}

/**
 * Lo que queda de la dirección al quitarle las coordenadas pegadas dentro.
 *
 * En el full hay filas como "Cami Llibertat, 6 Coordenadas de Google Maps
 * 41.57…,1.78…": la dirección de verdad es la de delante y el resto es una
 * nota que alguien dejó porque no tenía dónde ponerla.
 */
function adrecaSenseCoordenades(text) {
  return String(text || "")
    .replace(/\(?\s*-?\d{1,3}\.\d+\s*[,;\s]\s*-?\d{1,3}\.\d+\s*\)?/g, " ")
    .replace(
      /\(?\s*\d+\s*°[^,;]*?["″]?\s*[NSns][,\s]+\d+\s*°[^,;)]*?["″]?\s*[EWOewo]\s*\)?/g,
      " ",
    )
    .replace(/\bcoordenad[ae]s?\b(\s+(de|d'|google|maps|gps))*\s*:?/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,;.\-]+$/, "")
    .trim();
}
