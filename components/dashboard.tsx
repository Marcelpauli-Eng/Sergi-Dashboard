"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import dynamic from "next/dynamic";
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  Check,
  Clock,
  FileText,
  History,
  Menu,
  Route,
  RotateCw,
  Search,
  Settings,
  X,
  Pencil,
  TriangleAlert,
} from "lucide-react";
import { db } from "@/lib/db";
import RouteTrace from "@/components/route-trace";
import HomeSummary from "@/components/home-summary";
import Desfer, { MARGE_DESFER_MS, type AccioDesfer } from "@/components/desfer";
import EditarComanda from "@/components/editar-comanda";
import Endarrerides from "@/components/endarrerides";
import Sidebar from "@/components/sidebar";
import Previsualitzacio from "@/components/previsualitzacio";
import TabCalendari from "@/components/tabs/calendari";
import TabHistorial from "@/components/tabs/historial";

/*
  Las pantallas que no son "Avui" se bajan cuando se abren, no al arrancar.

  El transportista abre la app en la calle, con una raya de cobertura, y lo
  único que necesita para empezar es la lista de paradas. Facturar, los
  informes y los cobros son de fin de mes y de sofá: entre la maqueta de la
  factura, el generador de PDF y la comparativa de fulls se llevaban la mitad
  del JavaScript de la primera carga sin que nadie los hubiera pedido.

  `ssr: false` porque ninguna se pinta en el servidor: todas leen de
  IndexedDB o del documento privado.
*/
const Factures = dynamic(() => import("@/components/factures"), { ssr: false });
const Informes = dynamic(() => import("@/components/informes"), { ssr: false });
const Cobraments = dynamic(() => import("@/components/cobraments"), { ssr: false });
const Ajustos = dynamic(() => import("@/components/ajustos"), { ssr: false });
const Cercador = dynamic(() => import("@/components/cercador"), { ssr: false });
import { leerDatosFacturacion, sincronizarFacturacio } from "@/lib/ajustes-factura";
import { type DatosFacturacion } from "@/lib/factura";
import {
  recordDelivery,
  recordDateAssignment,
  recordPrice,
  syncNow,
  SessionExpiredError,
  getSelectedTab,
  setSelectedTab,
  getCustomOrder,
  getCustomOrderServer,
  setCustomOrder,
  applyCustomOrder,
  subscribeLocalPrefs,
} from "@/lib/sync";
import { formatDistance, formatDuration } from "@/lib/format";
import { obrirMaps } from "@/lib/maps";
import { formatLongDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { Stop } from "@/lib/types";
import { Button } from "@/components/ui/button";
import StopCard from "./stop-card";
import SyncBar from "./sync-bar";

// ── Connectivity hook ──────────────────────────────────────────────────

function subscribeToConnectivity(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// ── Status category types ──────────────────────────────────────────────

type StatusCategory = "pendent" | "en_curs" | "entregat" | "incidencia";

// ── Route generation types ─────────────────────────────────────────────

interface RouteResult {
  stops: Stop[];
  optimized: boolean;
  fullRouteUrl: string | null;
  /** La misma ruta, para abrir la APP de Google Maps. Ver lib/maps.ts. */
  appRouteUrl: string | null;
  totalDistanceMeters: number | null;
  totalDurationSeconds: number | null;
  /** Geometría del recorrido, para dibujar la traza. Ver components/route-trace.tsx. */
  encodedPolyline: string | null;
  /** Desde dónde se calculó: el GPS del transportista, o la nave. */
  start: { lat: number; lng: number } | null;
}

// ── Helper Dates ───────────────────────────────────────────────────────


// ── Main Dashboard ─────────────────────────────────────────────────────

type TabValue =
  | "avui"
  | "calendari"
  | "historial"
  | "factures"
  | "cobraments"
  | "informes";

/** Las pestañas que en pantalla grande ocupan el alto entero sin scroll. */
const A_PANTALLA_SENCERA: TabValue[] = ["calendari"];

/**
 * Cada cuánto se vuelve a leer la hoja con la app delante.
 *
 * Veinte segundos es el equilibrio: lo que uno marca lo ve el otro casi al
 * momento, y sale a tres lecturas por minuto y móvil —de las sesenta por
 * minuto que da Google—, así que caben varios repartidores a la vez sin que
 * salte la cuota. Bajarlo multiplica el gasto por todos los dispositivos.
 */
const REFRESC_MS = 20_000;

/** Encabezado de cada sección en ordenador e iPad. */
const TITOLS: Record<TabValue, { titol: string; subtitol: string }> = {
  avui: { titol: "Avui", subtitol: "La ruta del dia i les parades pendents." },
  calendari: { titol: "Calendari", subtitol: "Assigna comandes als dies de repartiment." },
  historial: { titol: "Historial", subtitol: "Tot el que s'ha entregat i les incidències." },
  factures: { titol: "Factures", subtitol: "Factura el mes i consulta les emeses." },
  cobraments: { titol: "Cobraments", subtitol: "Quines factures estan cobrades i quines no." },
  informes: { titol: "Informes", subtitol: "Com va el mes: entregues, imports i incidències." },
};

export default function Dashboard({ driverName }: { driverName: string }) {
  const router = useRouter();

  const query = useLiveQuery(
    async () => ({ value: await db.manifest.get("current") }),
    [],
  );
  const loading = query === undefined;
  const stored = query?.value;

  const outbox = useLiveQuery(() => db.outbox.toArray(), []);
  const pendingCount = (outbox ?? []).filter((i) => i.syncedAt === null).length;

  const online = useSyncExternalStore(
    subscribeToConnectivity,
    () => navigator.onLine,
    () => true,
  );
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Navegación principal ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabValue>("avui");

  // ── Menú hamburguesa & selector de pestaña de Sheets ──────────────────
  const [menuOpen, setMenuOpen] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  // Se leen del store de preferencias en vez de copiarlas al estado desde un
  // efecto: localStorage no existe durante el render de servidor, y
  // useSyncExternalStore resuelve justo ese caso sin renders en cascada.
  const selectedSheetTab = useSyncExternalStore(
    subscribeLocalPrefs,
    getSelectedTab,
    () => null,
  );
  const [loadingTabs, setLoadingTabs] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  // Inicialización perezosa: en el servidor `leerDatosFacturacion` devuelve
  // los valores de partida y en el cliente los guardados. No hay riesgo de
  // desajuste al hidratar porque esto no se pinta hasta que se abre la
  // factura o los ajustes.
  const [datosFactura, setDatosFactura] = useState<DatosFacturacion>(leerDatosFacturacion);

  /*
    El emisor y los clientes se bajan del documento privado al arrancar.

    Vivían solo en este móvil, así que cambiar de teléfono perdía el NIF y la
    dirección —tanto de quien factura como de a quién—, y dos dispositivos
    podían tener datos distintos sin que nadie lo notara. Ahora manda el
    documento; lo de aquí es la copia para poder facturar sin cobertura, y si
    no hay red se sigue con ella tal cual.
  */
  useEffect(() => {
    void (async () => {
      setDatosFactura(await sincronizarFacturacio(leerDatosFacturacion()));
    })();
  }, []);
  // ── Orden personalizado (drag & drop) ─────────────────────────────────
  const customOrderIds = useSyncExternalStore(
    subscribeLocalPrefs,
    getCustomOrder,
    getCustomOrderServer,
  );
  const [isManualOrder, setIsManualOrder] = useState(false);

  // ── Ruta bajo demanda ─────────────────────────────────────────────────
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [generatingRoute, setGeneratingRoute] = useState(false);
  /** Comandas de hoy sin dirección, mientras se decide qué hacer con ellas. */
  const [senseAdrecaIds, setSenseAdrecaIds] = useState<string[]>([]);
  /** La que se está completando desde ese aviso. */
  const [afegintAdrecaId, setAfegintAdrecaId] = useState<string | null>(null);

  // ── Buscador global (⌘K) ──────────────────────────────────────────────
  const [cercantObert, setCercantObert] = useState(false);
  /**
   * La comanda abierta desde el buscador, POR SU ID y no por una copia.
   *
   * Guardar el objeto congelaba lo que se veía: al corregir el importe la
   * ficha seguía enseñando el anterior, porque el que estaba pintado era una
   * copia de antes del cambio. Con el id se vuelve a buscar en cada render y
   * enseña siempre lo que hay.
   */
  const [comandaObertaId, setComandaObertaId] = useState<string | null>(null);

  // ── Desfer ────────────────────────────────────────────────────────────
  const [accioDesfer, setAccioDesfer] = useState<AccioDesfer | null>(null);

  /**
   * El aviso de comandas de días pasados se puede apartar.
   *
   * Una vez por sesión y no por comanda: si se aparta es porque ahora no
   * toca, no porque una en concreto esté bien. Vuelve a salir a la próxima
   * que se abra la app, y desaparece solo en cuanto no queda ninguna.
   */
  const [avisEndarreridesTancat, setAvisEndarreridesTancat] = useState(false);

  const fetchTabs = useCallback(async () => {
    if (tabs.length > 0) return;
    setLoadingTabs(true);
    try {
      const res = await fetch("/api/sheets/tabs");
      if (res.ok) {
        const data = (await res.json()) as { tabs: string[] };
        setTabs(data.tabs);
      }
    } catch {
      // Silenciar si no hay red
    } finally {
      setLoadingTabs(false);
    }
  }, [tabs.length]);

  // En pantalla grande el selector de fulls vive en la barra lateral, así
  // que la lista hace falta desde el primer pintado y no solo al abrir el
  // menú ☰. `fetchTabs` ya se guarda de pedirla dos veces.
  useEffect(() => {
    // Aplazada un tick, como el primer `sync`: pedirla dentro del cuerpo del
    // efecto encadenaría un render de más nada más montar.
    const t = setTimeout(() => void fetchTabs(), 0);
    return () => clearTimeout(t);
  }, [fetchTabs]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      // ⌘K en Mac, Ctrl+K en el resto. Es el atajo que ya tiene todo el
      // mundo en los dedos de otras aplicaciones.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCercantObert((v) => !v);
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  const handleTabSelect = useCallback(
    async (tab: string) => {
      setSelectedTab(tab);
      setMenuOpen(false);
      setRouteResult(null); // Reset route on tab change
      setSyncing(true);
      setError(null);
      try {
        const outcome = await syncNow(tab);
        setError(outcome.error);
      } catch (e) {
        if (e instanceof SessionExpiredError) {
          router.replace("/login");
          return;
        }
        setError(e instanceof Error ? e.message : "Error de sincronización");
      } finally {
        setSyncing(false);
      }
    },
    [router],
  );

  /**
   * Sube lo pendiente y vuelve a bajar la hoja.
   *
   * `silenciós` es para el refresco de fondo: hace lo mismo pero sin
   * encender el "Sincronizando…" de la barra. Un parpadeo cada veinte
   * segundos acaba leyéndose como que algo va mal.
   */
  const sync = useCallback(
    async (silenciós = false) => {
      if (!silenciós) setSyncing(true);
      setError(null);
      try {
        const outcome = await syncNow(selectedSheetTab ?? undefined);
        setError(outcome.error);
      } catch (e) {
        if (e instanceof SessionExpiredError) {
          router.replace("/login");
          return;
        }
        setError(e instanceof Error ? e.message : "Error de sincronización");
      } finally {
        if (!silenciós) setSyncing(false);
      }
    },
    [router, selectedSheetTab],
  );

  useEffect(() => {
    const initial = setTimeout(() => void sync(), 0);
    const onOnline = () => void sync();
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void sync();
    };

    /*
      Con la app delante, se vuelve a preguntar cada poco.

      Dos móviles sobre la misma hoja —el del transportista y el de la
      oficina, o dos repartidores— tienen que ver lo que hace el otro sin que
      nadie le dé a Actualizar. Google no avisa de que una casilla ha
      cambiado: la única manera de enterarse es volver a leer.

      Solo con la pantalla visible y con red. En segundo plano no hay nadie
      mirando, y cada vuelta cuesta una lectura de la cuota de Sheets.

      ponytail: sondeo, no empuje. Para que un cambio salte en el acto haría
      falta que el servidor mantuviera la conexión abierta (SSE) y un sitio
      donde anotar los cambios, que hoy no existe: la verdad está en el
      Sheet. Si medio minuto de retraso llega a molestar, ese es el camino.
    */
    const refresc = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void sync(true);
      }
    }, REFRESC_MS);

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(initial);
      clearInterval(refresc);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sync]);

  /**
   * Cualquier cambio se sube y se vuelve a bajar solo.
   *
   * Todo lo que se toca —entregar, corregir un importe, mover un día— deja
   * algo en la cola, así que basta con mirarla: en cuanto para la mano se
   * sincroniza. Sin esto el cambio se veía en este móvil pero las hojas y
   * las pantallas que leen del servidor (la comparativa, las facturas) se
   * quedaban con lo de antes hasta que alguien le daba a Actualizar.
   *
   * El respiro es para no salir corriendo con cada tecla al corregir varios
   * importes seguidos. Si falla —sin cobertura— no reintenta desde aquí: de
   * eso ya se encargan el evento `online` y el volver a la pestaña.
   */
  useEffect(() => {
    if (pendingCount === 0) return;
    const id = setTimeout(() => void sync(), 800);
    return () => clearTimeout(id);
  }, [pendingCount, sync]);

  const manifest = stored?.data;
  // En un useMemo porque el `?? []` creaba un array nuevo en cada render, y
  // de él cuelgan la clasificación, el buscador y la comanda abierta: sin
  // esto se recalculaba todo cada vez que se pintaba cualquier cosa.
  const allStops = useMemo(
    () => manifest?.today?.stops ?? [],
    [manifest],
  ); // manifest.today.stops son TODAS las comandas del full
  const todayDate = manifest?.today?.date ?? ""; // The "today" date on the server
  // Un manifiesto guardado por una versión anterior no trae la lista.
  const origens = useMemo(() => manifest?.origens ?? [], [manifest]);

  // Clasificación de todos los pedidos
  const {
    todayStops,
    unassignedStops,
    calendarStopsByDate,
    historyStops,
    endarrerides,
  } = useMemo(() => {
    const todayStops: Stop[] = [];
    const unassignedStops: Stop[] = [];
    /*
      Las que se quedaron en un día que ya pasó sin cerrar.

      No salían por ningún sitio: en Avui solo están las de hoy, y en la
      bossa solo las que no tienen día. Se quedaban escondidas en su casilla
      del calendario hasta que alguien se acordaba de mirar atrás.
    */
    const endarrerides: Stop[] = [];
    const historyStops: { entregat: Stop[]; incidencia: Stop[] } = {
      entregat: [],
      incidencia: [],
    };
    const calendarStopsByDate: Record<string, Stop[]> = {};

    for (const stop of allStops) {
      const cat = (stop.statusCategory ?? "pendent") as StatusCategory;
      const tancada = cat === "entregat" || cat === "incidencia";

      if (cat === "entregat") historyStops.entregat.push(stop);
      if (cat === "incidencia") historyStops.incidencia.push(stop);

      /*
        Al calendario va TODO lo que tiene día, entregado incluido.

        Antes solo iban las pendientes y el día que acababas se quedaba en
        blanco, como si no hubieras hecho nada. Lo que uno quiere ver al
        mirar atrás es precisamente lo que hizo — y con la fecha que tiene
        una comanda entregada, que es la del día en que se entregó.
      */
      if (!stop.date) {
        if (!tancada) unassignedStops.push(stop);
        continue;
      }

      if (!calendarStopsByDate[stop.date]) calendarStopsByDate[stop.date] = [];
      calendarStopsByDate[stop.date].push(stop);

      if (tancada) continue;

      if (stop.date === todayDate) {
        todayStops.push(stop);
      } else if (todayDate && stop.date < todayDate) {
        endarrerides.push(stop);
      }
    }

    // Ordenar los de hoy con el orden personalizado
    const orderedToday = applyCustomOrder(todayStops, customOrderIds);

    return {
      todayStops: orderedToday,
      unassignedStops,
      calendarStopsByDate,
      historyStops,
      // De la más antigua a la más reciente: se cierran en el orden en que
      // se quedaron atrás.
      endarrerides: endarrerides.sort((a, b) => a.date.localeCompare(b.date)),
    };
  }, [allStops, customOrderIds, todayDate]);

  const generateRoute = useCallback(async (
    excloure: string[] = [],
    /*
      Las que se acaban de completar desde el aviso.

      Hacen falta porque lo que se ve en pantalla sale de lo descargado, y
      justo después de escribir la dirección en la hoja esta copia todavía
      dice que no la tiene: sin esto, el aviso volvería a saltar por la
      misma comanda que se acaba de arreglar. Al servidor le da igual —él
      relee la hoja— así que basta con no volver a preguntar por ellas.
    */
    jaResoltes: string[] = [],
  ) => {
    // Only generate route for "pendents" in today's active stops
    const routeable = todayStops.filter(
      (s) => s.statusCategory === "pendent" && !excloure.includes(s.id),
    );
    if (routeable.length === 0) return;

    /*
      Una comanda sin dirección no se puede meter en la ruta: no hay a dónde
      ir. Pasa con las que se apuntan al vuelo, que solo llevan el número.

      No se calla ni se salta sin más: se pregunta. O se pone la dirección
      ahora —que es lo que suele faltar, y se sabe de memoria— o se hace la
      ruta sin ella, pero sabiendo que se queda fuera.
    */
    const senseAdreca = routeable.filter(
      (s) => s.address.trim() === "" && s.lat === null && !jaResoltes.includes(s.id),
    );
    if (senseAdreca.length > 0) {
      setSenseAdrecaIds(senseAdreca.map((s) => s.id));
      return;
    }
    setSenseAdrecaIds([]);
    setGeneratingRoute(true);

    // Obtener la ubicación actual
    let startLocation: { lat: number; lng: number } | undefined;
    try {
      startLocation = await new Promise((resolve) => {
        if (!navigator.geolocation) {
          resolve(undefined);
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          (err) => {
            console.warn("GPS no disponible:", err);
            resolve(undefined); // Continuar sin GPS (fallback a central)
          },
          { timeout: 5000, enableHighAccuracy: true }
        );
      });
    } catch (e) {
      console.warn("Error obteniendo ubicación:", e);
    }

    try {
      const res = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: routeable.map((s) => s.id),
          sheetTab: selectedSheetTab ?? undefined,
          startLocation,
          forceOrder: isManualOrder
        }),
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Error generando la ruta");
        return;
      }
      const result = (await res.json()) as RouteResult;
      setRouteResult(result);

      // Si el cálculo ha sido exitoso, podemos restablecer isManualOrder
      // ya que la nueva ruta ahora se convierte en la optimizada/calculada base.
      setIsManualOrder(false);

      // Actualizar el orden con el de la ruta optimizada (para todos los de hoy)
      const newIds = result.stops.map((s) => s.id);
      const nonRouteableIds = todayStops.filter(s => s.statusCategory !== "pendent").map(s => s.id);
      const combinedOrder = [...nonRouteableIds, ...newIds];

      setCustomOrder(combinedOrder);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error generando la ruta");
    } finally {
      setGeneratingRoute(false);
    }
  }, [todayStops, selectedSheetTab, router, isManualOrder]);

  /**
   * Guarda cómo estaba una comanda antes de tocarla, para poder devolverla.
   *
   * Se captura ANTES de escribir, mirando lo que hay ahora en pantalla: una
   * vez enviado el registro, el estado anterior ya no está en ningún sitio.
   */
  const anotarDesfer = (etiqueta: string, fer: () => void) => {
    setAccioDesfer({ etiqueta, fer, quan: Date.now() });
  };

  const nomDe = (orderId: string) =>
    allStops.find((s) => s.id === orderId)?.customer || orderId;

  const comandaOberta = comandaObertaId
    ? (allStops.find((s) => s.id === comandaObertaId) ?? null)
    : null;

  /**
   * @param quan - Cuándo se entregó de verdad, en ISO. Sin esto, ahora. Solo
   *   lo pasa el aviso de comandas de días pasados: aquella entrega tiene su
   *   hora, y es la que tiene que quedar en el full.
   */
  const handleDelivered = (
    orderId: string,
    price: number | null = null,
    quan?: string,
  ) => {
    const abans = allStops.find((s) => s.id === orderId);
    void recordDelivery(orderId, "entregado", null, price, quan);
    // Poner un importe a una comanda ya entregada no es "entregarla": no
    // tiene nada que deshacer más allá del propio importe, y ofrecer Desfer
    // ahí solo confunde.
    if (abans && abans.statusCategory !== "entregat") {
      const preuAbans = abans.price;
      anotarDesfer(`${nomDe(orderId)} · entregada`, () =>
        recordDelivery(orderId, "pendiente", null, preuAbans),
      );
    }
  };
  /**
   * Corrige el importe de una comanda, sin tocar nada más.
   *
   * Distinto de `handleDelivered`: aquel marca la entrega y por tanto
   * reescribe la hora en el full. Cambiar un precio mal tecleado no puede
   * mover la hora a la que se entregó de verdad.
   */
  const handleImporte = (orderId: string, importe: number | null) => {
    void recordPrice(orderId, importe);
  };

  const handleIncident = (orderId: string, note: string) => {
    const abans = allStops.find((s) => s.id === orderId);
    const preuAbans = abans?.price ?? null;
    void recordDelivery(orderId, "incidencia", note || null);
    anotarDesfer(`${nomDe(orderId)} · incidència`, () =>
      recordDelivery(orderId, "pendiente", null, preuAbans),
    );
  };

  /**
   * Deshace una entrega marcada por error.
   *
   * La comanda vuelve a estar pendiente, conservando el importe que tuviera
   * para no perder un dato que se tecleó bien. Ofrece «Desfer» para
   * re-entregarla si resulta que el clic en «Treure com entregada» fue el
   * error de verdad.
   */
  const handleUndeliver = (orderId: string) => {
    const abans = allStops.find((s) => s.id === orderId);
    const preuAbans = abans?.price ?? null;
    void recordDelivery(orderId, "pendiente", null, preuAbans);
    anotarDesfer(`${nomDe(orderId)} · treta com entregada`, () =>
      recordDelivery(orderId, "entregado", null, preuAbans),
    );
  };
  const handleDateAssignment = (orderId: string, newDate: string | null) => {
    // Un día que ya ha pasado no admite pedidos nuevos: planificar hacia
    // atrás no significa nada. Quitar sí se permite (newDate === null), que
    // es como se saca un pedido que se quedó sin entregar para llevarlo a
    // otro día. El guardia va aquí, en el handler, y no solo en la pantalla,
    // para que valga sea cual sea la vía por la que se asigne.
    if (newDate !== null && todayDate && newDate < todayDate) return;
    const dataAbans = allStops.find((s) => s.id === orderId)?.date || null;
    void recordDateAssignment(orderId, newDate);
    anotarDesfer(
      newDate
        ? `${nomDe(orderId)} · al ${newDate.split("-").reverse().join("/")}`
        : `${nomDe(orderId)} · treta del dia`,
      () => recordDateAssignment(orderId, dataAbans),
    );
  };

  // El aviso se retira solo pasado el margen. El temporizador vive aquí y no
  // dentro del aviso para que cambiar de pestaña no lo reinicie.
  useEffect(() => {
    if (!accioDesfer) return;
    const id = setTimeout(() => setAccioDesfer(null), MARGE_DESFER_MS);
    return () => clearTimeout(id);
  }, [accioDesfer]);

  /**
   * Cambiar de pantalla retira el aviso de Desfer.
   *
   * Se refiere a algo que ya no estás viendo, y encima se quedaba flotando
   * por encima de los botones de la factura. Todas las vías de navegación
   * pasan por aquí para que no se escape ninguna.
   */
  const anarA = (seccion: TabValue) => {
    setActiveTab(seccion);
    setAccioDesfer(null);
  };

  const pantallaSencera = A_PANTALLA_SENCERA.includes(activeTab);

  return (
    // En el móvil scrollea la ventana entera, como toda la vida. A partir de
    // `lg` la ventana se queda quieta y lo que scrollea es el contenido: la
    // barra lateral y la cabecera no se mueven, y una pantalla como el
    // calendario puede pedir el alto que le queda y caber entera.
    <div className="lg:flex lg:h-svh lg:overflow-hidden">
      <Sidebar
        activa={activeTab}
        onSeccio={(seccion) => {
          anarA(seccion);
          setSettingsOpen(false);
        }}
        driverName={driverName}
        full={selectedSheetTab || manifest?.sheetTab || ""}
        fulls={tabs}
        onFull={(full) => void handleTabSelect(full)}
        onCercar={() => setCercantObert(true)}
        onAjustos={() => setSettingsOpen(true)}
      />

      <div className="mx-auto flex min-h-svh w-full max-w-2xl flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] lg:mx-0 lg:h-svh lg:min-h-0 lg:max-w-none lg:overflow-hidden lg:pb-0">
      {manifest?.demo && (
        // Texto negro sobre el naranja del sistema: en blanco no hay
        // contraste suficiente y este aviso tiene que leerse sí o sí.
        <p className="bg-warning px-4 py-1 text-center text-xs font-semibold text-black">
          Modo demo · pedidos de ejemplo
        </p>
      )}

      {/* Franja de arriba. En el móvil lleva el nombre y los botones; a partir
          de `lg` es la barra del escritorio: sección a la izquierda, día y
          full a la derecha. */}
      <header className="sticky top-0 z-20 bg-background pt-[env(safe-area-inset-top)] lg:border-b lg:border-border">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 lg:px-8 lg:py-3">
          {/* `lg:contents` disuelve esta caja en pantalla grande: sus hijos
              pasan a ser celdas de la franja y el día se va a la derecha. */}
          <div className="min-w-0 lg:contents">
            {/* El nombre ya está abajo del todo en la barra lateral: en
                pantalla grande la franja lleva la sección donde estás. */}
            <h1 className="truncate text-lg font-semibold lg:hidden">{driverName}</h1>
            <div className="hidden min-w-0 lg:block">
              <h1 className="truncate text-lg font-semibold">{TITOLS[activeTab].titol}</h1>
              <p className="truncate text-sm text-muted-foreground">
                {TITOLS[activeTab].subtitol}
              </p>
            </div>
            <div className="flex items-center gap-1.5 lg:ml-auto">
              {todayDate && (
                <p className="text-xs text-muted-foreground first-letter:uppercase">
                  {formatLongDate(todayDate)}
                </p>
              )}
              {(selectedSheetTab || manifest?.sheetTab) && (
                <>
                  {todayDate && <span className="text-tertiary-foreground" aria-hidden>·</span>}
                  <p className="truncate text-xs text-muted-foreground">
                    {selectedSheetTab || manifest?.sheetTab}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => setCercantObert(true)}
              className="pressable flex size-9 items-center justify-center rounded-full bg-muted text-primary"
              aria-label="Cercar comandes"
            >
              <Search className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="pressable flex size-9 items-center justify-center rounded-full bg-muted text-primary lg:hidden"
              aria-label="Ajustos"
            >
              <Settings className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen((v) => !v);
                if (!menuOpen) void fetchTabs();
              }}
              className="pressable flex size-9 items-center justify-center rounded-full bg-muted text-primary lg:hidden"
              aria-label="Menú"
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        {/* En el ordenador la franja no lleva estado ni botón de actualizar:
            se sincroniza solo al abrir y al volver a la pestaña. Si hay algo
            que contar (error, sin conexión, pendientes) sí sale. El ratón es
            lo que distingue ordenador de iPad, no el ancho: el iPad ya usa
            esta misma barra lateral. */}
        <div
          className={cn(
            online && !error && pendingCount === 0 && "pointer-fine:hidden",
          )}
        >
          <SyncBar
            online={online}
            syncing={syncing}
            savedAt={stored?.savedAt ?? null}
            pendingCount={pendingCount}
            error={error}
            onSync={() => void sync()}
          />
        </div>
      </header>

      {/* ── Panel del menú hamburguesa ────────────────────────────────── */}
      {menuOpen && (
        <div className="material sticky top-[calc(env(safe-area-inset-top)+3.9rem)] z-10 animate-fade-in px-4 py-4">
          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-tertiary-foreground">
            Full
          </p>
          {loadingTabs ? (
            /* Tres siluetas del alto de una fila en vez de un texto: el panel
               no da un salto de alto cuando llega la lista. */
            <div className="soft-card divide-y divide-border overflow-hidden">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex h-12 items-center px-3.5">
                  <div className="h-3.5 w-32 animate-pulse rounded-full bg-muted" />
                </div>
              ))}
            </div>
          ) : tabs.length === 0 ? (
            <div className="soft-card px-3.5 py-4 text-center">
              <p className="text-sm text-muted-foreground">
                {online
                  ? "No s'han pogut carregar els fulls"
                  : "Sense connexió: no es pot llegir la llista de fulls"}
              </p>
              {online && (
                <button
                  type="button"
                  onClick={() => void fetchTabs()}
                  className="pressable mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary"
                >
                  <RotateCw className="size-4" />
                  Torna-ho a provar
                </button>
              )}
            </div>
          ) : (
            /* Doce fulls no caben en una pantalla de móvil: la lista se queda
               en poco más de media y el resto se hace con el dedo. */
            <ul className="soft-card max-h-[52svh] divide-y divide-border overflow-y-auto overscroll-contain">
              {tabs.map((tab) => {
                const isActive =
                  tab === selectedSheetTab ||
                  (!selectedSheetTab && tab === manifest?.sheetTab);
                return (
                  <li key={tab}>
                    <button
                      type="button"
                      onClick={() => void handleTabSelect(tab)}
                      aria-current={isActive ? "true" : undefined}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-muted"
                    >
                      <CalendarRange
                        className={cn(
                          "size-5 shrink-0",
                          isActive ? "text-primary" : "text-tertiary-foreground",
                        )}
                        strokeWidth={isActive ? 2.2 : 1.8}
                      />
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-[15px]",
                          isActive ? "font-semibold text-primary" : "font-medium",
                        )}
                      >
                        {tab}
                      </span>
                      {isActive && <Check className="size-4 shrink-0 text-primary" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Ajustes: una página con apartados, no un panel. */}
      {settingsOpen && (
        <Ajustos
          driverName={driverName}
          datosFactura={datosFactura}
          onDatosFactura={setDatosFactura}
          onTancar={() => setSettingsOpen(false)}
        />
      )}

      <main className="flex-1 lg:min-h-0 lg:overflow-hidden">
      <div
        className={cn(
          "mx-auto w-full px-4 py-5 lg:max-w-[100rem] lg:px-8 lg:py-6",
          pantallaSencera
            ? "lg:flex lg:h-full lg:flex-col lg:overflow-hidden"
            : "lg:h-full lg:overflow-y-auto",
        )}
      >
        <div className={cn(pantallaSencera && "lg:min-h-0 lg:flex-1")}>
        {loading ? (
          <p className="py-16 text-center text-base text-muted-foreground">Cargando…</p>
        ) : !manifest ? (
          <EmptyState online={online} syncing={syncing} />
        ) : (
          <>
            {activeTab === "avui" && (
              <TabAvui
                todayStops={todayStops}
                sensAssignar={unassignedStops.length}
                entregats={historyStops.entregat}
                incidencies={historyStops.incidencia}
                avui={todayDate}
                onIr={anarA}
                routeResult={routeResult}
                generatingRoute={generatingRoute}
                online={online}
                onGenerateRoute={generateRoute}
                onDelivered={handleDelivered}
                onIncident={handleIncident}
                setRouteResult={setRouteResult}
                setIsManualOrder={setIsManualOrder}
              />
            )}
            {activeTab === "calendari" && (
              <TabCalendari
                todayDate={todayDate}
                origens={origens}
                unassignedStops={unassignedStops}
                calendarStopsByDate={calendarStopsByDate}
                onAssignDate={handleDateAssignment}
                onImporte={handleImporte}
                onDelivered={handleDelivered}
                onIncident={handleIncident}
              />
            )}
            {activeTab === "historial" && (
              <TabHistorial
                historyStops={historyStops}
                origens={origens}
                mes={selectedSheetTab || manifest?.sheetTab || ""}
                onDelivered={handleDelivered}
                onIncident={handleIncident}
                onImporte={handleImporte}
                onUndeliver={handleUndeliver}
              />
            )}
            {activeTab === "factures" && (
              <Factures
                entregats={historyStops.entregat}
                origens={origens}
                mes={selectedSheetTab || manifest?.sheetTab || ""}
                datos={datosFactura}
                online={online}
                onImporte={handleImporte}
              />
            )}
            {activeTab === "cobraments" && (
              <Cobraments datos={datosFactura} online={online} />
            )}
            {activeTab === "informes" && (
              <Informes
                stops={allStops}
                mes={selectedSheetTab || manifest?.sheetTab || ""}
                fulls={tabs}
                online={online}
              />
            )}
          </>
        )}
        </div>
      </div>
      </main>

      {cercantObert && (
        <Cercador
          stops={allStops}
          onTancar={() => setCercantObert(false)}
          onObrir={(stop) => {
            setCercantObert(false);
            setComandaObertaId(stop.id);
          }}
        />
      )}

      {/* La comanda que se ha abierto desde el buscador, con sus acciones. */}
      {comandaOberta && (
        <Previsualitzacio onTancar={() => setComandaObertaId(null)}>
            <StopCard
              detall
              onImporte={handleImporte}
              stop={comandaOberta}
              onDelivered={(id, price) => {
                handleDelivered(id, price);
                setComandaObertaId(null);
              }}
              onIncident={(id, note) => {
                handleIncident(id, note);
                setComandaObertaId(null);
              }}
            />
        </Previsualitzacio>
      )}

      {endarrerides.length > 0 && !avisEndarreridesTancat && (
        <Endarrerides
          stops={endarrerides}
          onEntregada={(id, quan) => handleDelivered(id, null, quan)}
          onTornarABossa={(id) => handleDateAssignment(id, null)}
          onTancar={() => setAvisEndarreridesTancat(true)}
        />
      )}

      {/* ── Una comanda de la ruta no tiene dirección ──────────────────
          Dos salidas, y ninguna es seguir como si nada: o se pone la
          dirección ahora —que es lo que falta el 90 % de las veces, y se
          sabe— o se hace la ruta sin ella, pero dicho. */}
      {senseAdrecaIds.length > 0 && !afegintAdrecaId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sense-adreca-titol"
          className="fixed inset-0 z-[110] flex animate-fade-in items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
        >
          <div className="soft-card w-full max-w-md">
            <div className="flex items-start gap-3 p-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
                <TriangleAlert className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 id="sense-adreca-titol" className="text-lg font-semibold">
                  {senseAdrecaIds.length === 1
                    ? "Una comanda no té adreça"
                    : `${senseAdrecaIds.length} comandes no tenen adreça`}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Sense adreça no es poden posar a la ruta: no hi ha on anar.
                </p>
              </div>
            </div>

            <ul className="divide-y divide-border border-t border-border">
              {senseAdrecaIds.map((id) => {
                const stop = allStops.find((s) => s.id === id);
                return (
                  <li
                    key={id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {stop?.customer || id}
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {id}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setAfegintAdrecaId(id)}
                    >
                      <Pencil />
                      Afegir adreça
                    </Button>
                  </li>
                );
              })}
            </ul>

            <div className="flex gap-2 border-t border-border p-3">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => setSenseAdrecaIds([])}
              >
                Cancel·lar
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  const fora = senseAdrecaIds;
                  setSenseAdrecaIds([]);
                  void generateRoute(fora);
                }}
              >
                Fer la ruta sense{" "}
                {senseAdrecaIds.length === 1 ? "ella" : "elles"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Poner la dirección sin salir del aviso: al guardar, se relee la
          hoja y se vuelve a intentar la ruta con la comanda ya completa. */}
      {afegintAdrecaId && (
        <EditarComanda
          stop={allStops.find((s) => s.id === afegintAdrecaId)!}
          focus="address"
          onTancar={() => setAfegintAdrecaId(null)}
          onDesat={() => {
            const arreglada = afegintAdrecaId;
            setAfegintAdrecaId(null);
            setSenseAdrecaIds([]);
            void generateRoute([], [arreglada]);
          }}
        />
      )}

      <Desfer accio={accioDesfer} onTancar={() => setAccioDesfer(null)} />

      {/* ── Bottom Navigation ─────────────────────────────────────────── */}
      <nav className="material fixed bottom-0 left-0 right-0 z-20 mx-auto flex max-w-2xl border-t border-border pb-[env(safe-area-inset-bottom)] lg:hidden">
        {([
          ["avui", "Avui", Clock],
          ["calendari", "Calendari", CalendarDays],
          ["historial", "Historial", History],
          ["factures", "Factures", FileText],
          // Cobrar no está aquí: con seis pestañas la barra iba tan apretada
          // que los nombres no se leían. Se llega desde los accesos de Avui,
          // que es donde se va a mirar —una vez cada tantos días—, y en
          // pantalla grande sigue en la barra lateral.
          ["informes", "Informes", BarChart3],
        ] as [TabValue, string, typeof Clock][]).map(([id, label, Icona]) => (
          <button
            key={id}
            onClick={() => anarA(id)}
            className={cn(
              "pressable flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1 text-[10px] font-medium",
              activeTab === id ? "text-primary" : "text-tertiary-foreground",
            )}
          >
            <Icona className="size-6" strokeWidth={activeTab === id ? 2.3 : 1.8} />
            {label}
          </button>
        ))}
      </nav>
      </div>
    </div>
  );
}

// ── Tab: Avui ──────────────────────────────────────────────────────────

/**
 * La cruz de cerrar de las previsualizaciones.
 *
 * Flota por encima de la tarjeta, sobre el velo oscuro. Llevaba
 * `text-white` encima de un botón de fondo claro: un aspa blanca sobre un
 * círculo casi blanco, que en el móvil no se veía y había que adivinar
 * dónde tocar.
 *
 * Ahora es el mismo círculo que los botones de la cabecera —fondo claro y
 * aspa del color de la app—, con sombra para que se despegue del velo.
 * Una sola vez porque son cuatro diálogos con la misma cruz, y hasta ahora
 * era el mismo trozo copiado cuatro veces.
 */
function TabAvui({
  todayStops,
  sensAssignar,
  entregats,
  incidencies,
  avui,
  onIr,
  routeResult,
  generatingRoute,
  online,
  onGenerateRoute,
  onDelivered,
  onIncident,
  setRouteResult,
  setIsManualOrder,
}: {
  todayStops: Stop[];
  sensAssignar: number;
  /* Enteras y no contadas: el resumen separa lo de hoy del resto del full,
     y para eso necesita la fecha y el importe de cada una. */
  entregats: Stop[];
  incidencies: Stop[];
  avui: string;
  onIr: (destino: "calendari" | "historial" | "factures" | "cobraments") => void;
  routeResult: RouteResult | null;
  generatingRoute: boolean;
  online: boolean;
  onGenerateRoute: () => void;
  onDelivered: (id: string, price: number | null) => void;
  onIncident: (id: string, note: string) => void;
  setRouteResult: (res: RouteResult | null) => void;
  setIsManualOrder: (b: boolean) => void;
}) {
  const pendents = todayStops.filter((s) => s.statusCategory === "pendent");
  const enCurs = todayStops.filter((s) => s.statusCategory === "en_curs");

  const handleMoveUp = useCallback((index: number) => {
    if (index <= 0) return;
    const newOrder = [...todayStops];
    const [moved] = newOrder.splice(index, 1);
    newOrder.splice(index - 1, 0, moved);

    const newIds = newOrder.map((s) => s.id);
    setCustomOrder(newIds);
    setRouteResult(null);
    setIsManualOrder(true);
  }, [todayStops, setRouteResult, setIsManualOrder]);

  const handleMoveDown = useCallback((index: number) => {
    if (index >= todayStops.length - 1) return;
    const newOrder = [...todayStops];
    const [moved] = newOrder.splice(index, 1);
    newOrder.splice(index + 1, 0, moved);

    const newIds = newOrder.map((s) => s.id);
    setCustomOrder(newIds);
    setRouteResult(null);
    setIsManualOrder(true);
  }, [todayStops, setRouteResult, setIsManualOrder]);

  return (
    <>
      <div className="mb-6 animate-rise-in">
        <HomeSummary
          todayStops={todayStops}
          entregats={entregats}
          incidencies={incidencies}
          avui={avui}
          sensAssignar={sensAssignar}
          totalDistanceMeters={routeResult?.totalDistanceMeters ?? null}
          totalDurationSeconds={routeResult?.totalDurationSeconds ?? null}
          rutaCalculada={routeResult !== null}
          generandoRuta={generatingRoute}
          online={online}
          onGenerarRuta={() => void onGenerateRoute()}
          onIr={onIr}
        />
      </div>

      {todayStops.length === 0 && (
        <div className="animate-rise-in soft-card mb-6 px-6 py-10 text-center">
          <p className="text-base font-medium">No tens comandes programades per a avui</p>
          <p className="mt-1 text-sm text-muted-foreground">Ves al Calendari per assignar comandes al dia d&apos;avui.</p>
        </div>
      )}

      {/* La traza y el resumen de la ruta, una vez calculada. */}
      {routeResult && (
        <div className="mb-6 animate-rise-in">
          <RouteSummary
            route={routeResult}
            onRecalculate={onGenerateRoute}
            generating={generatingRoute}
          />
        </div>
      )}

      {enCurs.length > 0 && (
        <div className="mb-6 space-y-3">
          <h3 className="px-1 text-sm font-semibold text-status-en-curs">En curs</h3>
          <ul className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0 2xl:grid-cols-3">
            {enCurs.map((stop) => (
              <StopCard
                key={stop.id}
                stop={stop}
                onDelivered={onDelivered}
                onIncident={onIncident}
              />
            ))}
          </ul>
        </div>
      )}

      {pendents.length > 0 && (
        <div className="space-y-3">
          <h3 className="px-1 text-sm font-semibold text-status-pendent">Pendents</h3>
          <ul className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0 2xl:grid-cols-3">
            {todayStops.map((stop, index) => {
              if (stop.statusCategory !== "pendent") return null;

              // Calcular si es el primer o último pendiente
              const firstPendentIndex = todayStops.findIndex(s => s.statusCategory === "pendent");
              const lastPendentIndex = todayStops.findLastIndex(s => s.statusCategory === "pendent");

              return (
                <StopCard
                  key={stop.id}
                  stop={{
                    ...stop,
                    sequence: index + 1,
                    legDistanceMeters:
                      routeResult?.stops.find((s) => s.id === stop.id)?.legDistanceMeters ?? null,
                    legDurationSeconds:
                      routeResult?.stops.find((s) => s.id === stop.id)?.legDurationSeconds ?? null,
                  }}
                  onDelivered={onDelivered}
                  onIncident={onIncident}
                  reorderable
                  onMoveUp={() => handleMoveUp(index)}
                  onMoveDown={() => handleMoveDown(index)}
                  isFirst={index === firstPendentIndex}
                  isLast={index === lastPendentIndex}
                />
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

// ── Tab: Calendari ─────────────────────────────────────────────────────

/** Comandas escritas en una casilla del mes antes de resumir el resto. */
function RouteSummary({ route, onRecalculate, generating }: { route: RouteResult, onRecalculate?: () => void, generating?: boolean }) {
  const distance = formatDistance(route.totalDistanceMeters);
  const duration = formatDuration(route.totalDurationSeconds);

  return (
    <div className="soft-card overflow-hidden">
      <RouteTrace
        encodedPolyline={route.encodedPolyline}
        start={route.start}
        stops={route.stops}
      />
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            Ruta {route.optimized ? "optimitzada" : "ordre manual"}
          </p>
          <p className="mt-0.5 text-xl font-semibold">
            {[distance, duration].filter(Boolean).join(" · ") || "Calculada"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {(route.appRouteUrl || route.fullRouteUrl) && (
            /*
              Abre la APP de Google Maps, no la web.

              Con el enlace `https://` la app instalada en el móvil —que es
              una PWA— enseñaba el mapa dentro de un navegador: sin voz, sin
              modo coche y sin poder seguirla conduciendo. El esquema propio
              de la app sí salta a Google Maps de verdad, y si no estuviera
              instalada se vuelve a la web sola. Ver `obrirMaps`.
            */
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                obrirMaps(route.appRouteUrl ?? route.fullRouteUrl!, route.fullRouteUrl)
              }
            >
              <Route />
              Obrir Maps
            </Button>
          )}
          {onRecalculate && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRecalculate}
              disabled={generating}
            >
              {generating ? "Calculant…" : "Recalcular"}
            </Button>
          )}
        </div>
      </div>
      {!route.optimized && (
        <p className="mx-4 mb-4 -mt-1 rounded-lg bg-warning-surface px-3 py-2 text-sm text-warning-foreground">
          Ruta calculada respectant el teu ordre manual.
        </p>
      )}
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────

function EmptyState({ online, syncing }: { online: boolean; syncing: boolean }) {
  if (syncing) {
    return (
      <p className="py-16 text-center text-base text-muted-foreground">
        Descarregant…
      </p>
    );
  }

  return (
    <div className="animate-rise-in soft-card px-6 py-12 text-center">
      <p className="text-base font-medium">
        {online ? "Encara no hi ha dades" : "Sense dades descarregades"}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {online
          ? "Selecciona una fulla del menú ☰ i prem Actualitzar."
          : "Connecta't a internet una vegada per descarregar les dades."}
      </p>
    </div>
  );
}
