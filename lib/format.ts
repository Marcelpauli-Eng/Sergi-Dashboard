/** Formateo para pantalla. Sin dependencias de servidor: se usa en el cliente. */

export function formatDistance(meters: number | null): string | null {
  if (meters === null) return null;
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  const km = meters / 1000;
  return `${km.toLocaleString("es-ES", { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "hace 5 min", "hace 2 h", "ayer". Para saber si los datos están frescos. */
export function formatRelativeTime(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(elapsed / 60_000);

  if (minutes < 1) return "ahora mismo";
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  const days = Math.floor(hours / 24);
  return days === 1 ? "ayer" : `hace ${days} días`;
}

/** Teléfono en formato marcable, quitando espacios y guiones. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
