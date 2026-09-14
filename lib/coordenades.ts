/**
 * Sacar el punto de lo que alguien pega de Google Maps.
 *
 * Para qué: el camino sin API. Se abre Google Maps como siempre, se busca
 * el sitio, se copia —el enlace, o las coordenadas— y se pega. No hace falta
 * clave, ni facturación, ni activar nada: lo único que hace esto es leer.
 *
 * Y no es una idea nueva: en el full de la oficina ya hay direcciones con
 * las coordenadas pegadas al final, escritas a mano dentro del texto de la
 * dirección, donde no las lee nadie. Esto es lo mismo que ya se hace, pero
 * yendo a parar a su columna.
 *
 * Lo que se entiende:
 *
 *   41.5719, 1.7834                        ← copiado del mapa con el botón derecho
 *   41°10'37.2"N 1°00'43.9"E               ← copiado de la ficha del sitio
 *   https://www.google.com/maps/@41.57,1.78,17z
 *   https://www.google.com/maps/place/…/@41.57,1.78,17z/data=…!3d41.5719!4d1.7834
 *   https://maps.google.com/?q=41.57,1.78
 *
 * Los enlaces cortos (`maps.app.goo.gl`) no llevan el punto dentro: hay que
 * seguirlos primero para que Google diga el largo. Eso lo hace quien llama
 * —el navegador no puede, el servidor y el Apps Script sí— y luego pasa el
 * resultado por aquí.
 *
 * Se comprueba sin red en `scripts/check-coordenades.mts`.
 */

export interface Punt {
  lat: number;
  lng: number;
}

/** Un punto que caiga fuera de esto no es un punto: es un número suelto. */
function valid(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  // 0,0 es el Atlántico: sale de un campo vacío, no de un sitio.
  return lat !== 0 || lng !== 0;
}

/** ¿Es un enlace corto de Maps, de los que hay que seguir antes de leer? */
export function esEnllacCurt(text: string): boolean {
  return /\b(maps\.app\.goo\.gl|goo\.gl\/maps)\b/i.test(text);
}

/**
 * Grados, minutos y segundos → grados y punto decimal.
 *
 * Es lo que sale al copiar de la ficha de un sitio en Google Maps, y lo que
 * hay escrito a mano en alguna fila del full: 41°10'37.2"N.
 */
function desDeGMS(graus: string, minuts: string, segons: string, signe: string): number {
  const valor =
    Number(graus) + Number(minuts || 0) / 60 + Number(segons.replace(",", ".") || 0) / 3600;
  return /[SWOso]/.test(signe) ? -valor : valor;
}

/**
 * El punto que haya dentro de lo que se ha pegado, si lo hay.
 *
 * Se busca por orden de fiabilidad, no por orden de aparición: en un enlace
 * de Google Maps hay hasta tres puntos distintos y solo uno es el del sitio.
 */
export function puntDe(text: string): Punt | null {
  const brut = (text ?? "").trim();
  if (brut === "") return null;

  /*
    1. El punto del SITIO: "!3d41.5719!4d1.7834".

    Va dentro del `data=` de los enlaces de Google Maps y es el del sitio en
    sí. El "@41.57,1.78" que sale antes en el mismo enlace es otra cosa: es
    dónde estaba centrado el mapa cuando se copió, que con el mapa movido no
    es lo mismo. Por eso este va primero.
  */
  const delSitio = brut.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (delSitio) {
    const lat = Number(delSitio[1]);
    const lng = Number(delSitio[2]);
    if (valid(lat, lng)) return { lat, lng };
  }

  // 2. El "?q=41.57,1.78" de los enlaces de compartir.
  const deLaQuery = brut.match(/[?&](?:q|query|ll|daddr)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (deLaQuery) {
    const lat = Number(deLaQuery[1]);
    const lng = Number(deLaQuery[2]);
    if (valid(lat, lng)) return { lat, lng };
  }

  // 3. El centro del mapa, "@41.57,1.78,17z". Peor que los de arriba, pero
  //    cuando es lo único que hay, es lo que hay.
  const delMapa = brut.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (delMapa) {
    const lat = Number(delMapa[1]);
    const lng = Number(delMapa[2]);
    if (valid(lat, lng)) return { lat, lng };
  }

  // 4. Grados, minutos y segundos: 41°10'37.2"N 1°00'43.9"E.
  const gms = brut.match(
    /(\d+)\s*°\s*(\d+)?\s*['′]?\s*([\d.,]+)?\s*["″]?\s*([NSns])[,\s]+(\d+)\s*°\s*(\d+)?\s*['′]?\s*([\d.,]+)?\s*["″]?\s*([EWOewo])/,
  );
  if (gms) {
    const lat = desDeGMS(gms[1], gms[2] ?? "0", gms[3] ?? "0", gms[4]);
    const lng = desDeGMS(gms[5], gms[6] ?? "0", gms[7] ?? "0", gms[8]);
    if (valid(lat, lng)) return { lat, lng };
  }

  /*
    5. Dos números sueltos: "41.5719, 1.7834".

    Es lo que da Google Maps al hacer botón derecho sobre el mapa, y lo que
    hay pegado a mano en el full. Se pide el punto decimal a propósito: dos
    enteros seguidos ("Polígon 3 parcela 146") no son coordenadas, y sin
    esta condición cualquier dirección con dos números parecería un punto.
  */
  const solts = brut.match(/(-?\d{1,3}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)/);
  if (solts) {
    const lat = Number(solts[1]);
    const lng = Number(solts[2]);
    if (valid(lat, lng)) return { lat, lng };
  }

  return null;
}

/**
 * Lo que queda de la dirección después de quitarle las coordenadas pegadas.
 *
 * En el full hay filas como "Cami Llibertat, 6 Coordenadas de Google Maps
 * 41.57…,1.78…": la dirección de verdad es la de delante, y el resto es una
 * nota que alguien dejó porque no tenía dónde ponerla. Separándolas, la
 * columna de la dirección vuelve a ser una dirección.
 */
export function adrecaSenseCoordenades(text: string): string {
  return (text ?? "")
    // Las coordenadas, en cualquiera de sus formas.
    .replace(/\(?\s*-?\d{1,3}\.\d+\s*[,;\s]\s*-?\d{1,3}\.\d+\s*\)?/g, " ")
    .replace(
      /\(?\s*\d+\s*°[^,;]*?["″]?\s*[NSns][,\s]+\d+\s*°[^,;)]*?["″]?\s*[EWOewo]\s*\)?/g,
      " ",
    )
    // Y la coletilla que las presenta, que sin ellas no dice nada.
    .replace(/\bcoordenad[ae]s?\b(\s+(de|d'|google|maps|gps))*\s*:?/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,;.\-]+$/u, "")
    .trim();
}
