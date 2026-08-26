"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowUpDown,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileText,
  History,
  Inbox,
  Menu,
  Route,
  Search,
  Settings,
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
import Ajustos from "@/components/ajustos";
import Sidebar from "@/components/sidebar";
import { leerDatosFacturacion } from "@/lib/ajustes-factura";
import { euros, type DatosFacturacion } from "@/lib/factura";
import {
  recordDelivery,
  recordDateAssignment,
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
import { formatDistance, formatDuration } from "@/lib/format";
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
  /** La comanda que se ha abierto desde el buscador. */
  const [comandaOberta, setComandaOberta] = useState<Stop | null>(null);

  // ── Desfer ────────────────────────────────────────────────────────────
  const [accioDesfer, setAccioDesfer] = useState<AccioDesfer | null>(null);

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

  const sync = useCallback(async () => {
    setSyncing(true);
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
      setSyncing(false);
    }
  }, [router, selectedSheetTab]);

  useEffect(() => {
    const initial = setTimeout(() => void sync(), 0);
    const onOnline = () => void sync();
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void sync();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(initial);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sync]);

  const manifest = stored?.data;
  const allStops = manifest?.today?.stops ?? []; // manifest.today.stops is now all stops in the sheet!
  const todayDate = manifest?.today?.date ?? ""; // The "today" date on the server

  // Clasificación de todos los pedidos
  const {
    todayStops,
    unassignedStops,
    calendarStopsByDate,
    historyStops,
  } = useMemo(() => {
    const todayStops: Stop[] = [];
    const unassignedStops: Stop[] = [];
    const historyStops: { entregat: Stop[]; incidencia: Stop[] } = {
      entregat: [],
      incidencia: [],
    };
    const calendarStopsByDate: Record<string, Stop[]> = {};

    for (const stop of allStops) {
      const cat = (stop.statusCategory ?? "pendent") as StatusCategory;

      // Historial
      if (cat === "entregat") {
        historyStops.entregat.push(stop);
        continue;
      }
      if (cat === "incidencia") {
        historyStops.incidencia.push(stop);
        continue;
      }

      // Si no es historial, es pendiente o en_curs
      if (!stop.date) {
        unassignedStops.push(stop);
      } else {
        if (!calendarStopsByDate[stop.date]) calendarStopsByDate[stop.date] = [];
        calendarStopsByDate[stop.date].push(stop);

        if (stop.date === todayDate) {
          todayStops.push(stop);
        }
      }
    }

    // Ordenar los de hoy con el orden personalizado
    const orderedToday = applyCustomOrder(todayStops, customOrderIds);

    return {
      todayStops: orderedToday,
      unassignedStops,
      calendarStopsByDate,
      historyStops,
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

  const handleDelivered = (orderId: string, price: number | null = null) => {
    const abans = allStops.find((s) => s.id === orderId);
    void recordDelivery(orderId, "entregado", null, price);
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
          <p className="mb-3 text-xs font-semibold text-muted-foreground">
            Selecciona la hoja
          </p>
          {loadingTabs ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Cargando pestañas…
            </p>
          ) : tabs.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No se han podido cargar las pestañas
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tabs.map((tab) => {
                const isActive =
                  tab === selectedSheetTab ||
                  (!selectedSheetTab && tab === manifest?.sheetTab);
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => void handleTabSelect(tab)}
                    className={cn(
                      "pressable rounded-full px-3.5 py-2 text-sm font-medium",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground",
                    )}
                  >
                    {tab}
                  </button>
                );
              })}
            </div>
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
                entregats={historyStops.entregat.length}
                incidencies={historyStops.incidencia.length}
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
              />
            )}
            {activeTab === "factures" && (
              <Factures
                entregats={historyStops.entregat}
                mes={selectedSheetTab || manifest?.sheetTab || ""}
                datos={datosFactura}
                online={online}
                onImporte={handleDelivered}
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
            setComandaOberta(stop);
          }}
        />
      )}

      {/* La comanda que se ha abierto desde el buscador, con sus acciones. */}
      {comandaOberta && (
        <div
          className="fixed inset-0 z-[100] flex animate-fade-in items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setComandaOberta(null)}
        >
          <div className="relative w-full max-w-md sm:max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="secondary"
              size="icon"
              className="absolute -top-12 right-0 rounded-full text-white"
              onClick={() => setComandaOberta(null)}
              aria-label="Tancar"
            >
              <X />
            </Button>
            <StopCard
              detall
              stop={comandaOberta}
              onDelivered={(id, price) => {
                handleDelivered(id, price);
                setComandaOberta(null);
              }}
              onIncident={(id, note) => {
                handleIncident(id, note);
                setComandaOberta(null);
              }}
            />
          </div>
        </div>
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
  entregats: number;
  incidencies: number;
  onIr: (destino: "calendari" | "historial") => void;
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
          pendents={pendents.length}
          enCurs={enCurs.length}
          entregats={entregats}
          incidencies={incidencies}
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
  const passat = selectedDate ? esPassat(selectedDate) : false;

  const soltar = (date: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setSobreDia(null);
    const id = e.dataTransfer.getData("text/plain");
    if (id && !esPassat(date)) onAssignDate(id, date);
  };

  return (
    <div className="animate-fade-in lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-4">
      {/* ── El mes ─────────────────────────────────────────────────────── */}
      <div
        className={cn(
          "soft-card flex flex-col p-4 lg:min-h-0",
          // En el móvil el día abierto sustituye al mes; en ordenador conviven.
          selectedDate && "hidden lg:flex",
        )}
      >
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
                    <span className="hidden text-[11px] font-semibold tabular-nums text-muted-foreground lg:inline">
                      {delDia.length}
                    </span>
                  )}
                </span>

                {/* Móvil: un punto. Es todo lo que cabe. */}
                {delDia.length > 0 && (
                  <span
                    className={cn(
                      "size-1.5 rounded-full lg:hidden",
                      isToday ? "bg-primary" : "bg-muted-foreground",
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
                        stop.statusCategory === "en_curs"
                          ? "bg-[color-mix(in_srgb,var(--status-en-curs)_16%,transparent)] text-status-en-curs"
                          : "bg-muted text-foreground",
                      )}
                    >
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
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData("text/plain", stop.id)}
                          title={`${stop.customer || stop.id}${stop.city ? ` · ${stop.city}` : ""}`}
                          className={cn(
                            "truncate rounded-md px-1.5 py-1 text-[11px] leading-4 lg:cursor-grab lg:active:cursor-grabbing",
                            stop.statusCategory === "en_curs"
                              ? "bg-[color-mix(in_srgb,var(--status-en-curs)_16%,transparent)] text-status-en-curs"
                              : "bg-muted text-foreground",
                          )}
                        >
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

      {/* ── Columna de al lado: el día abierto, o la bolsa ─────────────── */}
      <aside
        className={cn(
          "mt-6 flex flex-col gap-3 lg:mt-0 lg:min-h-0",
          !selectedDate && "lg:pt-0",
        )}
      >
        {selectedDate ? (
          <>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedDate(null)}
                aria-label="Tancar el dia"
                className="lg:hidden"
              >
                <ChevronLeft />
              </Button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold">
                  {selectedDate.split("-").reverse().join("/")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {selectedDate === todayDate ? "Avui · " : passat ? "Ja ha passat · " : ""}
                  {assignades.length}{" "}
                  {assignades.length === 1 ? "comanda" : "comandes"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedDate(null)}
                aria-label="Tancar el dia"
                className="hidden lg:inline-flex"
              >
                <X />
              </Button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 lg:overflow-y-auto">
              <div className="space-y-2">
                {assignades.length === 0 ? (
                  <p className="soft-card px-4 py-6 text-center text-sm text-muted-foreground">
                    Cap comanda assignada a aquest dia.
                  </p>
                ) : (
                  <ul className="soft-card divide-y divide-border">
                    {assignades.map((stop) => (
                      <li
                        key={stop.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", stop.id)}
                        className="flex items-center gap-2 px-3 py-2.5 lg:cursor-grab lg:active:cursor-grabbing"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {stop.customer || stop.id}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {stop.city || stop.address || stop.id}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onAssignDate(stop.id, null)}
                        >
                          Treure
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {passat ? (
                <div className="hairline space-y-2 pt-4">
                  <p className="text-sm text-muted-foreground">
                    Aquest dia ja ha passat: no s&apos;hi poden afegir comandes.
                  </p>
                  {assignades.length > 0 && (
                    <p className="text-xs text-tertiary-foreground">
                      Si alguna es va quedar sense entregar, fes{" "}
                      <strong className="text-foreground">Treure</strong> i assigna-la a un
                      altre dia.
                    </p>
                  )}
                </div>
              ) : (
                <Bossa
                  stops={unassignedStops}
                  onAssign={(id) => onAssignDate(id, selectedDate)}
                />
              )}
            </div>
          </>
        ) : (
          <Bossa stops={unassignedStops} onAssign={null} />
        )}
      </aside>
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
            <button
              key={stop.id}
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
              className="pressable soft-card flex touch-none select-none flex-col items-start gap-0.5 p-3 text-left lg:cursor-grab lg:active:cursor-grabbing"
            >
              <span className="w-full truncate text-sm font-semibold">{stop.customer || stop.id}</span>
              <span className="w-full truncate text-xs text-muted-foreground">{stop.city || "Sense adreça"}</span>
            </button>
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
}: {
  historyStops: { entregat: Stop[]; incidencia: Stop[] };
  /** Nombre del full, solo para el nombre del CSV. */
  mes: string;
  onDelivered: (id: string, price: number | null) => void;
  onIncident: (id: string, note: string) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [ordre, setOrdre] = useState<{ clau: ClauHistorial; asc: boolean }>({
    clau: "date",
    asc: false,
  });
  /** La comanda abierta desde la tabla, para poder tocarla sin salir. */
  const [obert, setObert] = useState<Stop | null>(null);

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
                    onClick={() => setObert(stop)}
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
                      <StopCard stop={stop} onDelivered={onDelivered} onIncident={onIncident} />
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
          onClick={() => setObert(null)}
        >
          <div className="relative w-full max-w-md sm:max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="secondary"
              size="icon"
              className="absolute -top-12 right-0 rounded-full text-white"
              onClick={() => setObert(null)}
              aria-label="Tancar"
            >
              <X />
            </Button>
            <StopCard
              detall
              stop={obert}
              onDelivered={(id, price) => {
                onDelivered(id, price);
                setObert(null);
              }}
              onIncident={(id, note) => {
                onIncident(id, note);
                setObert(null);
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
