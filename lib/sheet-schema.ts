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
  id: [
    "Nº Comanda",
    "N Comanda",
    "Numero Comanda",
    "ID Pedido",
    "ID",
    "Pedido",
    "Albaran",
    "Nº Albaran",
    "Referencia",
    "Ref",
  ],

  /** A qué transportista está asignado. Opcional (el Sheet real no la tiene). */
  driverId: ["Transportista", "Repartidor", "Conductor", "Chofer", "Driver", "Tr"],

  /** Fecha de reparto (asignada en el calendario). Opcional. */
  date: ["Data entrega", "Data de entrega", "Data d'entrega", "Fecha Reparto", "Fecha Entrega", "Dia", "Date", "Fecha"],

  /** Prioridad. Menor número = antes. Opcional (si falta, todas iguales). */
  priority: ["Prioritat", "Prioridad", "Orden", "Priority"],

  customer: ["Client", "Cliente", "Nombre", "Destinatario", "Customer"],

  /** Dirección completa para geocodificar y navegar. Obligatoria. */
  address: ["Adreça", "Adreca", "Direccion", "Dirección", "Domicilio", "Address"],

  /** Población / ciudad. Complementa la dirección. */
  city: ["Població", "Poblacio", "Población", "Poblacion", "Ciudad", "City"],

  phone: ["Telefon", "Telefono", "Teléfono", "Movil", "Contacto", "Phone"],

  /** Medidas del paquete. */
  measures: ["Mides", "Medidas", "Measures", "Dimensiones"],

  notes: [
    "Observaciones",
    "Notas",
    "Comentarios",
    "Nota",
    "Notes",
    "Comentaris/Observacions",
    "Observacions",
    "Comentaris",
  ],

  /** Estado de la entrega. La app ESCRIBE aquí. */
  status: [
    "Estat de l'entrega",
    "Estat entrega",
    "Estat",
    "Estado",
    "Status",
    "Entregado",
  ],

  /** Momento de la entrega (timestamp real de cuando el repartidor lo entrega). La app ESCRIBE aquí. */
  deliveredAt: [
    "Hora Entrega",
    "Hora de Entrega",
    "Fecha Entrega Real",
    "Entregado El",
    "Data Lliurament",
  ],

  /** Nota de incidencia del transportista. La app ESCRIBE aquí. */
  incidentNote: ["Incidencia", "Motivo", "Nota Transportista", "Motiu"],

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

/**
 * Columnas sin las cuales no podemos funcionar.
 * Solo id y address son realmente obligatorias — el Sheet real no tiene
 * ni driverId ni date (usa pestañas por mes).
 */
export const REQUIRED_COLUMNS: ColumnKey[] = ["id", "address"];

/** Columnas que la app crea automáticamente si no existen en la hoja. */
export const MANAGED_COLUMNS: ColumnKey[] = [
  "status",
  "deliveredAt",
  "incidentNote",
  "lat",
  "lng",
  "date",
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
  // Campo declarado y asignado a mano en vez de con una "parameter
  // property": Node no las soporta al ejecutar TypeScript directamente, y
  // scripts/check-sheet.mts importa este archivo sin pasar por un compilador.
  readonly missing: ColumnKey[];

  constructor(missing: ColumnKey[]) {
    super(
      `Al Google Sheet le faltan columnas obligatorias: ${missing
        .map((k) => COLUMNS[k][0])
        .join(", ")}. Revisa lib/sheet-schema.ts si en tu hoja se llaman de otra forma.`,
    );
    this.name = "MissingColumnsError";
    this.missing = missing;
  }
}
