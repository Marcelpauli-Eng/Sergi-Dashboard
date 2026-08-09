import "server-only";
import { today, addDays } from "./dates";
import { navUrlFor, fullRouteUrlFor } from "./routing";
import type { DeliveryRecord, Manifest, RouteDay, Stop } from "./types";

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

export function recordDemoDeliveries(records: DeliveryRecord[]): void {
  for (const record of records) demoDeliveries.set(record.orderId, record);
}

export function resetDemoDeliveries(): void {
  demoDeliveries.clear();
}

interface Sample {
  id: string;
  customer: string;
  address: string;
  lat: number;
  lng: number;
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

const DEMO_DEPOT = "Carrer de Mallorca 401, 08013 Barcelona";

function toStop(sample: Sample, date: string, sequence: number): Stop {
  const recorded = demoDeliveries.get(sample.id);
  return {
    id: sample.id,
    driverId: DEMO_DRIVER.id,
    date,
    priority: sample.priority,
    customer: sample.customer,
    address: sample.address,
    city: null,
    phone: sample.phone ?? null,
    measures: null,
    notes: sample.notes ?? null,
    status: recorded?.status ?? "pendiente",
    rawStatus: recorded ? (recorded.status === "entregado" ? "Entregat" : "Incidència") : "",
    lat: sample.lat,
    lng: sample.lng,
    sequence,
    navUrl: navUrlFor(sample),
    legDistanceMeters: sample.legDistanceMeters ?? null,
    legDurationSeconds: sample.legDurationSeconds ?? null,
  };
}

function buildDay(samples: Sample[], date: string): RouteDay {
  const pending = samples.filter((s) => !demoDeliveries.has(s.id));
  const done = samples.filter((s) => demoDeliveries.has(s.id));

  const stops = [
    ...pending.map((sample, index) => toStop(sample, date, index + 1)),
    ...done.map((sample) => toStop(sample, date, 0)),
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

  return {
    driverId: DEMO_DRIVER.id,
    driverName: DEMO_DRIVER.name,
    generatedAt: new Date().toISOString(),
    demo: true,
    sheetTab: "Demo",
    today: buildDay(TODAY_SAMPLES, todayDate),
    tomorrow: buildDay(TOMORROW_SAMPLES, addDays(todayDate, 1)),
  };
}
