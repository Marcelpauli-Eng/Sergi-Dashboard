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
    "ID Pedido",
    "ID",
    "Pedido",
    "Albaran",
    "Nº Albaran",
    "Referencia",
    "Ref",
    "Nº Comanda",
    "Comanda",
  ],

  /**
   * A qué transportista está asignado. OPCIONAL.
   *
   * Si la hoja no tiene esta columna, la app entiende que hay un único
   * transportista y le enseña todos los pedidos del día sin filtrar. El día
   * que se añada la columna, el filtro se activa solo.
   */
  driverId: ["Transportista", "Repartidor", "Conductor", "Chofer", "Driver", "Xofer"],

  /**
   * Fecha de reparto: el día en que hay que entregar. Obligatoria.
   *
   * OJO con el orden de esta lista. En la hoja de la oficina conviven dos
   * columnas de fecha: "Data", que es cuándo ENTRÓ el pedido, y "Data
   * entrega", que es cuándo hay que llevarlo. La que manda la ruta es la
   * segunda, así que va antes: si se coge "Data" se compara la fecha de
   * alta con la de hoy y no aparece ningún pedido.
   */
  date: [
    "Fecha",
    "Fecha Reparto",
    "Fecha Entrega",
    "Data entrega",
    "Data Lliurament",
    "Dia",
    "Date",
    "Data",
  ],

  /**
   * Prioridad. Menor número = antes. Opcional (si falta, todas iguales).
   * Admite también texto: ver `parsePriority` en lib/sheets.ts.
   */
  priority: ["Prioridad", "Orden", "Priority", "Prioritat"],

  customer: ["Cliente", "Nombre", "Destinatario", "Customer", "Client"],

  /** Calle y número. Obligatoria. */
  address: ["Direccion", "Dirección", "Domicilio", "Address", "Adreça", "Carrer"],

  /**
   * Municipio y código postal, cuando van en una columna aparte de la calle.
   *
   * Opcional: si existe, se concatena con `address` antes de geocodificar.
   * Sin ella, "Carrer Major, 53" a secas es ambiguo — hay uno en casi cada
   * pueblo de Cataluña — y Google devuelve unas coordenadas cualesquiera.
   */
  town: [
    "Poblacion",
    "Población",
    "Població",
    "Municipio",
    "Municipi",
    "Localidad",
    "Localitat",
    "Ciudad",
    "Ciutat",
  ],

  phone: ["Telefono", "Teléfono", "Movil", "Contacto", "Phone", "Telèfon", "Mòbil"],

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
  status: ["Estado", "Status", "Entregado", "Estat de l'entrega", "Estat"],

  /** Momento de la entrega. La app ESCRIBE aquí. */
  deliveredAt: [
    "Hora Entrega",
    "Fecha Entrega Real",
    "Entregado El",
    "Data entrega",
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
 *
 * `driverId` NO está aquí a propósito: con un solo transportista la hoja no
 * necesita decir a quién va cada pedido. Ver el comentario de `driverId`.
 */
export const REQUIRED_COLUMNS: ColumnKey[] = ["id", "date", "address"];

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
