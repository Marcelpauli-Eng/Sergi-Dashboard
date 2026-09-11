/**
 * Comprobación de las fechas del Sheet y del formateo de pantalla.
 *
 *   npm run check:format
 *
 * `parseSheetDate` es la que decide si una fila entra o se descarta: una
 * fecha que no se sabe leer tira el pedido entero. Y Google Sheets devuelve
 * las fechas de cuatro formas distintas según cómo esté la celda, así que
 * las cuatro tienen que estar cubiertas.
 */

import assert from "node:assert/strict";
import {
  addDays,
  formatLongDate,
  formatSheetTimestamp,
  parseSheetDate,
  today,
} from "../lib/dates.ts";
import {
  formatDistance,
  formatDuration,
  formatRelativeTime,
  telHref,
} from "../lib/format.ts";
import { decodePolyline } from "../lib/polyline.ts";

// ── Fechas que vienen del Sheet ──────────────────────────────────────────
{
  // Número de serie: la celda es una fecha de verdad. 45000 = 2023-03-15.
  assert.equal(parseSheetDate(45000), "2023-03-15");
  // Con hora detrás: se trunca, que solo interesa el día.
  assert.equal(parseSheetDate(45000.75), "2023-03-15");

  // ISO, que es como la escribe la propia app.
  assert.equal(parseSheetDate("2026-08-26"), "2026-08-26");
  assert.equal(parseSheetDate("2026-08-26T10:00:00Z"), "2026-08-26");

  // Formato español escrito a mano, que es lo habitual en la hoja.
  assert.equal(parseSheetDate("4/8/2026"), "2026-08-04");
  assert.equal(parseSheetDate("04-08-2026"), "2026-08-04");
  assert.equal(parseSheetDate("4.8.26"), "2026-08-04");

  // Con la hora que le añade Sheets al guardar la entrega como texto. Este
  // es el que descartaba filas por "fecha ilegible".
  assert.equal(parseSheetDate("8/08/2026 13:50"), "2026-08-08");
  assert.equal(parseSheetDate("8/08/2026 13:50:22"), "2026-08-08");

  // Vacío no es un error, es que no hay fecha.
  assert.equal(parseSheetDate(""), null);
  assert.equal(parseSheetDate(null), null);
  assert.equal(parseSheetDate(undefined), null);

  // Y lo que de verdad no se puede leer.
  assert.equal(parseSheetDate("pendiente"), null);
  assert.equal(parseSheetDate("32/13/2026"), null, "un mes 13 no existe");
}

// ── Días que no existen ──────────────────────────────────────────────────
// Pasan los rangos (día 1-31, mes 1-12) y no son fechas. Aceptarlos es peor
// que descartar la fila: la comanda se queda con una fecha que no le toca a
// ningún día del calendario y desaparece de la rejilla sin salir tampoco en
// la bolsa de pendientes.
{
  assert.equal(parseSheetDate("31/02/2026"), null, "el 31 de febrero no existe");
  assert.equal(parseSheetDate("30/02/2026"), null);
  assert.equal(parseSheetDate("31/04/2026"), null, "abril tiene 30 días");
  assert.equal(parseSheetDate("2026-02-31"), null, "tampoco escrito en ISO");
  assert.equal(parseSheetDate("00/01/2026"), null);

  // Y el 29 de febrero sí existe cuando toca.
  assert.equal(parseSheetDate("29/02/2028"), "2028-02-29");
  assert.equal(parseSheetDate("29/02/2026"), null, "2026 no es bisiesto");
  assert.equal(parseSheetDate("29/02/2100"), null, "2100 tampoco lo es");
}

// ── Día siguiente y anterior ─────────────────────────────────────────────
{
  assert.equal(addDays("2026-08-26", 1), "2026-08-27");
  assert.equal(addDays("2026-08-26", -1), "2026-08-25");
  // Los saltos que rompen la aritmética ingenua.
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2028-03-01", -1), "2028-02-29", "2028 es bisiesto");
}

// ── El "hoy" del negocio ─────────────────────────────────────────────────
// No es el del servidor: si el servidor va en UTC y el transportista abre la
// app a las 00:30 en España, "hoy" tiene que ser su hoy.
{
  assert.match(today("Europe/Madrid"), /^\d{4}-\d{2}-\d{2}$/);
  // A la 01:00 de Madrid en verano son las 23:00 del día ANTERIOR en UTC.
  // El día del negocio es el de Madrid.
  const madrid = today("Europe/Madrid");
  const utc = today("UTC");
  assert.ok(madrid >= utc, "Madrid nunca va por detrás de UTC");
}

// ── Timestamp que Sheets acepta como fecha-hora ──────────────────────────
// Sin coma: con ella, Sheets lo guarda como texto y la celda deja de poder
// ordenarse o filtrarse por fecha.
{
  const sello = formatSheetTimestamp("2026-08-26T12:32:00.000Z", "Europe/Madrid");
  assert.match(sello, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  assert.ok(!sello.includes(","), "la coma rompe la celda de fecha en Sheets");
  assert.equal(sello, "26/08/2026 14:32", "verano en Madrid es UTC+2");
}

{
  assert.equal(formatLongDate("2026-08-26"), "miércoles, 26 de agosto");
}

// ── Distancias y tiempos ─────────────────────────────────────────────────
{
  assert.equal(formatDistance(null), null);
  assert.equal(formatDistance(940), "940 m");
  assert.equal(formatDistance(945), "950 m", "se redondea a la decena");
  assert.equal(formatDistance(1200), "1,2 km");
  assert.equal(formatDistance(18400), "18 km", "a partir de 10 km sobran los decimales");

  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration(300), "5 min");
  assert.equal(formatDuration(3600), "1 h");
  assert.equal(formatDuration(4320), "1 h 12 min");
  assert.equal(formatDuration(29), "0 min");
}

// ── "actualizado hace…" ──────────────────────────────────────────────────
{
  const hace = (ms: number) => formatRelativeTime(new Date(Date.now() - ms).toISOString());
  assert.equal(hace(5_000), "ahora mismo");
  assert.equal(hace(5 * 60_000), "hace 5 min");
  assert.equal(hace(3 * 3_600_000), "hace 3 h");
  assert.equal(hace(26 * 3_600_000), "ayer");
  assert.equal(hace(3 * 24 * 3_600_000), "hace 3 días");
}

// ── Teléfono marcable ────────────────────────────────────────────────────
{
  assert.equal(telHref("+34 932 91 90 00"), "tel:+34932919000");
  assert.equal(telHref("977-33-22-11"), "tel:977332211");
  assert.equal(telHref("(977) 33 22 11"), "tel:977332211");

  // Casos de la hoja de verdad: nombre delante, dos y tres números, y quién
  // es cada uno. Se marca el primero, no todos pegados.
  assert.equal(telHref("Javi 666555444"), "tel:666555444");
  assert.equal(telHref("932 91 90 00 / 666 55 54 44"), "tel:932919000");
  assert.equal(telHref("932 91 90 00 / 666 55 54 44 / 977 33 22 11"), "tel:932919000");
  assert.equal(telHref("932 91 90 00  -  666555444"), "tel:932919000");
  assert.equal(telHref("LLUIS 932 91 90 00 / SERGI 666 55 54 44"), "tel:932919000");
  assert.equal(telHref("666555444 (Javi)"), "tel:666555444");
  assert.equal(telHref("Xavi Pare Duba: +34 932 91 90 00"), "tel:+34932919000");
  // El nombre antes de un guion suelto no es un número: se salta al que sí.
  assert.equal(telHref("· Montse - +34 932 91 90 00"), "tel:+34932919000");
}

// ── Geometría del recorrido ──────────────────────────────────────────────
{
  // El ejemplo de la documentación de Google.
  const puntos = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.equal(puntos.length, 3);
  assert.deepEqual(puntos[0], { lat: 38.5, lng: -120.2 });
  assert.deepEqual(puntos[1], { lat: 40.7, lng: -120.95 });
  assert.deepEqual(puntos[2], { lat: 43.252, lng: -126.453 });

  assert.deepEqual(decodePolyline(""), []);
  // Una cadena cortada a medias devuelve lo que se pudo leer, no revienta.
  assert.doesNotThrow(() => decodePolyline("_p~iF~ps|U_ulL"));
}

console.log("✓ lib/dates.ts + lib/format.ts + lib/polyline.ts — fechas y formatos");
