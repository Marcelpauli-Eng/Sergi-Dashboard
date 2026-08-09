/**
 * Modelo de dominio de la aplicación.
 *
 * El Google Sheet es la única fuente de verdad. Estos tipos son la forma
 * normalizada en la que el resto de la app trabaja con esos datos, para que
 * un cambio de columnas en el Sheet solo afecte a `lib/sheet-schema.ts`.
 */

export type DeliveryStatus = "pendiente" | "entregado" | "incidencia";

/** Una fila del Sheet, ya normalizada. */
export interface Order {
  /** Identificador único e inmutable del pedido (nº de comanda). */
  id: string;
  /** Código del transportista al que está asignado. Vacío si el Sheet no tiene esa columna. */
  driverId: string;
  /** Fecha de reparto en formato YYYY-MM-DD. Vacío si el Sheet usa pestañas por mes. */
  date: string;
  /** Prioridad tal cual viene del Sheet. Menor número = más prioritario. */
  priority: number;
  customer: string;
  address: string;
  /** Población / ciudad. Complementa la dirección. */
  city: string | null;
  phone: string | null;
  /** Medidas del paquete. */
  measures: string | null;
  notes: string | null;
  status: DeliveryStatus;
  /** Valor original de la celda "Estat de l'entrega", sin transformar. Vacío si la celda no tiene valor. */
  rawStatus: string;
  /** Coordenadas cacheadas en el Sheet para no re-geocodificar cada día. */
  lat: number | null;
  lng: number | null;
  /**
   * Fila real dentro de la hoja (1-indexed, tal y como la numera Sheets).
   * Se usa para escribir el estado de vuelta. Nunca se envía al cliente:
   * se recalcula releyendo la hoja justo antes de escribir, porque la oficina
   * puede insertar o borrar filas en cualquier momento.
   */
  rowNumber: number;
}

/** Un pedido ya colocado en su posición dentro de la ruta del día. */
export interface Stop extends Omit<Order, "rowNumber"> {
  /** Posición en la ruta, empezando en 1. */
  sequence: number;
  /** Enlace que abre la navegación en Google Maps (app nativa si está instalada). */
  navUrl: string;
  /** Metros desde la parada anterior (o desde la central, si es la primera). */
  legDistanceMeters: number | null;
  /** Segundos de conducción desde la parada anterior. */
  legDurationSeconds: number | null;
}

/** La ruta completa de un día para un transportista. */
export interface RouteDay {
  date: string;
  stops: Stop[];
  /**
   * `true` si Google devolvió un orden optimizado. `false` significa que
   * caímos al fallback y el orden es solo por prioridad (sin cobertura de
   * la API, sin coordenadas, o error del servicio).
   */
  optimized: boolean;
  /** Enlace que abre la ruta completa multi-parada en Google Maps. */
  fullRouteUrl: string | null;
  totalDistanceMeters: number | null;
  totalDurationSeconds: number | null;
}

/**
 * El paquete que se descarga de una vez y se guarda en IndexedDB.
 * Todo lo que el transportista necesita para trabajar sin cobertura.
 */
export interface Manifest {
  driverId: string;
  driverName: string;
  /** ISO timestamp de cuándo se generó, para mostrar "actualizado hace X". */
  generatedAt: string;
  /**
   * `true` si los datos son de mentira (modo demo). La interfaz lo señala de
   * forma bien visible para que nadie los confunda con pedidos reales.
   */
  demo?: boolean;
  /** Nombre de la pestaña del Sheet que se está usando. */
  sheetTab: string;
  today: RouteDay;
  tomorrow: RouteDay | null;
}

/**
 * Una acción de entrega registrada por el transportista.
 * Vive en la cola local (outbox) hasta que se confirma en el Sheet.
 */
export interface DeliveryRecord {
  /** UUID generado en el cliente. Garantiza idempotencia si se reintenta. */
  clientId: string;
  orderId: string;
  status: Exclude<DeliveryStatus, "pendiente">;
  /** ISO timestamp del momento real en que se pulsó el botón, no del envío. */
  recordedAt: string;
  /** Texto libre, solo para incidencias. */
  note: string | null;
}

/** Datos públicos de un transportista. El PIN nunca sale del servidor. */
export interface Driver {
  id: string;
  name: string;
}
