"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowUpDown,
  BarChart3,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileText,
  History,
  Inbox,
  Menu,
  Phone,
  Route,
  RotateCw,
  Search,
  Settings,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";
import { db } from "@/lib/db";
import RouteTrace from "@/components/route-trace";
import HomeSummary from "@/components/home-summary";
import Factures from "@/components/factures";
import Informes from "@/components/informes";
import Cobraments from "@/components/cobraments";
import Cercador from "@/components/cercador";
import Desfer, { MARGE_DESFER_MS, type AccioDesfer } from "@/components/desfer";
import Endarrerides from "@/components/endarrerides";
import Ajustos from "@/components/ajustos";
import Sidebar from "@/components/sidebar";
import { leerDatosFacturacion, sincronizarClientes } from "@/lib/ajustes-factura";
import { euros, type DatosFacturacion } from "@/lib/factura";
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
  getThemePreference,
  getThemePreferenceServer,
} from "@/lib/sync";
import { formatDistance, formatDuration, telHref } from "@/lib/format";
import { addDays, formatLongDate, getMonthGrid, getWeekGrid, getYearMonth } from "@/lib/dates";
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
  totalDistanceMeters: number | null;
  totalDurationSeconds: number | null;
  /** Geometría del recorrido, para dibujar la traza. Ver components/route-trace.tsx. */
  encodedPolyline: string | null;
  /** Desde dónde se calculó: el GPS del transportista, o la nave. */
  start: { lat: number; lng: number } | null;
}

// ── Helper Dates ───────────────────────────────────────────────────────

const WEEKDAY_NAMES = ["Dl", "Dt", "Dc", "Dj", "Dv", "Ds", "Dg"];
const MONTH_NAMES = ["Gener", "Febrer", "Març", "Abril", "Maig", "Juny", "Juliol", "Agost", "Setembre", "Octubre", "Novembre", "Desembre"];

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

  // ── Ajustes: tema claro/oscuro ─────────────────────────────────────────
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Inicialización perezosa: en el servidor `leerDatosFacturacion` devuelve
  // los valores de partida y en el cliente los guardados. No hay riesgo de
  // desajuste al hidratar porque esto no se pinta hasta que se abre la
  // factura o los ajustes.
  const [datosFactura, setDatosFactura] = useState<DatosFacturacion>(leerDatosFacturacion);

  /*
    Los clientes se bajan del documento privado al arrancar.

    Vivían solo en este móvil, así que cambiar de teléfono perdía el NIF y la
    dirección de a quién se factura, y dos dispositivos podían tener datos
    distintos sin que nadie lo notara. Ahora manda el documento; lo de aquí
    es la copia para poder facturar sin cobertura, y si no hay red se sigue
    con ella tal cual.
  */
  useEffect(() => {
    void (async () => {
      setDatosFactura(await sincronizarClientes(leerDatosFacturacion()));
    })();
  }, []);
  const theme = useSyncExternalStore(
    subscribeLocalPrefs,
    getThemePreference,
    getThemePreferenceServer,
  );

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

  const generateRoute = useCallback(async () => {
    // Only generate route for "pendents" in today's active stops
    const routeable = todayStops.filter(s => s.statusCategory === "pendent");
    if (routeable.length === 0) return;
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
      <header className="warm-gradient sticky top-0 z-20 pt-[env(safe-area-inset-top)] lg:border-b lg:border-border">
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
          theme={theme}
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
                unassignedStops={unassignedStops}
                calendarStopsByDate={calendarStopsByDate}
                onAssignDate={handleDateAssignment}
              />
            )}
            {activeTab === "historial" && (
              <TabHistorial
                historyStops={historyStops}
                mes={selectedSheetTab || manifest?.sheetTab || ""}
                onDelivered={handleDelivered}
                onIncident={handleIncident}
                onImporte={handleImporte}
              />
            )}
            {activeTab === "factures" && (
              <Factures
                entregats={historyStops.entregat}
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
        <div
          className="fixed inset-0 z-[100] flex animate-fade-in items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setComandaObertaId(null)}
        >
          <div className="relative w-full max-w-md sm:max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="secondary"
              size="icon"
              className="absolute -top-12 right-0 rounded-full text-white"
              onClick={() => setComandaObertaId(null)}
              aria-label="Tancar"
            >
              <X />
            </Button>
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
          </div>
        </div>
      )}

      {endarrerides.length > 0 && !avisEndarreridesTancat && (
        <Endarrerides
          stops={endarrerides}
          onEntregada={(id, quan) => handleDelivered(id, null, quan)}
          onTornarABossa={(id) => handleDateAssignment(id, null)}
          onTancar={() => setAvisEndarreridesTancat(true)}
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
          ["cobraments", "Cobrar", Wallet],
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
  onIr: (destino: "calendari" | "historial" | "factures") => void;
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
const CHIPS_PER_DIA = 3;

/**
 * El color de una comanda en el calendario, por cómo acabó.
 *
 * Un día pasado lleno de comandas grises no dice nada; lo que se quiere ver
 * de un vistazo es qué se cerró y qué no. En un sitio solo porque el mes y
 * la semana pintan lo mismo.
 */
function classeChip(cat: Stop["statusCategory"]): string {
  if (cat === "entregat") {
    return "bg-[color-mix(in_srgb,var(--status-entregat)_16%,transparent)] text-status-entregat";
  }
  if (cat === "incidencia") {
    return "bg-[color-mix(in_srgb,var(--status-incidencia)_16%,transparent)] text-status-incidencia";
  }
  if (cat === "en_curs") {
    return "bg-[color-mix(in_srgb,var(--status-en-curs)_16%,transparent)] text-status-en-curs";
  }
  return "bg-muted text-foreground";
}

/**
 * El calendario del mes.
 *
 * En el móvil es lo de siempre: casillas con un punto, y al tocar un día se
 * abre ese día a pantalla completa. En ordenador es el MISMO componente con
 * el mes ocupando todo el alto disponible —sin scroll, que era la queja— y
 * el día abierto en una columna al lado en vez de tapando el mes. Las
 * comandas se arrastran de la bolsa a un día, o de un día a otro, con el
 * arrastre nativo del navegador: ni una dependencia más.
 */
function TabCalendari({
  todayDate,
  unassignedStops,
  calendarStopsByDate,
  onAssignDate,
}: {
  todayDate: string;
  unassignedStops: Stop[];
  calendarStopsByDate: Record<string, Stop[]>;
  onAssignDate: (orderId: string, date: string | null) => void;
}) {
  const avui = todayDate || new Date().toISOString().slice(0, 10);
  const [currentMonth, setCurrentMonth] = useState(() => getYearMonth(avui));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  /** Día sobre el que se está soltando una comanda. Solo para pintarlo. */
  const [sobreDia, setSobreDia] = useState<string | null>(null);
  /**
   * Mes o semana.
   *
   * El mes es para ver la carga de un vistazo; la semana es para repartir
   * trabajo, porque la casilla deja de tener sitio para tres comandas y pasa
   * a tenerlo para todas. Es la misma pantalla y los mismos gestos: cambia
   * cuántos días se ven a la vez.
   */
  const [vista, setVista] = useState<"mes" | "setmana">("mes");
  /** Cualquier día de la semana que se está viendo. */
  const [ancoraSetmana, setAncoraSetmana] = useState(avui);

  const grid = useMemo(() => getMonthGrid(currentMonth.year, currentMonth.month), [currentMonth.year, currentMonth.month]);
  const setmana = useMemo(() => getWeekGrid(ancoraSetmana), [ancoraSetmana]);

  const enrere = () => {
    if (vista === "setmana") {
      setAncoraSetmana((d) => addDays(d, -7));
      return;
    }
    setCurrentMonth(prev => {
      let m = prev.month - 1;
      let y = prev.year;
      if (m < 1) { m = 12; y--; }
      return { year: y, month: m };
    });
  };

  const endavant = () => {
    if (vista === "setmana") {
      setAncoraSetmana((d) => addDays(d, 7));
      return;
    }
    setCurrentMonth(prev => {
      let m = prev.month + 1;
      let y = prev.year;
      if (m > 12) { m = 1; y++; }
      return { year: y, month: m };
    });
  };

  /**
   * Título de la barra de navegación. El mes se separa del resto porque en
   * el móvil no cabe junto al conmutador: "24 – 30 Agost" se queda en
   * "24 – 30", que con el mes delante en la pantalla ya se entiende.
   */
  const titol =
    vista === "mes"
      ? MONTH_NAMES[currentMonth.month - 1]
      : `${setmana[0].slice(8).replace(/^0/, "")} – ${setmana[6].slice(8).replace(/^0/, "")}`;
  const titolCua =
    vista === "mes"
      ? ` ${currentMonth.year}`
      : ` ${MONTH_NAMES[getYearMonth(setmana[6]).month - 1]}`;

  /** Un día que ya pasó no admite comandas nuevas. */
  const esPassat = (date: string) => Boolean(todayDate) && date < todayDate;

  const assignades = selectedDate ? calendarStopsByDate[selectedDate] ?? [] : [];

  const soltar = (date: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setSobreDia(null);
    const id = e.dataTransfer.getData("text/plain");
    if (id && !esPassat(date)) onAssignDate(id, date);
  };

  /*
    Tocar un día abre su informe, y ocupa la pantalla entera.

    Antes se abría en una columna al lado del mes, que daba para una lista de
    nombres y poco más. Un día es lo que de verdad se consulta —qué se
    entregó, a qué hora, por cuánto, qué falló— y eso necesita sitio.
  */
  if (selectedDate) {
    return (
      <DiaDetall
        date={selectedDate}
        stops={assignades}
        todayDate={todayDate}
        unassignedStops={unassignedStops}
        onAssignDate={onAssignDate}
        onTancar={() => setSelectedDate(null)}
      />
    );
  }

  return (
    <div className="animate-fade-in lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-4">
      {/* ── El mes ─────────────────────────────────────────────────────── */}
      <div className="soft-card flex flex-col p-4 lg:min-h-0">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={enrere}
              aria-label={vista === "mes" ? "Mes anterior" : "Setmana anterior"}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={endavant}
              aria-label={vista === "mes" ? "Mes següent" : "Setmana següent"}
            >
              <ChevronRight />
            </Button>
          </div>

          <h2 className="min-w-0 truncate text-base font-semibold first-letter:uppercase lg:text-lg">
            {titol}
            <span className="hidden sm:inline">{titolCua}</span>
          </h2>

          {/* Conmutador de vista. Dos botones y un fondo: un `select` aquí
              escondería la opción que no está puesta, y es justo la que
              interesa que se vea. */}
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-muted p-0.5">
            {(["mes", "setmana"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setVista(v);
                  // Al pasar a la semana, la del día abierto; y al volver al
                  // mes, el mes de esa semana. Si no, cambiar de vista te
                  // dejaba mirando otra fecha distinta de la que mirabas.
                  if (v === "setmana") setAncoraSetmana(selectedDate || avui);
                  else setCurrentMonth(getYearMonth(selectedDate || ancoraSetmana));
                }}
                aria-pressed={vista === v}
                className={cn(
                  "pressable rounded-full px-3 py-1 text-xs font-medium capitalize",
                  vista === v ? "bg-card text-primary shadow-sm" : "text-muted-foreground",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {vista === "mes" && (
          <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-semibold text-tertiary-foreground lg:mb-1.5 lg:text-left lg:[&>div]:pl-2">
            {WEEKDAY_NAMES.map(d => <div key={d}>{d}</div>)}
          </div>
        )}

        {/*
          `auto-rows-fr` en vez de un número fijo de filas: hay meses de cinco
          semanas y meses de seis, y así las casillas se reparten el alto que
          quede sea cual sea el mes.
        */}
        {vista === "mes" ? (
        <div className="grid grid-cols-7 gap-y-1 lg:min-h-0 lg:flex-1 lg:auto-rows-fr lg:gap-1.5">
          {grid.map((date) => {
            const isToday = date === todayDate;
            const delDia = calendarStopsByDate[date] || [];
            const { month: dMonth } = getYearMonth(date);
            const isCurrentMonth = dMonth === currentMonth.month;
            const dayNum = date.split("-")[2].replace(/^0/, "");
            const bloquejat = esPassat(date);
            const fetesDelDia = delDia.filter(
              (s) => s.statusCategory === "entregat" || s.statusCategory === "incidencia",
            ).length;
            /** El día está hecho: no queda ninguna por cerrar. */
            const tancat = delDia.length > 0 && fetesDelDia === delDia.length;

            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                onDragOver={(e) => {
                  if (bloquejat) return;
                  e.preventDefault();
                  setSobreDia(date);
                }}
                onDragLeave={() => setSobreDia((d) => (d === date ? null : d))}
                onDrop={soltar(date)}
                aria-current={date === selectedDate ? "date" : undefined}
                aria-label={`${date.split("-").reverse().join("/")}${
                  delDia.length > 0
                    ? `, ${delDia.length} ${delDia.length === 1 ? "comanda" : "comandes"}`
                    : ""
                }`}
                className={cn(
                  "pressable relative flex aspect-square flex-col items-center justify-center gap-0.5",
                  // A partir de `lg` la casilla deja de ser un cuadradito con un
                  // punto y pasa a ser una celda con las comandas escritas.
                  "lg:aspect-auto lg:min-h-0 lg:items-stretch lg:justify-start lg:gap-1 lg:overflow-hidden lg:rounded-xl lg:border lg:border-border lg:p-1.5 lg:text-left",
                  !isCurrentMonth && "lg:opacity-45",
                  date === selectedDate && "lg:border-primary lg:bg-[color-mix(in_srgb,var(--primary)_6%,transparent)]",
                  sobreDia === date && "lg:border-primary lg:bg-[color-mix(in_srgb,var(--primary)_14%,transparent)]",
                  bloquejat && "lg:bg-muted/40",
                )}
              >
                <span className="flex items-center gap-1 lg:justify-between">
                  <span
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full text-sm lg:size-6 lg:text-[13px]",
                      !isCurrentMonth && "text-tertiary-foreground",
                      isToday && "bg-primary font-semibold text-primary-foreground",
                    )}
                  >
                    {dayNum}
                  </span>
                  {delDia.length > 0 && (
                    /*
                      Cerradas y total. Las comandas escritas en la casilla no
                      caben todas —y las cerradas son las últimas de la lista,
                      así que son las primeras en quedar detrás del "+N més"—,
                      con lo que este contador es lo único que dice cómo acabó
                      un día lleno.
                    */
                    <span
                      className={cn(
                        "hidden text-[11px] font-semibold tabular-nums lg:inline",
                        tancat ? "text-status-entregat" : "text-muted-foreground",
                      )}
                    >
                      {fetesDelDia > 0 ? `${fetesDelDia}/${delDia.length}` : delDia.length}
                    </span>
                  )}
                </span>

                {/* Móvil: un punto. Es todo lo que cabe — pero dice si el día
                    quedó cerrado, que es lo que se mira al repasar atrás. */}
                {delDia.length > 0 && (
                  <span
                    className={cn(
                      "size-1.5 rounded-full lg:hidden",
                      tancat
                        ? "bg-[color:var(--status-entregat)]"
                        : isToday
                          ? "bg-primary"
                          : "bg-muted-foreground",
                    )}
                    aria-hidden
                  />
                )}

                {/* Ordenador: las comandas, con nombre. */}
                <span className="hidden min-h-0 flex-1 flex-col gap-0.5 overflow-hidden lg:flex">
                  {delDia.slice(0, CHIPS_PER_DIA).map((stop) => (
                    <span
                      key={stop.id}
                      className={cn(
                        "truncate rounded-md px-1.5 py-0.5 text-[11px] leading-4",
                        classeChip(stop.statusCategory),
                      )}
                    >
                      {stop.statusCategory === "entregat" && "✓ "}
                      {stop.customer || stop.id}
                    </span>
                  ))}
                  {delDia.length > CHIPS_PER_DIA && (
                    <span className="px-1.5 text-[11px] leading-4 text-muted-foreground">
                      +{delDia.length - CHIPS_PER_DIA} més
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        ) : (
          /*
            La semana: un día por columna y TODAS sus comandas escritas, no
            tres. Es la vista para repartir trabajo — se ve de golpe qué día
            va cargado y qué día está vacío, y se arrastra de uno a otro.
            En el móvil las columnas se apilan, que es lo único que cabe.
          */
          <div className="grid grid-cols-1 gap-2 lg:min-h-0 lg:flex-1 lg:grid-cols-7 lg:gap-1.5">
            {setmana.map((date) => {
              const isToday = date === todayDate;
              const delDia = calendarStopsByDate[date] || [];
              const bloquejat = esPassat(date);
              const dayNum = date.split("-")[2].replace(/^0/, "");
              const diaSetmana = WEEKDAY_NAMES[setmana.indexOf(date)];

              return (
                <div
                  key={date}
                  onDragOver={(e) => {
                    if (bloquejat) return;
                    e.preventDefault();
                    setSobreDia(date);
                  }}
                  onDragLeave={() => setSobreDia((d) => (d === date ? null : d))}
                  onDrop={soltar(date)}
                  className={cn(
                    "flex flex-col overflow-hidden rounded-xl border border-border lg:min-h-0",
                    date === selectedDate && "border-primary",
                    sobreDia === date && "border-primary bg-[color-mix(in_srgb,var(--primary)_14%,transparent)]",
                    bloquejat && "bg-muted/40",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedDate(date)}
                    aria-current={date === selectedDate ? "date" : undefined}
                    className="pressable flex shrink-0 items-center gap-1.5 px-2 py-1.5 text-left"
                  >
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full text-[13px]",
                        isToday && "bg-primary font-semibold text-primary-foreground",
                      )}
                    >
                      {dayNum}
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-tertiary-foreground">
                      {diaSetmana}
                    </span>
                    {delDia.length > 0 && (
                      <span className="ml-auto text-[11px] font-semibold tabular-nums text-muted-foreground">
                        {delDia.length}
                      </span>
                    )}
                  </button>

                  {delDia.length === 0 ? (
                    <p className="px-2 pb-2 text-[11px] text-tertiary-foreground">
                      {bloquejat ? "Ja ha passat" : "Buit"}
                    </p>
                  ) : (
                    <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1.5 pb-1.5">
                      {delDia.map((stop) => (
                        <li
                          key={stop.id}
                          draggable={
                            stop.statusCategory !== "entregat" &&
                            stop.statusCategory !== "incidencia"
                          }
                          onDragStart={(e) => e.dataTransfer.setData("text/plain", stop.id)}
                          title={`${stop.customer || stop.id}${stop.city ? ` · ${stop.city}` : ""}`}
                          className={cn(
                            "truncate rounded-md px-1.5 py-1 text-[11px] leading-4 lg:cursor-grab lg:active:cursor-grabbing",
                            classeChip(stop.statusCategory),
                          )}
                        >
                          {stop.statusCategory === "entregat" && "✓ "}
                          {stop.customer || stop.id}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Columna de al lado: la bolsa ───────────────────────────────── */}
      <aside className="mt-6 flex flex-col gap-3 lg:mt-0 lg:min-h-0 lg:pt-0">
        <Bossa stops={unassignedStops} onAssign={null} />
      </aside>
    </div>
  );
}

// ── El informe de un día ───────────────────────────────────────────────

/**
 * Cómo fue un día.
 *
 * Se abre al tocar una casilla del calendario y ocupa la pantalla entera, no
 * una columna: lo que se quiere al mirar un día es lo que pasó, y eso son
 * números y una lista, no un panel estrecho al lado del mes.
 *
 * Lo que se enseña es lo que ayuda al día siguiente: cuánto se entregó y por
 * cuánto, a qué hora se empezó y se acabó, qué incidencias hubo y por qué, y
 * —lo más fácil de olvidar— cuántas entregas se quedaron sin importe, que es
 * dinero que no se va a facturar si nadie lo mira.
 */
function DiaDetall({
  date,
  stops,
  todayDate,
  unassignedStops,
  onAssignDate,
  onTancar,
}: {
  date: string;
  /** Todas las comandas de ese día, cerradas incluidas. */
  stops: Stop[];
  todayDate: string;
  unassignedStops: Stop[];
  onAssignDate: (orderId: string, date: string | null) => void;
  onTancar: () => void;
}) {
  const entregades = stops.filter((s) => s.statusCategory === "entregat");
  const incidencies = stops.filter((s) => s.statusCategory === "incidencia");
  const pendents = stops.filter(
    (s) => s.statusCategory !== "entregat" && s.statusCategory !== "incidencia",
  );

  const facturat = entregades.reduce((total, s) => total + (s.price ?? 0), 0);
  const senseImport = entregades.filter((s) => !s.price).length;

  // Sin hora van al final: son las que se marcaron desde otra versión de la
  // app o a mano en la hoja, y no se sabe cuándo.
  const fetes = [...entregades, ...incidencies].sort((a, b) =>
    (a.deliveredTime ?? "99:99").localeCompare(b.deliveredTime ?? "99:99"),
  );
  const hores = fetes.map((s) => s.deliveredTime).filter((h): h is string => Boolean(h));

  const passat = Boolean(todayDate) && date < todayDate;
  const esAvui = date === todayDate;
  // Un día vacío no necesita cuatro ceros: con decir que no hubo nada basta.
  const hiHaResum = stops.length > 0 && (fetes.length > 0 || passat);

  return (
    <div className="animate-fade-in space-y-4 pb-4 lg:h-full lg:overflow-y-auto">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onTancar} aria-label="Tornar al calendari">
          <ChevronLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold first-letter:uppercase">
            {formatLongDate(date)}
          </h2>
          <p className="text-xs text-muted-foreground">
            {esAvui ? "Avui · " : passat ? "Ja ha passat · " : ""}
            {stops.length} {stops.length === 1 ? "comanda" : "comandes"}
          </p>
        </div>
      </div>

      {hiHaResum && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Xifra
              etiqueta="Entregades"
              valor={String(entregades.length)}
              // Cerradas sobre el total, no un porcentaje: "2 de 5" se lee de
              // un vistazo y no hay que dividir nada de cabeza.
              peu={stops.length > 0 ? `${fetes.length} de ${stops.length} tancades` : undefined}
            />
            <Xifra
              etiqueta="Facturable"
              valor={`${euros(facturat)} €`}
              peu={senseImport > 0 ? `${senseImport} sense import` : undefined}
              avis={senseImport > 0}
            />
            <Xifra
              etiqueta="Incidències"
              valor={String(incidencies.length)}
              peu={pendents.length > 0 ? `${pendents.length} sense tancar` : undefined}
            />
            <Xifra
              etiqueta="Jornada"
              // Con una sola entrega, un "17:50–17:50" es ruido.
              valor={
                hores.length === 0
                  ? "—"
                  : hores[0] === hores[hores.length - 1]
                    ? hores[0]
                    : `${hores[0]}–${hores[hores.length - 1]}`
              }
              peu={
                hores.length > 1
                  ? "primera i última"
                  : hores.length === 1
                    ? "una entrega"
                    : "sense hores"
              }
            />
          </div>

          {fetes.length > 0 && (
            <section className="soft-card divide-y divide-border">
              {fetes.map((stop) => {
                const incidencia = stop.statusCategory === "incidencia";
                return (
                  <div key={stop.id} className="flex items-start gap-3 px-4 py-3">
                    <span
                      className={cn(
                        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
                        incidencia
                          ? "bg-[color-mix(in_srgb,var(--status-incidencia)_16%,transparent)] text-status-incidencia"
                          : "bg-[color-mix(in_srgb,var(--success)_16%,transparent)] text-[color:var(--success)]",
                      )}
                    >
                      {incidencia ? (
                        <TriangleAlert className="size-4" aria-hidden />
                      ) : (
                        <Check className="size-4" strokeWidth={3} aria-hidden />
                      )}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {stop.customer || stop.id}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {stop.id}
                        {stop.city ? ` · ${stop.city}` : ""}
                      </p>
                      {incidencia && stop.incidentNote && (
                        <p className="mt-1 text-xs text-status-incidencia">
                          {stop.incidentNote}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Trucar phone={stop.phone} />
                      <div className="text-right">
                      <p className="text-sm tabular-nums">
                        {stop.deliveredTime ?? "—"}
                      </p>
                      {!incidencia && (
                        <p
                          className={cn(
                            "text-xs tabular-nums",
                            stop.price ? "text-muted-foreground" : "text-warning",
                          )}
                        >
                          {stop.price ? `${euros(stop.price)} €` : "sense import"}
                        </p>
                      )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}

      {/* ── Lo que queda por hacer ────────────────────────────────────── */}
      <section className="space-y-2">
        {pendents.length > 0 && (
          <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {passat ? "Van quedar sense tancar" : "Per repartir"}
          </h3>
        )}
        {pendents.length === 0 ? (
          <p className="soft-card px-4 py-6 text-center text-sm text-muted-foreground">
            {fetes.length > 0
              ? "Tot el dia tancat."
              : passat
                ? "Aquest dia no hi va haver cap comanda."
                : "Cap comanda assignada a aquest dia."}
          </p>
        ) : (
          <ul className="soft-card divide-y divide-border">
            {pendents.map((stop) => (
              <li
                key={stop.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/plain", stop.id)}
                className="flex items-center gap-2 px-3 py-2.5 lg:cursor-grab lg:active:cursor-grabbing"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{stop.customer || stop.id}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {stop.city || stop.address || stop.id}
                  </p>
                </div>
                <Trucar phone={stop.phone} />
                <Button variant="ghost" size="sm" onClick={() => onAssignDate(stop.id, null)}>
                  Treure
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {passat ? (
        pendents.length > 0 && (
          <p className="hairline pt-4 text-xs text-tertiary-foreground">
            Si es van entregar i ningú ho va marcar, tanca-les des de l&apos;avís que
            surt en obrir l&apos;app. Si no, fes{" "}
            <strong className="text-foreground">Treure</strong> i assigna-les a un
            altre dia.
          </p>
        )
      ) : (
        <Bossa stops={unassignedStops} onAssign={(id) => onAssignDate(id, date)} />
      )}
    </div>
  );
}

/**
 * Llamar al cliente desde el propio día.
 *
 * Antes había que salir del calendario y buscar la comanda en otra pantalla
 * para tener el teléfono a mano. Es un enlace `tel:` de toda la vida, así
 * que en el móvil abre el marcador y en el ordenador lo que tenga puesto.
 *
 * Sale en TODAS las comandas, tengan número o no: sin él se queda apagado
 * en vez de desaparecer. Así la lista no baila según la fila, y se ve de un
 * vistazo a quién le falta el teléfono en la hoja.
 */
function Trucar({ phone }: { phone: string | null }) {
  if (!phone || phone.trim() === "") {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="shrink-0"
        disabled
        title="Aquesta comanda no té telèfon al full"
        aria-label="Sense telèfon"
      >
        <Phone />
        Trucar
      </Button>
    );
  }

  return (
    <Button asChild variant="secondary" size="sm" className="shrink-0">
      <a href={telHref(phone)} onClick={(e) => e.stopPropagation()}>
        <Phone />
        Trucar
      </a>
    </Button>
  );
}

/** Una cifra del informe del día. */
function Xifra({
  etiqueta,
  valor,
  peu,
  avis,
}: {
  etiqueta: string;
  valor: string;
  peu?: string;
  avis?: boolean;
}) {
  return (
    <div className="soft-card px-4 py-3">
      <p className="truncate text-xs text-muted-foreground">{etiqueta}</p>
      <p className="mt-0.5 truncate text-xl font-semibold tabular-nums">{valor}</p>
      {peu && (
        <p className={cn("truncate text-xs", avis ? "text-warning" : "text-tertiary-foreground")}>
          {peu}
        </p>
      )}
    </div>
  );
}

// ── La bolsa de comandas sin asignar ───────────────────────────────────

/**
 * Las comandas que todavía no tienen día.
 *
 * Un solo componente para las dos maneras de asignar: tocar (móvil, con
 * previsualización si mantienes el dedo) y arrastrar a una casilla del mes
 * (ordenador). El arrastre es el nativo del navegador; el `pointermove` que
 * lo inicia ya cancela el toque, así que no se pisan.
 */
function Bossa({
  stops,
  onAssign,
}: {
  stops: Stop[];
  /** `null` cuando no hay ningún día abierto: entonces tocar solo previsualiza. */
  onAssign: ((id: string) => void) | null;
}) {
  const [previewStop, setPreviewStop] = useState<Stop | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const cancelRef = useRef(false);
  /**
   * Con qué se ha pulsado la última vez.
   *
   * El "mantener pulsado" es un gesto de dedo y solo se arma con el dedo: con
   * el ratón, mantener el botón medio segundo es justo el principio de un
   * arrastre, así que armarlo también ahí abría la previsualización a media
   * comanda arrastrada. Con ratón manda el `click` de toda la vida.
   */
  const tipusRef = useRef<string>("mouse");

  const activar = (stop: Stop) => {
    if (onAssign) onAssign(stop.id);
    else setPreviewStop(stop);
  };

  const startPress = (stop: Stop) => {
    cancelRef.current = false;
    timerRef.current = setTimeout(() => {
      if (!cancelRef.current) {
        setPreviewStop(stop);
      }
      timerRef.current = null;
    }, 500); // 500ms long press
  };

  const endPress = (stop: Stop) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      if (!cancelRef.current) activar(stop);
    }
  };

  const cancelPress = () => {
    cancelRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="hairline flex items-baseline justify-between gap-2 pt-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-status-pendent">
          <Inbox className="size-4" aria-hidden />
          Bossa de comandes
        </h3>
        <span className="text-sm tabular-nums text-muted-foreground">{stops.length}</span>
      </div>
      <p className="text-xs text-tertiary-foreground">
        <span className="lg:hidden">
          {onAssign
            ? "Toca per assignar o mantén premut per previsualitzar."
            : "Clica en un dia del calendari per assignar-les."}
        </span>
        <span className="hidden lg:inline">
          Arrossega-les a un dia del mes{onAssign ? ", o clica per assignar-les al dia obert" : ""}.
        </span>
      </p>

      {stops.length === 0 ? (
        <p className="soft-card px-4 py-6 text-center text-sm text-muted-foreground">
          No et queden comandes pendents d&apos;assignar.
        </p>
      ) : (
        <div className="grid min-h-0 grid-cols-2 gap-2 overflow-y-auto lg:grid-cols-1">
          {stops.map((stop) => (
            /*
              La tarjeta es el área de asignar —tocar, mantener pulsado o
              arrastrar— y el botón de llamar va aparte, como hermano: un
              botón dentro de otro no es HTML válido y el teléfono acabaría
              asignando la comanda al día abierto.
            */
            <div key={stop.id} className="soft-card flex flex-col">
              <button
                draggable
                onDragStart={(e) => {
                  cancelPress();
                  e.dataTransfer.setData("text/plain", stop.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onPointerDown={(e) => {
                  tipusRef.current = e.pointerType;
                  if (e.pointerType === "touch") startPress(stop);
                }}
                onPointerUp={(e) => {
                  if (e.pointerType === "touch") endPress(stop);
                }}
                onPointerLeave={cancelPress}
                onPointerMove={cancelPress} // Si el dedo se mueve (scrolling), cancelamos
                // El dedo ya se ha resuelto en `onPointerUp`; el click que iOS
                // dispara después no debe contar dos veces.
                onClick={() => {
                  if (tipusRef.current !== "touch") activar(stop);
                }}
                className="pressable flex flex-1 touch-none select-none flex-col items-start gap-0.5 p-3 text-left lg:cursor-grab lg:active:cursor-grabbing"
              >
                <span className="w-full truncate text-sm font-semibold">{stop.customer || stop.id}</span>
                <span className="w-full truncate text-xs text-muted-foreground">{stop.city || "Sense adreça"}</span>
              </button>
              <div className="px-3 pb-3">
                <Trucar phone={stop.phone} />
              </div>
            </div>
          ))}
        </div>
      )}

      {previewStop && (
        <div className="fixed inset-0 z-[100] flex animate-fade-in items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setPreviewStop(null)}>
          <div className="relative w-full max-w-md sm:max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="secondary"
              size="icon"
              className="absolute -top-12 right-0 rounded-full text-white"
              onClick={() => setPreviewStop(null)}
              aria-label="Tancar"
            >
              <X />
            </Button>
            <StopCard detall stop={previewStop} onDelivered={() => {}} onIncident={() => {}} />
            {onAssign && (
              <Button
                className="mt-4 w-full"
                size="touch"
                onClick={() => {
                  onAssign(previewStop.id);
                  setPreviewStop(null);
                }}
              >
                Assignar comanda
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Historial ─────────────────────────────────────────────────────

/** Las columnas de la tabla, y por dónde se puede ordenar. */
const COLUMNES_HISTORIAL = [
  { clau: "id", etiqueta: "Comanda", classe: "w-32" },
  { clau: "customer", etiqueta: "Client", classe: "" },
  { clau: "city", etiqueta: "Població", classe: "w-44" },
  { clau: "date", etiqueta: "Data", classe: "w-28" },
  { clau: "price", etiqueta: "Import", classe: "w-28 text-right" },
  { clau: "statusCategory", etiqueta: "Estat", classe: "w-32" },
] as const;

type ClauHistorial = (typeof COLUMNES_HISTORIAL)[number]["clau"];

/** Escapa un valor para una celda de CSV: comillas dobles y punto y coma. */
function celdaCsv(valor: string | number | null): string {
  const texto = valor === null ? "" : String(valor);
  return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/**
 * Baja el historial filtrado como CSV.
 *
 * Separador `;` y BOM al principio: es lo que hace que Excel en español lo
 * abra en columnas de una vez en vez de meter toda la fila en la celda A1.
 * Los importes van con coma decimal por lo mismo.
 */
function descarregarCsv(stops: Stop[], nom: string): void {
  const cabecera = COLUMNES_HISTORIAL.map((c) => c.etiqueta);
  const filas = stops.map((s) => [
    celdaCsv(s.id),
    celdaCsv(s.customer),
    celdaCsv(s.city),
    celdaCsv(s.date),
    celdaCsv(s.price === null ? "" : euros(s.price)),
    celdaCsv(ETIQUETA_ESTAT[s.statusCategory] ?? s.statusCategory),
  ]);
  const csv = "﻿" + [cabecera, ...filas].map((f) => f.join(";")).join("\r\n");

  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `historial-${nom || "reparto"}.csv`.replace(/\s+/g, "-").toLowerCase();
  enlace.click();
  URL.revokeObjectURL(url);
}

const ETIQUETA_ESTAT: Record<string, string> = {
  entregat: "Entregat",
  incidencia: "Incidència",
  pendent: "Pendent",
  en_curs: "En curs",
};

function TabHistorial({
  historyStops,
  mes,
  onDelivered,
  onIncident,
  onImporte,
}: {
  historyStops: { entregat: Stop[]; incidencia: Stop[] };
  /** Nombre del full, solo para el nombre del CSV. */
  mes: string;
  onDelivered: (id: string, price: number | null) => void;
  onIncident: (id: string, note: string) => void;
  onImporte: (id: string, importe: number | null) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [ordre, setOrdre] = useState<{ clau: ClauHistorial; asc: boolean }>({
    clau: "date",
    asc: false,
  });
  /**
   * La comanda abierta desde la tabla, por su id: si se guarda el objeto, al
   * corregir el importe la ficha se queda enseñando el de antes.
   */
  const [obertId, setObertId] = useState<string | null>(null);

  const allHistory = useMemo(() => [...historyStops.entregat, ...historyStops.incidencia], [historyStops]);

  const filteredHistory = useMemo(() => {
    if (!searchTerm.trim()) return allHistory;
    const q = searchTerm.toLowerCase();
    return allHistory.filter(stop =>
      stop.id.toLowerCase().includes(q) ||
      (stop.customer && stop.customer.toLowerCase().includes(q)) ||
      (stop.address && stop.address.toLowerCase().includes(q)) ||
      (stop.city && stop.city.toLowerCase().includes(q))
    );
  }, [allHistory, searchTerm]);

  /**
   * Ordenado por la columna que toque.
   *
   * Los importes se comparan como números y el resto como texto: ordenar
   * "100" y "20" alfabéticamente pone el 100 primero, que en una columna de
   * dinero no es una molestia, es un error de lectura.
   */
  const ordenat = useMemo(() => {
    const { clau, asc } = ordre;
    const signo = asc ? 1 : -1;
    return [...filteredHistory].sort((a, b) => {
      if (clau === "price") {
        return signo * ((a.price ?? -1) - (b.price ?? -1));
      }
      const va = String(a[clau] ?? "");
      const vb = String(b[clau] ?? "");
      // Los vacíos al final, se ordene como se ordene.
      if (va === "" && vb !== "") return 1;
      if (vb === "" && va !== "") return -1;
      return signo * va.localeCompare(vb, "ca", { numeric: true });
    });
  }, [filteredHistory, ordre]);

  const obert = obertId ? (allHistory.find((s) => s.id === obertId) ?? null) : null;

  const totalImport = useMemo(
    () => ordenat.reduce((suma, s) => suma + (s.price ?? 0), 0),
    [ordenat],
  );

  // Para las tarjetas del móvil: agrupadas por fecha, como siempre.
  const groupedByDate = useMemo(() => {
    const map = new Map<string, Stop[]>();
    for (const stop of ordenat) {
      const d = stop.date || "Sense data";
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(stop);
    }
    const sortedDates = Array.from(map.keys()).sort((a, b) => {
      if (a === "Sense data") return 1;
      if (b === "Sense data") return -1;
      return b.localeCompare(a); // "2026-08-09" > "2026-08-08"
    });
    return sortedDates.map(date => ({ date, stops: map.get(date)! }));
  }, [ordenat]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 soft-card p-4 lg:max-w-md">
        <div className="flex-1">
          <p className="text-xs font-semibold text-muted-foreground">Entregats</p>
          <p className="text-2xl font-semibold text-status-entregat">{historyStops.entregat.length}</p>
        </div>
        <div className="h-10 w-px bg-border" />
        <div className="flex-1">
          <p className="text-xs font-semibold text-muted-foreground">Incidències</p>
          <p className="text-2xl font-semibold text-status-incidencia">{historyStops.incidencia.length}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-tertiary-foreground" />
          <input
            type="search"
            placeholder="Cerca per comanda, client o adreça…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-full bg-muted py-2.5 pl-10 pr-4 text-base outline-none placeholder:text-tertiary-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>
        <Button
          variant="secondary"
          disabled={ordenat.length === 0}
          onClick={() => descarregarCsv(ordenat, mes)}
        >
          <Download />
          <span className="hidden sm:inline">Exportar CSV</span>
        </Button>
      </div>

      {ordenat.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No hi ha resultats a l&apos;historial.
        </p>
      ) : (
        <>
          {/*
            En ordenador, una tabla. Cabe una comanda por línea en vez de
            una tarjeta por comanda, así que se ve un mes entero de golpe y
            se puede ordenar por columna. Las acciones no desaparecen: la
            fila abre la misma tarjeta de siempre.
          */}
          <div className="hidden overflow-x-auto soft-card lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {COLUMNES_HISTORIAL.map((col) => {
                    const activa = ordre.clau === col.clau;
                    return (
                      <th key={col.clau} className={cn("font-medium", col.classe)}>
                        <button
                          type="button"
                          onClick={() =>
                            setOrdre((prev) =>
                              prev.clau === col.clau
                                ? { clau: col.clau, asc: !prev.asc }
                                : { clau: col.clau, asc: true },
                            )
                          }
                          aria-label={`Ordenar per ${col.etiqueta}`}
                          className={cn(
                            "flex w-full items-center gap-1 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide",
                            col.classe.includes("text-right") && "justify-end",
                            activa ? "text-primary" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {col.etiqueta}
                          <ArrowUpDown
                            className={cn("size-3", !activa && "opacity-0")}
                            aria-hidden
                          />
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {ordenat.map((stop) => (
                  <tr
                    key={stop.id}
                    onClick={() => setObertId(stop.id)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/60"
                  >
                    <td className="px-4 py-2 tabular-nums">{stop.id}</td>
                    <td className="max-w-0 truncate px-4 py-2">{stop.customer || "—"}</td>
                    <td className="max-w-0 truncate px-4 py-2 text-muted-foreground">
                      {stop.city || "—"}
                    </td>
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">
                      {stop.date ? stop.date.split("-").reverse().join("/") : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {stop.price === null ? "—" : `${euros(stop.price)} €`}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          stop.statusCategory === "entregat"
                            ? "bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-[var(--success)]"
                            : "bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] text-[var(--warning)]",
                        )}
                      >
                        {ETIQUETA_ESTAT[stop.statusCategory] ?? stop.statusCategory}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border">
                  <td colSpan={3} className="px-4 py-2.5 text-xs text-muted-foreground">
                    {ordenat.length} {ordenat.length === 1 ? "comanda" : "comandes"}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">Total</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                    {euros(totalImport)} €
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* En el móvil, las tarjetas de siempre: una tabla de seis columnas
              en 375 px no se lee. */}
          <div className="space-y-6 lg:hidden">
            {groupedByDate.map(group => (
              <div key={group.date} className="space-y-3">
                <h3 className="sticky top-0 z-10 bg-background py-1 text-sm font-semibold">
                  {group.date === "Sense data" ? group.date : formatLongDate(group.date)}
                </h3>
                <ul className="space-y-3">
                  {group.stops.map((stop) => (
                    <li key={stop.id}>
                      <StopCard
                        stop={stop}
                        onDelivered={onDelivered}
                        onIncident={onIncident}
                        onImporte={onImporte}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}

      {obert && (
        <div
          className="fixed inset-0 z-[100] flex animate-fade-in items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setObertId(null)}
        >
          <div className="relative w-full max-w-md sm:max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="secondary"
              size="icon"
              className="absolute -top-12 right-0 rounded-full text-white"
              onClick={() => setObertId(null)}
              aria-label="Tancar"
            >
              <X />
            </Button>
            <StopCard
              detall
              onImporte={onImporte}
              stop={obert}
              onDelivered={(id, price) => {
                onDelivered(id, price);
                setObertId(null);
              }}
              onIncident={(id, note) => {
                onIncident(id, note);
                setObertId(null);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Route Summary ──────────────────────────────────────────────────────

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
          {route.fullRouteUrl && (
            <Button asChild variant="secondary" size="sm">
              <a href={route.fullRouteUrl} target="_blank" rel="noopener noreferrer">
                <Route />
                Obrir Maps
              </a>
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
