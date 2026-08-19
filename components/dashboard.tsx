"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Menu,
  Route,
  Search,
  X,
} from "lucide-react";
import { db } from "@/lib/db";
import RouteTrace from "@/components/route-trace";
import HomeSummary from "@/components/home-summary";
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
} from "@/lib/sync";
import { formatDistance, formatDuration } from "@/lib/format";
import { formatLongDate, getMonthGrid, getYearMonth } from "@/lib/dates";
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

type TabValue = "avui" | "calendari" | "historial";

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

  const handleDelivered = (orderId: string) => {
    void recordDelivery(orderId, "entregado");
  };
  const handleIncident = (orderId: string, note: string) => {
    void recordDelivery(orderId, "incidencia", note || null);
  };
  const handleDateAssignment = (orderId: string, newDate: string | null) => {
    // Un día que ya ha pasado no admite pedidos nuevos: planificar hacia
    // atrás no significa nada. Quitar sí se permite (newDate === null), que
    // es como se saca un pedido que se quedó sin entregar para llevarlo a
    // otro día. El guardia va aquí, en el handler, y no solo en la pantalla,
    // para que valga sea cual sea la vía por la que se asigne.
    if (newDate !== null && todayDate && newDate < todayDate) return;
    void recordDateAssignment(orderId, newDate);
  };

  return (
    <div className="mx-auto flex min-h-svh max-w-2xl flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))]">
      {manifest?.demo && (
        // Texto negro sobre el naranja del sistema: en blanco no hay
        // contraste suficiente y este aviso tiene que leerse sí o sí.
        <p className="bg-warning px-4 py-1 text-center text-xs font-semibold text-black">
          Modo demo · pedidos de ejemplo
        </p>
      )}

      <header className="warm-gradient sticky top-0 z-20 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{driverName}</h1>
            <div className="flex items-center gap-1.5">
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

          <button
            type="button"
            onClick={() => {
              setMenuOpen((v) => !v);
              if (!menuOpen) void fetchTabs();
            }}
            className="pressable flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-primary"
            aria-label="Menú"
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        <SyncBar
          online={online}
          syncing={syncing}
          savedAt={stored?.savedAt ?? null}
          pendingCount={pendingCount}
          error={error}
          onSync={() => void sync()}
        />
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

      <main className="flex-1 px-4 py-5">
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
                onIr={setActiveTab}
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
                onDelivered={handleDelivered}
                onIncident={handleIncident}
              />
            )}
          </>
        )}
      </main>

      {/* ── Bottom Navigation ─────────────────────────────────────────── */}
      <nav className="material fixed bottom-0 left-0 right-0 z-20 mx-auto flex max-w-2xl border-t border-border pb-[env(safe-area-inset-bottom)]">
        <button
          onClick={() => setActiveTab("avui")}
          className={cn(
            "pressable flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium",
            activeTab === "avui" ? "text-primary" : "text-tertiary-foreground",
          )}
        >
          <Clock className="size-6" strokeWidth={activeTab === "avui" ? 2.3 : 1.8} />
          Avui
        </button>
        <button
          onClick={() => setActiveTab("calendari")}
          className={cn(
            "pressable flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium",
            activeTab === "calendari" ? "text-primary" : "text-tertiary-foreground",
          )}
        >
          <CalendarDays className="size-6" strokeWidth={activeTab === "calendari" ? 2.3 : 1.8} />
          Calendari
        </button>
        <button
          onClick={() => setActiveTab("historial")}
          className={cn(
            "pressable flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium",
            activeTab === "historial" ? "text-primary" : "text-tertiary-foreground",
          )}
        >
          <History className="size-6" strokeWidth={activeTab === "historial" ? 2.3 : 1.8} />
          Historial
        </button>
      </nav>
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
  onDelivered: (id: string) => void;
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

  if (todayStops.length === 0) {
    return (
      <div className="animate-rise-in soft-card px-6 py-12 text-center">
        <p className="text-base font-medium">No tens comandes programades per a avui</p>
        <p className="mt-1 text-sm text-muted-foreground">Ves al Calendari per assignar comandes al dia d&apos;avui.</p>
      </div>
    );
  }

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
          {enCurs.map((stop) => (
            <StopCard
              key={stop.id}
              stop={stop}
              onDelivered={onDelivered}
              onIncident={onIncident}
            />
          ))}
        </div>
      )}

      {pendents.length > 0 && (
        <div className="space-y-3">
          <h3 className="px-1 text-sm font-semibold text-status-pendent">Pendents</h3>
          <ul className="space-y-3">
            {todayStops.map((stop, index) => {
              if (stop.statusCategory !== "pendent") return null;

              // Calcular si es el primer o último pendiente
              const firstPendentIndex = todayStops.findIndex(s => s.statusCategory === "pendent");
              const lastPendentIndex = todayStops.findLastIndex(s => s.statusCategory === "pendent");

              return (
                <li key={stop.id}>
                  <StopCard
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
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

// ── Tab: Calendari ─────────────────────────────────────────────────────

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
  const [currentMonth, setCurrentMonth] = useState(() => getYearMonth(todayDate || new Date().toISOString().slice(0, 10)));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const grid = useMemo(() => getMonthGrid(currentMonth.year, currentMonth.month), [currentMonth.year, currentMonth.month]);

  const prevMonth = () => {
    setCurrentMonth(prev => {
      let m = prev.month - 1;
      let y = prev.year;
      if (m < 1) { m = 12; y--; }
      return { year: y, month: m };
    });
  };

  const nextMonth = () => {
    setCurrentMonth(prev => {
      let m = prev.month + 1;
      let y = prev.year;
      if (m > 12) { m = 1; y++; }
      return { year: y, month: m };
    });
  };

  if (selectedDate) {
    const assigned = calendarStopsByDate[selectedDate] || [];
    const isToday = selectedDate === todayDate;
    const isPast = Boolean(todayDate) && selectedDate < todayDate;

    return (
      <div className="animate-fade-in space-y-6">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setSelectedDate(null)} aria-label="Tornar">
            <ChevronLeft />
          </Button>
          <h2 className="text-lg font-semibold">
            {selectedDate.split("-").reverse().join("/")}
            {isToday && " · Avui"}
            {isPast && " · Passat"}
          </h2>
        </div>

        <div className="space-y-3">
          <h3 className="px-1 text-sm font-semibold text-muted-foreground">
            Comandes assignades ({assigned.length})
          </h3>
          {assigned.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">No hi ha comandes assignades a aquest dia.</p>
          ) : (
            <ul className="space-y-3">
              {assigned.map((stop) => (
                <li key={stop.id} className="relative">
                  <StopCard
                    stop={stop}
                    onDelivered={() => {}} // No-op: los estados solo se marcan en "Avui"
                    onIncident={() => {}} // No-op
                  />
                  {/* Botón para desasignar (volver a la lista) */}
                  <div className="absolute right-3 top-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAssignDate(stop.id, null);
                      }}
                    >
                      <X />
                      Treure
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {isPast ? (
          <div className="hairline space-y-2 pt-4">
            <p className="text-sm text-muted-foreground">
              Aquest dia ja ha passat: no s&apos;hi poden afegir comandes.
            </p>
            {assigned.length > 0 && (
              <p className="text-xs text-tertiary-foreground">
                Si alguna es va quedar sense entregar, fes <strong className="text-foreground">Treure</strong> i
                assigna-la a un altre dia.
              </p>
            )}
          </div>
        ) : (
          <div className="hairline space-y-3 pt-4">
            <h3 className="px-1 text-sm font-semibold text-status-pendent">Afegir comanda ràpid</h3>
            <p className="px-1 text-xs text-tertiary-foreground">
              Toca per assignar o <strong className="text-muted-foreground">mantén premut</strong> per previsualitzar la comanda.
            </p>
            {unassignedStops.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">No et queden comandes pendents d&apos;assignar.</p>
            ) : (
              <FastAssignList stops={unassignedStops} onAssign={(id) => onAssignDate(id, selectedDate)} />
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="soft-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={prevMonth} aria-label="Mes anterior">
            <ChevronLeft />
          </Button>
          <h2 className="text-base font-semibold">
            {MONTH_NAMES[currentMonth.month - 1]} {currentMonth.year}
          </h2>
          <Button variant="ghost" size="icon" onClick={nextMonth} aria-label="Mes següent">
            <ChevronRight />
          </Button>
        </div>

        <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-semibold text-tertiary-foreground">
          {WEEKDAY_NAMES.map(d => <div key={d}>{d}</div>)}
        </div>

        <div className="grid grid-cols-7 gap-y-1">
          {grid.map((date) => {
            const isToday = date === todayDate;
            const assignedCount = (calendarStopsByDate[date] || []).length;
            const { month: dMonth } = getYearMonth(date);
            const isCurrentMonth = dMonth === currentMonth.month;
            const dayNum = date.split("-")[2].replace(/^0/, "");

            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className="pressable relative flex aspect-square flex-col items-center justify-center gap-0.5"
              >
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-sm",
                    !isCurrentMonth && "text-tertiary-foreground",
                    isToday && "bg-primary font-semibold text-primary-foreground",
                  )}
                >
                  {dayNum}
                </span>
                {assignedCount > 0 && (
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      isToday ? "bg-primary" : "bg-muted-foreground",
                    )}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="soft-card p-4">
        <h2 className="mb-1 text-sm font-semibold">Bossa de comandes ({unassignedStops.length})</h2>
        <p className="text-xs text-muted-foreground">
          Clica en un dia del calendari per assignar aquestes comandes.
        </p>
      </div>
    </div>
  );
}

// ── Fast Assign List with Long Press ───────────────────────────────────

function FastAssignList({ stops, onAssign }: { stops: Stop[]; onAssign: (id: string) => void }) {
  const [previewStop, setPreviewStop] = useState<Stop | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const cancelRef = useRef(false);

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
      if (!cancelRef.current) {
        onAssign(stop.id);
      }
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
    <>
      <div className="grid grid-cols-2 gap-2">
        {stops.map((stop) => (
          <button
            key={stop.id}
            onPointerDown={() => startPress(stop)}
            onPointerUp={() => endPress(stop)}
            onPointerLeave={cancelPress}
            onPointerMove={cancelPress} // Si el dedo se mueve (scrolling), cancelamos
            className="pressable flex touch-none select-none flex-col items-start gap-0.5 soft-card p-3 text-left"
          >
            <span className="w-full truncate text-sm font-semibold">{stop.customer || stop.id}</span>
            <span className="w-full truncate text-xs text-muted-foreground">{stop.city || "Sense adreça"}</span>
          </button>
        ))}
      </div>

      {previewStop && (
        <div className="fixed inset-0 z-[100] flex animate-fade-in items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setPreviewStop(null)}>
          <div className="relative w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="secondary"
              size="icon"
              className="absolute -top-12 right-0 rounded-full text-white"
              onClick={() => setPreviewStop(null)}
              aria-label="Tancar"
            >
              <X />
            </Button>
            <StopCard stop={previewStop} onDelivered={() => {}} onIncident={() => {}} />
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
          </div>
        </div>
      )}
    </>
  );
}

// ── Tab: Historial ─────────────────────────────────────────────────────

function TabHistorial({
  historyStops,
  onDelivered,
  onIncident,
}: {
  historyStops: { entregat: Stop[]; incidencia: Stop[] };
  onDelivered: (id: string) => void;
  onIncident: (id: string, note: string) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");

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

  // Agrupar por fecha ("date")
  const groupedByDate = useMemo(() => {
    const map = new Map<string, Stop[]>();
    for (const stop of filteredHistory) {
      const d = stop.date || "Sense data";
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(stop);
    }
    // Ordenar fechas de más reciente a más antigua
    const sortedDates = Array.from(map.keys()).sort((a, b) => {
      if (a === "Sense data") return 1;
      if (b === "Sense data") return -1;
      return b.localeCompare(a); // "2026-08-09" > "2026-08-08"
    });
    return sortedDates.map(date => ({ date, stops: map.get(date)! }));
  }, [filteredHistory]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 soft-card p-4">
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

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-tertiary-foreground" />
        <input
          type="search"
          placeholder="Cerca per comanda, client o adreça…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded-full bg-muted py-2.5 pl-10 pr-4 text-base outline-none placeholder:text-tertiary-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>

      <div className="space-y-6">
        {groupedByDate.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hi ha resultats a l&apos;historial.
          </p>
        ) : (
          groupedByDate.map(group => (
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
          ))
        )}
      </div>
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
