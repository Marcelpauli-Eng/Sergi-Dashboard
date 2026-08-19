/**
 * Decodifica el formato "encoded polyline" de Google a coordenadas.
 *
 * Es el formato con el que la Routes API devuelve la geometría del recorrido:
 * una cadena corta en la que cada punto se guarda como la diferencia respecto
 * al anterior, en incrementos de 1e-5 grados, troceada en grupos de 5 bits.
 *
 * Va en su propio módulo, sin dependencias, para poder usarlo tanto en el
 * servidor como en el navegador y probarlo sin montar nada.
 */

export interface Punto {
  lat: number;
  lng: number;
}

export function decodePolyline(encoded: string): Punto[] {
  const puntos: Punto[] = [];
  let indice = 0;
  let lat = 0;
  let lng = 0;

  while (indice < encoded.length) {
    // Cada coordenada se lee igual: grupos de 5 bits, el bit 6 indica que
    // aún quedan grupos, y el bit menos significativo del total es el signo.
    const leer = (): number | null => {
      let resultado = 0;
      let desplazamiento = 0;
      let byte: number;

      do {
        if (indice >= encoded.length) return null;
        byte = encoded.charCodeAt(indice++) - 63;
        resultado |= (byte & 0x1f) << desplazamiento;
        desplazamiento += 5;
      } while (byte >= 0x20);

      return resultado & 1 ? ~(resultado >> 1) : resultado >> 1;
    };

    const dLat = leer();
    const dLng = leer();
    // Una cadena cortada a medias deja de aportar puntos, pero no debe tumbar
    // la pantalla: se devuelve lo leído hasta ahí.
    if (dLat === null || dLng === null) break;

    lat += dLat;
    lng += dLng;
    puntos.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return puntos;
}

/**
 * Proyecta coordenadas a un lienzo de `ancho` × `alto`, conservando la
 * proporción real del terreno.
 *
 * Es una proyección plana con corrección por latitud: a 41° un grado de
 * longitud mide unos 84 km y uno de latitud 111, así que sin corregir el
 * dibujo saldría estirado a lo ancho. Para la escala de una ciudad la
 * curvatura de la Tierra no se nota.
 */
export function proyectar(
  puntos: Punto[],
  ancho: number,
  alto: number,
  margen = 14,
): { x: number; y: number }[] {
  if (puntos.length === 0) return [];

  const latMedia = puntos.reduce((s, p) => s + p.lat, 0) / puntos.length;
  const factorX = Math.cos((latMedia * Math.PI) / 180);

  const xs = puntos.map((p) => p.lng * factorX);
  const ys = puntos.map((p) => -p.lat); // norte arriba

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const anchoUtil = ancho - margen * 2;
  const altoUtil = alto - margen * 2;
  // Una sola escala para los dos ejes: si se escalaran por separado, la ruta
  // saldría deformada y dejaría de parecerse al recorrido real.
  const escala = Math.min(
    (maxX - minX) > 0 ? anchoUtil / (maxX - minX) : Infinity,
    (maxY - minY) > 0 ? altoUtil / (maxY - minY) : Infinity,
  );
  const escalaFinal = Number.isFinite(escala) ? escala : 1;

  // Sobra del lienzo que no ocupa el dibujo: se reparte para centrarlo.
  const sobraX = anchoUtil - (maxX - minX) * escalaFinal;
  const sobraY = altoUtil - (maxY - minY) * escalaFinal;

  return puntos.map((p, i) => ({
    x: margen + sobraX / 2 + (xs[i] - minX) * escalaFinal,
    y: margen + sobraY / 2 + (ys[i] - minY) * escalaFinal,
  }));
}
