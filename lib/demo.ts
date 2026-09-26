import "server-only";
import { today, addDays, formatSheetTimestamp } from "./dates";
import { navUrlFor, fullRouteUrlFor } from "./routing";
import {
  DATOS_POR_DEFECTO,
  type ClienteFacturacion,
  type DatosFacturacion,
} from "./factura";
import type {
  EstatFactura,
  FacturaEmitida,
  DeliveryRecord,
  Manifest,
  RouteDay,
  Stop,
} from "./types";

/**
 * Modo demo: la app entera funcionando con datos inventados.
 *
 * Existe para poder ver y enseñar la interfaz **sin haber configurado nada
 * de Google**. Se activa con `DEMO_MODE=true` y, con eso solo, no hace falta
 * ninguna otra variable de entorno.
 *
 * Todo lo que se muestra lleva una franja "MODO DEMO" bien visible, para que
 * nadie confunda estos pedidos con los de verdad.
 */

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

/** Credenciales de acceso cuando no hay DRIVERS configurado. */
export const DEMO_DRIVER = {
  id: "demo",
  pin: "1234",
  name: "Transportista de prueba",
};

/**
 * Entregas marcadas durante la sesión de demo. En memoria a propósito: se
 * borran al reiniciar el servidor, que es justo lo que quieres al enseñar
 * la app varias veces seguidas.
 */
const demoDeliveries = new Map<string, DeliveryRecord>();

/**
 * A qué día se ha movido cada comanda durante la demo. `""` es la bossa.
 *
 * Aparte de las entregas porque son cosas distintas: cambiar de día no dice
 * nada de si se entregó. Guardarlo todo en el mismo sitio hacía que mover
 * una comanda —o sacarla del día para devolverla a la bossa— la enseñara
 * como una incidencia, porque el registro que llegaba no traía estado.
 */
const demoDates = new Map<string, string>();

/**
 * Las comandas creadas durante la demo. En memoria, como todo lo demás.
 *
 * Sin día: se crean tal cual, van a la bossa y desde allí se asignan, que es
 * el camino de verdad.
 */
const creadesDemo: Sample[] = [];

export function crearComandaDemo(dades: {
  id: string;
  customer?: string;
  address?: string;
  city?: string;
  phone?: string;
  notes?: string;
  afegirPart?: boolean;
  /** La bossa: "" la de siempre, "2" la del segundo documento. */
  origen?: string;
}): boolean {
  const totes = [...TODAY_SAMPLES, ...TOMORROW_SAMPLES, ...SEGON_SAMPLES, ...creadesDemo];
  // Con el prefijo del documento, como al leer la hoja de verdad.
  const base = dades.origen ? `${dades.origen}:${dades.id}` : dades.id;
  // Cuántas veces está ya ese número: la clave interna de la segunda parte
  // es "748#2", igual que al leer la hoja de verdad. Ver `construirComandes`.
  const partsJa = totes.filter((s) => s.id.split("#")[0] === base).length;
  if (partsJa > 0 && !dades.afegirPart) return false;

  const clau = partsJa > 0 ? `${base}#${partsJa + 1}` : base;

  creadesDemo.push({
    id: clau,
    customer: dades.customer ?? "",
    address: [dades.address, dades.city].filter(Boolean).join(", "),
    // Sin coordenadas, como una comanda recién creada de verdad: la hoja
    // no las trae y nadie las ha buscado todavía.
    lat: null,
    lng: null,
    priority: 99,
    phone: dades.phone,
    notes: dades.notes,
  });
  demoDates.set(clau, "");
  return true;
}

/** Corrige los datos de una comanda de la demo. `false` si no existe. */
export function actualitzarComandaDemo(
  id: string,
  dades: { customer?: string; address?: string; city?: string; phone?: string; notes?: string },
): boolean {
  const mostra = [...TODAY_SAMPLES, ...TOMORROW_SAMPLES, ...SEGON_SAMPLES, ...creadesDemo].find(
    (s) => s.id === id,
  );
  if (!mostra) return false;

  if (dades.customer !== undefined) mostra.customer = dades.customer;
  if (dades.phone !== undefined) mostra.phone = dades.phone;
  if (dades.notes !== undefined) mostra.notes = dades.notes;
  // En la demo la dirección y la población van juntas, como en las muestras.
  if (dades.address !== undefined || dades.city !== undefined) {
    mostra.address = [dades.address ?? mostra.address, dades.city]
      .filter(Boolean)
      .join(", ");
  }
  return true;
}

export function recordDemoDeliveries(records: DeliveryRecord[]): void {
  for (const record of records) {
    // Corregir el importe no cambia el estado ni la hora: solo el precio de
    // lo que ya hubiera registrado.
    if (record.type === "price") {
      const previo = demoDeliveries.get(record.orderId);
      if (previo) demoDeliveries.set(record.orderId, { ...previo, price: record.price });
      continue;
    }
    // Cambiar de día solo cambia el día. Vacío es la bossa, igual que en la
    // hoja de cálculo.
    if (record.type === "date") {
      demoDates.set(record.orderId, record.date ?? "");
      continue;
    }
    // Deshacer: la entrega desaparece del registro y la parada vuelve a
    // pendiente, que es exactamente lo que hace vaciar las celdas del Sheet.
    if (record.status === "pendiente") {
      demoDeliveries.delete(record.orderId);
      continue;
    }
    demoDeliveries.set(record.orderId, record);
  }
}

export function resetDemoDeliveries(): void {
  demoDeliveries.clear();
  demoDates.clear();
}

interface Sample {
  id: string;
  customer: string;
  address: string;
  /** `null` en las comandas creadas a mano: todavía no se han geocodificado. */
  lat: number | null;
  lng: number | null;
  priority: number;
  phone?: string;
  notes?: string;
  legDistanceMeters?: number;
  legDurationSeconds?: number;
}

const TODAY_SAMPLES: Sample[] = [
  {
    id: "ALB-1042",
    customer: "Farmàcia Sant Pau",
    address: "Carrer de Sant Antoni Maria Claret 167, 08025 Barcelona",
    lat: 41.4132,
    lng: 2.1744,
    priority: 1,
    phone: "+34 932 91 90 00",
    notes: "Entregar en recepción, preguntar por Marta",
    legDistanceMeters: 1200,
    legDurationSeconds: 360,
  },
  {
    id: "ALB-1043",
    customer: "Bar Elèctric",
    address: "Carrer de Girona 88, 08009 Barcelona",
    lat: 41.3958,
    lng: 2.1712,
    priority: 4,
    phone: "+34 933 01 22 41",
    legDistanceMeters: 2100,
    legDurationSeconds: 540,
  },
  {
    id: "ALB-1044",
    customer: "Òptica Diagonal",
    address: "Avinguda Diagonal 405, 08008 Barcelona",
    lat: 41.3969,
    lng: 2.1553,
    priority: 2,
    legDistanceMeters: 1650,
    legDurationSeconds: 480,
  },
  {
    id: "ALB-1045",
    customer: "Copisteria Aribau",
    address: "Carrer d'Aribau 132, 08036 Barcelona",
    lat: 41.3925,
    lng: 2.1533,
    priority: 6,
    phone: "+34 934 15 66 12",
    notes: "Cierra de 14:00 a 16:30",
    legDistanceMeters: 900,
    legDurationSeconds: 300,
  },
  {
    id: "ALB-1046",
    customer: "Forn Nou",
    address: "Carrer del Rosselló 210, 08008 Barcelona",
    lat: 41.3937,
    lng: 2.156,
    priority: 3,
    legDistanceMeters: 1400,
    legDurationSeconds: 420,
  },
];

const TOMORROW_SAMPLES: Sample[] = [
  {
    id: "ALB-1050",
    customer: "Clínica Verdi",
    address: "Carrer de Verdi 22, 08012 Barcelona",
    lat: 41.403,
    lng: 2.1568,
    priority: 1,
    phone: "+34 932 18 44 10",
  },
  {
    id: "ALB-1051",
    customer: "Llibreria Nollegiu",
    address: "Carrer de Pons i Subirà 3, 08003 Barcelona",
    lat: 41.3846,
    lng: 2.1836,
    priority: 2,
  },
];

/** Las del segundo documento, sin día: esperan en su propia bossa. */
const SEGON_SAMPLES: Sample[] = [
  {
    id: "2:P-310",
    customer: "Fusteria Vilalta",
    address: "Carrer de Pujades 77, 08005 Barcelona",
    lat: 41.3985,
    lng: 2.1949,
    priority: 2,
    phone: "+34 933 00 11 22",
  },
  {
    id: "2:P-311",
    customer: "Vidres Poblenou",
    address: "Carrer de Llull 140, 08005 Barcelona",
    lat: 41.4004,
    lng: 2.1985,
    priority: 3,
  },
];

const DEMO_DEPOT = "Carrer de Mallorca 401, 08013 Barcelona";

/**
 * `parts` es cuántas partes tiene la comanda en total, y eso solo se sabe
 * mirando todas las del día: por eso entra de fuera y no se calcula aquí.
 */
function toStop(
  sample: Sample,
  date: string,
  sequence: number,
  timezone: string,
  parts = 1,
): Stop {
  const recorded = demoDeliveries.get(sample.id);
  // La clave de una segunda parte es "748#2", y la del segundo documento
  // "2:748"; el número de la comanda es lo de en medio, que es lo que se
  // enseña. Igual que al leer la hoja de verdad.
  const origen = sample.id.match(/^(\w+):/)?.[1] ?? "";
  const [codi, sufix] = sample.id.slice(origen ? origen.length + 1 : 0).split("#");
  return {
    id: sample.id,
    codi,
    origen,
    part: sufix ? Number(sufix) : 1,
    parts,
    driverId: DEMO_DRIVER.id,
    creationDate: null,
    // El día que se le haya puesto durante la demo manda sobre el del lote.
    date: demoDates.get(sample.id) ?? date,
    priority: sample.priority,
    customer: sample.customer,
    address: sample.address,
    city: null,
    billingClient: null,
    phone: sample.phone ?? null,
    measures: null,
    notes: sample.notes ?? null,
    // La hora sale del propio registro, igual que en la hoja de verdad: allí
    // es la que se escribe en la celda del día al marcar la entrega.
    deliveredTime: recorded
      ? formatSheetTimestamp(recorded.recordedAt, timezone).slice(-5)
      : null,
    incidentNote: recorded?.note ?? null,
    status: recorded?.status ?? "pendiente",
    rawStatus: recorded ? (recorded.status === "entregado" ? "Entregat" : "Incidència") : "",
    statusCategory: recorded 
      ? (recorded.status === "entregado" ? "entregat" : "incidencia")
      : "pendent",
    price: recorded?.price ?? null,
    lat: sample.lat,
    lng: sample.lng,
    // En la demo no se geocodifica nada: no se habla con Google.
    geoAddress: null,
    placeId: null,
    geoLevel: null,
    sequence,
    navUrl: navUrlFor(sample),
    legDistanceMeters: sample.legDistanceMeters ?? null,
    legDurationSeconds: sample.legDurationSeconds ?? null,
  };
}

function buildDay(samples: Sample[], date: string, timezone: string): RouteDay {
  const pending = samples.filter((s) => !demoDeliveries.has(s.id));
  const done = samples.filter((s) => demoDeliveries.has(s.id));

  /** Cuántas partes tiene cada comanda entre todas las del día. */
  const partsPerCodi = new Map<string, number>();
  for (const sample of samples) {
    const codi = sample.id.split("#")[0];
    partsPerCodi.set(codi, (partsPerCodi.get(codi) ?? 0) + 1);
  }
  const partsDe = (sample: Sample) => partsPerCodi.get(sample.id.split("#")[0]) ?? 1;

  const stops = [
    ...pending.map((sample, index) =>
      toStop(sample, date, index + 1, timezone, partsDe(sample)),
    ),
    ...done.map((sample) => toStop(sample, date, 0, timezone, partsDe(sample))),
  ];

  return {
    date,
    stops,
    optimized: true,
    fullRouteUrl: fullRouteUrlFor(DEMO_DEPOT, pending),
    totalDistanceMeters: pending.length > 0 ? 18_400 : null,
    totalDurationSeconds: pending.length > 0 ? 4_320 : null,
  };
}

/** El manifiesto de demostración, siempre fechado en el día de hoy. */
export function demoManifest(timezone: string): Manifest {
  const todayDate = today(timezone);
  const avui = buildDay([...TODAY_SAMPLES, ...creadesDemo], todayDate, timezone);
  const segon = buildDay(SEGON_SAMPLES, "", timezone);

  return {
    driverId: DEMO_DRIVER.id,
    driverName: DEMO_DRIVER.name,
    generatedAt: new Date().toISOString(),
    demo: true,
    sheetTab: "Demo",
    // La demo enseña las dos bosses, que es lo que hay que poder ver sin
    // configurar el segundo documento.
    origens: [
      { id: "", nom: "Full principal", sheetTab: "Demo" },
      { id: "2", nom: "Segon full", sheetTab: "Demo" },
    ],
    today: { ...avui, stops: [...avui.stops, ...segon.stops] },
    tomorrow: buildDay(TOMORROW_SAMPLES, addDays(todayDate, 1), timezone),
  };
}

/**
 * Facturas emitidas durante la sesión de demo. En memoria, como las entregas:
 * al reiniciar el servidor la serie vuelve a empezar, que es lo que se quiere
 * al enseñar la app varias veces seguidas.
 */
const facturasDemo: FacturaEmitida[] = [];

export function demoFacturas(): FacturaEmitida[] {
  return [...facturasDemo].sort((a, b) => b.numero - a.numero);
}

/**
 * Los clientes, en memoria: en demo no se toca ningún documento.
 *
 * Arranca con el de los datos de partida para que la pantalla de ajustes se
 * comporte igual que en real, donde la pestaña "Clients" ya trae uno.
 */
let clientsDemo: ClienteFacturacion[] = [...DATOS_POR_DEFECTO.clientes];

export function demoClients(): ClienteFacturacion[] {
  return clientsDemo;
}

export function guardarDemoClients(clients: ClienteFacturacion[]): void {
  clientsDemo = clients;
}

/** El emisor, también en memoria y arrancando por el de partida. */
let emissorDemo: DatosFacturacion["emisor"] = { ...DATOS_POR_DEFECTO.emisor };

export function demoEmissor(): DatosFacturacion["emisor"] {
  return emissorDemo;
}

export function guardarDemoEmissor(emissor: DatosFacturacion["emisor"]): void {
  emissorDemo = emissor;
}

export function emitirFacturaDemo(
  datos: Omit<FacturaEmitida, "numero"> & { primerNumero: number },
): FacturaEmitida {
  const numero =
    facturasDemo.length > 0
      ? Math.max(...facturasDemo.map((f) => f.numero)) + 1
      : datos.primerNumero;
  const factura: FacturaEmitida = { ...datos, numero };
  facturasDemo.push(factura);
  return factura;
}

/** Borra una factura de la demo. `false` si ese número no existe. */
export function esborrarFacturaDemo(numero: number): boolean {
  const i = facturasDemo.findIndex((f) => f.numero === numero);
  if (i === -1) return false;
  facturasDemo.splice(i, 1);
  return true;
}

export function actualizarEstadoFacturaDemo(
  numero: number,
  estat: EstatFactura,
): FacturaEmitida | null {
  const factura = facturasDemo.find((f) => f.numero === numero);
  if (!factura) return null;
  factura.estat = estat;
  return factura;
}
