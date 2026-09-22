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

/**
 * Teléfono en formato marcable: el PRIMER número de la celda.
 *
 * En la hoja real una celda trae de todo: un nombre delante ("Javi 6…"),
 * dos y hasta tres números ("93 322 11 00 / 666 555 444 / …") o quién es
 * cada uno ("LLUIS 9… / SERGI 6…"). Quitarle sin más lo que no es un dígito
 * pegaba los números uno detrás de otro y marcaba un número de 18 cifras
 * que no es de nadie.
 *
 * Se parte por los separadores de verdad —la barra, la coma, el punto y
 * coma y el guion SUELTO— y se coge el primer trozo que tenga números. El
 * guion pegado no separa: "977-33-22-11" es un número, no dos.
 *
 * Antes se tira el paréntesis que lleve letras: la nota "(TRUCAR AMB 5 DIES
 * D'ANTELACIÓ)" le pegaba su 5 al final del número y marcaba una cifra de
 * más. El paréntesis sin letras es prefijo —"(977) 33 22 11"— y se queda.
 * ponytail: solo el paréntesis; una nota suelta con números al lado seguiría
 * pegándose — arreglar si aparece en la hoja.
 */
export function telHref(phone: string): string {
  const limpio = phone.replace(/\([^)]*\p{L}[^)]*\)/gu, " ");
  const marcable =
    limpio
      .split(/[/;,]|\s+[-–—]\s+/)
      .map((trozo) => trozo.replace(/[^\d+]/g, ""))
      .find((trozo) => trozo.replace(/\D/g, "").length >= 6) ??
    limpio.replace(/[^\d+]/g, "");
  return `tel:${marcable}`;
}
