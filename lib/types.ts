/**
 * Modelo de dominio de la aplicación.
 *
 * El Google Sheet es la única fuente de verdad. Estos tipos son la forma
 * normalizada en la que el resto de la app trabaja con esos datos, para que
 * un cambio de columnas en el Sheet solo afecte a `lib/sheet-schema.ts`.
 */

/**
 * Los estados de una entrega, como lista y como tipo.
 *
 * La lista es lo que valida la API (`app/api/deliveries/route.ts`), y el tipo
 * sale de ella. Escribirlos dos veces costó caro: el esquema se quedó sin
 * "pendiente" —el estado que manda el botón de Desfer— y como la cola se
 * sube en un solo lote, un deshacer devolvía 400 y se llevaba por delante
 * todo lo que hubiera pendiente detrás, importes incluidos.
 */
export const DELIVERY_STATUSES = ["pendiente", "entregado", "incidencia"] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Por dónde va el cobro de una factura ya emitida. */
export type EstatFactura = "emesa" | "enviada" | "cobrada";

/** Una fila del Sheet, ya normalizada. */
export interface Order {
  /**
   * Clave única del pedido dentro de la app.
   *
   * Normalmente es el nº de comanda tal cual. Pero una comanda se puede
   * entregar en dos veces —una parte hoy y el resto cuando llegue— y la
   * oficina apunta cada parte en su fila, las dos con el mismo número. Son
   * dos entregas: cada una tiene su día, su hora y lo que se cobra por
   * hacerla. Antes la segunda se descartaba al leer la hoja.
   *
   * Por eso la segunda parte lleva la clave "748#2": para que marcar una
   * entregada no marque la otra y cada una lleve su propio importe. Es lo
   * que viaja por la cola, la API y la pestaña de importes.
   *
   * Lo que se enseña y lo que va a una factura es `codi`, nunca esto.
   */
  id: string;
  /**
   * El nº de comanda tal cual está escrito en la hoja, para enseñar y para
   * facturar. Las dos partes del 748 tienen aquí "748": para la empresa y
   * para el cliente es una sola comanda.
   */
  codi: string;
  /** Qué parte de la comanda es esta entrega. 1 cuando no está partida. */
  part: number;
  /** En cuántas partes está partida la comanda. 1 cuando no lo está. */
  parts: number;
  /** Código del transportista al que está asignado. Vacío si el Sheet no tiene esa columna. */
  driverId: string;
  /** Fecha de creación o de registro en el Sheet por parte de la empresa. */
  creationDate: string | null;
  /** Fecha de reparto en formato YYYY-MM-DD. Vacío si el Sheet usa pestañas por mes. */
  date: string;
  /** Prioridad tal cual viene del Sheet. Menor número = más prioritario. */
  priority: number;
  customer: string;
  address: string;
  /** Población / ciudad. Complementa la dirección. */
  city: string | null;
  /**
   * A quién se le factura este pedido, por su código de cliente.
   *
   * `null` cuando la hoja no tiene esa columna o la celda está vacía, que es
   * el caso normal hoy: se factura todo al único cliente de Ajustes. Solo
   * hace falta rellenarla el día que se le facture a más de uno.
   */
  billingClient: string | null;
  phone: string | null;
  /** Medidas de lo que se lleva en esta entrega, tal cual están en su fila. */
  measures: string | null;
  notes: string | null;
  /**
   * A qué hora se entregó, "HH:MM". `null` mientras no se haya entregado.
   *
   * Sale de la misma celda que `date`: al marcar la entrega se escribe ahí
   * la fecha y la hora. Ver `parseSheetTime` en lib/dates.ts.
   */
  deliveredTime: string | null;
  /** Qué pasó, cuando hubo incidencia. Lo escribe el transportista. */
  incidentNote: string | null;
  status: DeliveryStatus;
  /** Valor original de la celda "Estat de l'entrega", sin transformar. Vacío si la celda no tiene valor. */
  rawStatus: string;
  /** Categoría de estado derivada del valor original de la celda. */
  statusCategory: "pendent" | "en_curs" | "entregat" | "incidencia";
  /**
   * Importe cobrado por este pedido, sin IVA. Lo pone el transportista al
   * entregar. `null` mientras no se haya entregado o no se haya puesto.
   */
  price: number | null;
  /** Coordenadas cacheadas en el Sheet para no re-geocodificar cada día. */
  lat: number | null;
  lng: number | null;
  /**
   * La dirección de la que salieron esas coordenadas.
   *
   * Es lo que permite saber si siguen valiendo: cuando no coincide con la
   * dirección que hay hoy en la fila, alguien la ha corregido y las
   * coordenadas ya no llevan donde hay que ir. Ver `construirComandes`, que
   * las tira en ese caso, y `geocodificarPendents`, que las rehace.
   *
   * Apuntada SIN coordenadas significa que Google no reconoció esa
   * dirección: no se le vuelve a preguntar hasta que cambie.
   */
  geoAddress: string | null;
  /**
   * El identificador del portal en Google, al lado de las coordenadas.
   *
   * Es lo que hace que navegar caiga en el portal y no donde Maps crea: con
   * él no vuelve a interpretar la dirección. `null` cuando el punto no salió
   * de una ficha de Google —lo pegó una persona del mapa— o cuando se
   * geocodificó antes de guardarlo.
   */
  placeId: string | null;
  /**
   * Hasta dónde afina el punto guardado: el portal, la ficha del negocio,
   * la calle sin número o el centro del pueblo.
   *
   * `geoAddress` dice si el punto está caducado; esto dice si el punto es la
   * casa o solo la zona. Se guarda para avisar al transportista cuando NO es
   * el portal —que es justo cuando la navegación "no marca exacto"— y para
   * volver a intentarlo otro día a ver si Google ya lo sabe.
   */
  geoLevel: "portal" | "negoci" | "carrer" | "poble" | null;
  /**
   * Fila real dentro de la hoja (1-indexed, tal y como la numera Sheets).
   * Se usa para escribir el estado de vuelta. Nunca se envía al cliente:
   * se recalcula releyendo la hoja justo antes de escribir, porque la oficina
   * puede insertar o borrar filas en cualquier momento.
   */
  rowNumber: number;
  /**
   * TODAS las filas de la comanda, una por bulto, incluida `rowNumber`.
   *
   * Al marcar la entrega se escribe en todas: si solo se marcara la primera,
   * la oficina vería una comanda a medias —en la hoja real hay comandas con
   * dos filas "Pendent" y una "Entregat"— y no hay forma de saber desde
   * fuera que están entregadas del todo.
   */
  rowNumbers: number[];
}

/** Un pedido ya colocado en su posición dentro de la ruta del día. */
export interface Stop extends Omit<Order, "rowNumber" | "rowNumbers"> {
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
  /**
   * Tipo de actualización. Si no se especifica, por retrocompatibilidad se
   * asume "status".
   *
   * "price" toca SOLO la celda del importe. Existe porque corregir un
   * importe mal tecleado no puede reescribir la hora de entrega: esa hora es
   * el registro de cuándo se entregó de verdad, y un dedazo en el precio no
   * cambia cuándo pasó.
   */
  type?: "status" | "date" | "price";
  /**
   * "pendiente" es el deshacer: devuelve el pedido a como estaba antes de
   * marcarlo, vaciando estado, hora e incidencia en la hoja. Solo lo genera
   * el botón de Desfer.
   */
  status?: DeliveryStatus;
  date?: string | null;
  /** ISO timestamp del momento real en que se pulsó el botón, no del envío. */
  recordedAt: string;
  /** Texto libre, solo para incidencias. */
  note?: string | null;
  /**
   * El full donde vive la comanda, tal y como estaba al marcarla.
   *
   * Viaja con el registro y no se decide al subir: entre que se marca una
   * entrega y que sube puede pasar un rato —sin cobertura, o con la cola
   * atascada— y en ese rato el transportista puede haber cambiado de full.
   * Escribir en el que esté abierto en ese momento manda la entrega a una
   * pestaña donde esa comanda no existe, y se pierde.
   *
   * Opcional porque los registros que quedaran en la cola de una versión
   * anterior no lo llevan: esos se escriben en el full abierto, como antes.
   */
  sheetTab?: string | null;
  /** Importe cobrado, sin IVA. Solo en las entregas. */
  price?: number | null;
}

/**
 * Una factura ya emitida, tal y como queda registrada en la pestaña
 * "Factures" del Sheet.
 *
 * Guarda sus propias líneas (comandas e importes) y no solo una referencia a
 * los pedidos: una factura emitida no puede cambiar porque después se toque
 * una fila de la hoja. Reimprimirla tiene que dar exactamente el mismo papel.
 */
export interface FacturaEmitida {
  /** Correlativo dentro de la serie. Sin ceros: se formatean al imprimir. */
  numero: number;
  /** Fecha de emisión, YYYY-MM-DD. */
  fecha: string;
  /** Pestaña del Sheet que se facturó, que es el mes de trabajo. */
  periodo: string;
  /**
   * Código del cliente al que se le emitió. Vacío en las facturas anteriores
   * a que hubiera más de un cliente: entonces solo había uno.
   */
  client: string;
  /**
   * Por dónde va el cobro. Lo mueve a mano el transportista desde la app y
   * se guarda en la hoja, que es donde la oficina lo puede ver.
   */
  estat: EstatFactura;
  lineas: { comanda: string; importe: number }[];
  base: number;
  iva: number;
  irpf: number;
  total: number;
}

/** Datos públicos de un transportista. El PIN nunca sale del servidor. */
export interface Driver {
  id: string;
  name: string;
}
