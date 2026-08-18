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

  // Formato español: 4/8/2026, 04-08-2026, 4.8.26 — con hora opcional
  // detrás ("8/08/2026 13:50"), que es como queda la celda cuando la app
  // escribe la entrega y Sheets la guarda como texto en vez de como fecha.
  // Sin esto esa fila se descartaba por "fecha ilegible".
  const eu = text.match(
    /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[ ,]+\d{1,2}:\d{2}(?::\d{2})?)?$/,
  );
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
 * Se compone pieza a pieza en vez de usar `format()` porque es-ES mete una
 * coma entre fecha y hora ("04/08/2026, 14:32"), y con esa coma Google
 * Sheets no lo reconoce como fecha-hora: lo guarda como texto. La celda deja
 * de poder ordenarse o filtrarse por fecha, y si la columna tiene un tipo de
 * fecha asignado puede rechazar la escritura entera.
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

/**
 * Obtiene todos los días de un mes (con los padding del mes anterior y siguiente
 * para cuadrar con semanas que empiezan en lunes).
 */
export function getMonthGrid(year: number, month: number): DateString[] {
  const grid: DateString[] = [];
  
  // Día 1 del mes
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const dayOfWeek = firstDay.getDay(); // 0 is Sunday, 1 is Monday
  const padStart = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  
  // Días del mes anterior
  for (let i = padStart; i > 0; i--) {
    const d = new Date(Date.UTC(year, month - 1, 1 - i));
    grid.push(d.toISOString().slice(0, 10));
  }
  
  // Días del mes actual
  const lastDay = new Date(Date.UTC(year, month, 0)).getDate();
  for (let i = 1; i <= lastDay; i++) {
    const d = new Date(Date.UTC(year, month - 1, i));
    grid.push(d.toISOString().slice(0, 10));
  }
  
  // Días del mes siguiente (para rellenar la última semana)
  const remaining = grid.length % 7;
  if (remaining > 0) {
    const padEnd = 7 - remaining;
    for (let i = 1; i <= padEnd; i++) {
      const d = new Date(Date.UTC(year, month - 1, lastDay + i));
      grid.push(d.toISOString().slice(0, 10));
    }
  }
  
  return grid;
}

/** Extrae el año y mes de una DateString */
export function getYearMonth(dateStr: DateString): { year: number, month: number } {
  const [y, m] = dateStr.split("-").map(Number);
  return { year: y, month: m };
}
