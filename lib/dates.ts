/**
 * Todo en la app usa fechas en formato `YYYY-MM-DD` como string plano.
 * Ni objetos Date ni timestamps: una fecha de reparto es un día del
 * calendario, no un instante, y tratarla como instante es la vía rápida a
 * que a alguien le desaparezcan los pedidos a medianoche.
 */

export type DateString = string; // YYYY-MM-DD

/** El "hoy" del negocio, en la zona horaria configurada. */
export function today(timezone: string): DateString {
  // en-CA da directamente el formato YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDays(date: DateString, days: number): DateString {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * Google Sheets guarda las fechas como número de serie: días transcurridos
 * desde el 30/12/1899. Un valor de 45000 son ~123 años de días.
 */
function serialToDateString(serial: number): DateString {
  const epoch = Date.UTC(1899, 11, 30);
  // Se trunca la parte decimal (la hora) porque solo interesa el día.
  const ms = epoch + Math.floor(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Convierte lo que venga de una celda de fecha a `YYYY-MM-DD`.
 *
 * Acepta el número de serie de Sheets (cuando la celda es una fecha de
 * verdad) y varios formatos de texto (cuando alguien la escribió a mano).
 * Los formatos con barras se interpretan como DD/MM/YYYY, que es lo
 * habitual en España.
 *
 * Devuelve `null` si no se puede interpretar, para que la fila se descarte
 * con un aviso en vez de colarse con una fecha inventada.
 */
export function parseSheetDate(value: unknown): DateString | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return serialToDateString(value);
  }

  const text = String(value).trim();
  if (text === "") return null;

  // Ya viene en ISO: 2026-08-04 (o con hora detrás).
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // Formato español: 4/8/2026, 04-08-2026, 4.8.26
  const eu = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (eu) {
    const day = Number(eu[1]);
    const month = Number(eu[2]);
    let year = Number(eu[3]);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

/** Fecha legible para la cabecera de la pantalla: "martes, 4 de agosto". */
export function formatLongDate(date: DateString, locale = "es-ES"): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Timestamp para escribir en el Sheet: "04/08/2026 14:32".
 *
 * Se compone pieza a pieza en vez de usar `format()` directamente porque
 * es-ES mete una coma entre la fecha y la hora ("04/08/2026, 14:32"), y con
 * esa coma Google Sheets no lo reconoce como fecha-hora: lo guarda como
 * texto plano. La celda deja entonces de poder ordenarse o filtrarse por
 * fecha, que es justo para lo que sirve esa columna.
 */
export function formatSheetTimestamp(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("es-ES", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));

  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}
