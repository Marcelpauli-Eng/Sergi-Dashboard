/**
 * Mapeo entre las columnas del Google Sheet y el modelo interno.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ESTE ES EL ÚNICO ARCHIVO QUE HAY QUE TOCAR SI CAMBIAN LAS COLUMNAS.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cada campo lista los nombres de cabecera que aceptamos. La comparación
 * ignora mayúsculas, acentos, espacios y guiones bajos, así que "Nº Albarán",
 * "n albaran" y "N_ALBARAN" se consideran la misma columna.
 *
 * El primer nombre de cada lista es el "canónico": es el que se usa al crear
 * columnas nuevas en la hoja (por ejemplo las de coordenadas cacheadas).
 */

export const COLUMNS = {
  /** Identificador único del pedido. Obligatoria. */
  id: ["ID Pedido", "ID", "Pedido", "Albaran", "Nº Albaran", "Referencia", "Ref"],

  /** A qué transportista está asignado. Obligatoria. */
  driverId: ["Transportista", "Repartidor", "Conductor", "Chofer", "Driver"],

  /** Fecha de reparto. Obligatoria. */
  date: ["Fecha", "Fecha Reparto", "Fecha Entrega", "Dia", "Date"],

  /** Prioridad. Menor número = antes. Opcional (si falta, todas iguales). */
  priority: ["Prioridad", "Orden", "Priority"],

  customer: ["Cliente", "Nombre", "Destinatario", "Customer"],

  /** Dirección completa para geocodificar y navegar. Obligatoria. */
  address: ["Direccion", "Dirección", "Domicilio", "Address"],

  phone: ["Telefono", "Teléfono", "Movil", "Contacto", "Phone"],

  notes: ["Observaciones", "Notas", "Comentarios", "Nota", "Notes"],

  /** Estado de la entrega. La app ESCRIBE aquí. */
  status: ["Estado", "Status", "Entregado"],

  /** Momento de la entrega. La app ESCRIBE aquí. */
  deliveredAt: ["Hora Entrega", "Fecha Entrega Real", "Entregado El"],

  /** Nota de incidencia del transportista. La app ESCRIBE aquí. */
  incidentNote: ["Incidencia", "Motivo", "Nota Transportista"],

  /**
   * Coordenadas cacheadas. La app las ESCRIBE la primera vez que geocodifica
   * una dirección, y a partir de ahí las reutiliza. Esto evita pagar
   * geocoding cada día por las mismas direcciones. Se pueden ocultar en el
   * Sheet sin problema: la API las lee igual.
   */
  lat: ["_lat", "lat", "latitud"],
  lng: ["_lng", "lng", "longitud"],
} as const;

export type ColumnKey = keyof typeof COLUMNS;

/** Columnas sin las cuales no podemos funcionar. */
export const REQUIRED_COLUMNS: ColumnKey[] = ["id", "driverId", "date", "address"];

/** Columnas que la app crea automáticamente si no existen en la hoja. */
export const MANAGED_COLUMNS: ColumnKey[] = [
  "status",
  "deliveredAt",
  "incidentNote",
  "lat",
  "lng",
];

/**
 * Normaliza una cabecera para poder compararla:
 * minúsculas, sin acentos, sin espacios ni signos.
 */
export function normalizeHeader(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita los diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Dada la fila de cabeceras de la hoja, devuelve el índice de columna
 * (0-indexed) de cada campo del modelo. Los campos no encontrados se omiten.
 */
export function mapHeaders(headerRow: string[]): Partial<Record<ColumnKey, number>> {
  const normalized = headerRow.map((h) => normalizeHeader(h ?? ""));
  const result: Partial<Record<ColumnKey, number>> = {};

  for (const [key, aliases] of Object.entries(COLUMNS) as [
    ColumnKey,
    readonly string[],
  ][]) {
    for (const alias of aliases) {
      const index = normalized.indexOf(normalizeHeader(alias));
      if (index !== -1) {
        result[key] = index;
        break;
      }
    }
  }

  return result;
}

/** Nombre canónico de una columna, el que se escribe al crearla. */
export function canonicalHeader(key: ColumnKey): string {
  return COLUMNS[key][0];
}

export class MissingColumnsError extends Error {
  constructor(public readonly missing: ColumnKey[]) {
    super(
      `Al Google Sheet le faltan columnas obligatorias: ${missing
        .map((k) => COLUMNS[k][0])
        .join(", ")}. Revisa lib/sheet-schema.ts si en tu hoja se llaman de otra forma.`,
    );
    this.name = "MissingColumnsError";
  }
}
