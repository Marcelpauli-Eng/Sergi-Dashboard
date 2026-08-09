"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  GripVertical,
  History,
  Menu,
  Route,
  Search,
  X,
} from "lucide-react";
import { db } from "@/lib/db";
import {
  recordDelivery,
  recordDateAssignment,
  syncNow,
  SessionExpiredError,
  getSelectedTab,
  setSelectedTab,
  getCustomOrder,
  setCustomOrder,
  applyCustomOrder,
} from "@/lib/sync";
import { formatDistance, formatDuration } from "@/lib/format";
import { formatLongDate, addDays, getMonthGrid, getYearMonth } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { RouteDay, Stop } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

const CATEGORY_CONFIG: Record<
  StatusCategory,
  { label: string; color: string; bgColor: string; defaultOpen: boolean }
> = {
  pendent: {
    label: "Pendents",
    color: "text-status-pendent",
    bgColor: "bg-gray-100",
    defaultOpen: true,
  },
  en_curs: {
    label: "En curs",
    color: "text-status-en-curs",
    bgColor: "bg-purple-50",
    defaultOpen: true,
  },
  entregat: {
    label: "Entregats",
    color: "text-status-entregat",
    bgColor: "bg-green-50",
    defaultOpen: true,
  },
  incidencia: {
    label: "Incidència",
    color: "text-status-incidencia",
    bgColor: "bg-orange-50",
    defaultOpen: true,
  },
};

// ── Route generation types ─────────────────────────────────────────────

interface RouteResult {
  stops: Stop[];
  optimized: boolean;
  fullRouteUrl: string | null;
  totalDistanceMeters: number | null;
  totalDurationSeconds: number | null;
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
  const [selectedSheetTab, setSelectedSheetTab] = useState<string | null>(null);
  const [loadingTabs, setLoadingTabs] = useState(false);

  // ── Orden personalizado (drag & drop) ─────────────────────────────────
  const [customOrderIds, setCustomOrderIds] = useState<string[]>([]);
  const [isManualOrder, setIsManualOrder] = useState(false);

  // ── Ruta bajo demanda ─────────────────────────────────────────────────
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [generatingRoute, setGeneratingRoute] = useState(false);

  // Inicializar tab y orden personalizado desde localStorage
  useEffect(() => {
    const saved = getSelectedTab();
    if (saved) setSelectedSheetTab(saved);
    setCustomOrderIds(getCustomOrder());
  }, []);

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
      setSelectedSheetTab(tab);
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
      startLocation = await new Promise((resolve, reject) => {
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
      
      setCustomOrderIds(combinedOrder);
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
    void recordDateAssignment(orderId, newDate);
  };

  return (
    <div className="mx-auto flex min-h-svh max-w-2xl flex-col bg-background pb-20">
      {manifest?.demo && (
        <p className="bg-amber-100 px-4 py-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-amber-800">
          Modo demo · pedidos de ejemplo
        </p>
      )}

      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="flex items-baseline justify-between gap-4 px-4 pb-2.5 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <h1 className="truncate text-lg tracking-tight">{driverName}</h1>
            {todayDate && (
              <p className="text-xs text-muted-foreground first-letter:uppercase">
                {formatLongDate(todayDate)}
              </p>
            )}
            {(selectedSheetTab || manifest?.sheetTab) && (
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                📋 {selectedSheetTab || manifest?.sheetTab}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setMenuOpen((v) => !v);
                if (!menuOpen) void fetchTabs();
              }}
              className="flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-muted"
              aria-label="Menú"
              aria-expanded={menuOpen}
            >
              {menuOpen ? (
                <X className="size-5 text-foreground" />
              ) : (
                <Menu className="size-5 text-foreground" />
              )}
            </button>
          </div>
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
        <div className="animate-fade-in border-b border-border bg-card/95 px-4 py-4 shadow-lg backdrop-blur-md">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
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
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
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
                      "rounded-lg border px-3 py-2.5 text-xs font-medium transition-all",
                      isActive
                        ? "border-foreground bg-foreground text-primary-foreground shadow-sm"
                        : "border-border bg-background text-foreground hover:border-foreground/30 hover:bg-muted",
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
          <p className="py-16 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : !manifest ? (
          <EmptyState online={online} syncing={syncing} />
        ) : (
          <>
            {activeTab === "avui" && (
              <TabAvui
                todayStops={todayStops}
                routeResult={routeResult}
                generatingRoute={generatingRoute}
                online={online}
                isManualOrder={isManualOrder}
                onGenerateRoute={generateRoute}
                onDelivered={handleDelivered}
                onIncident={handleIncident}
                customOrderIds={customOrderIds}
                setCustomOrderIds={setCustomOrderIds}
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
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-border bg-card/95 backdrop-blur-md pb-[max(env(safe-area-inset-bottom),0.5rem)] text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <button
          onClick={() => setActiveTab("avui")}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-1 py-3 transition-colors",
            activeTab === "avui" ? "text-foreground" : "hover:text-foreground/80",
          )}
        >
          <Clock className="size-5" strokeWidth={activeTab === "avui" ? 2.5 : 2} />
          Avui
        </button>
        <button
          onClick={() => setActiveTab("calendari")}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-1 py-3 transition-colors",
            activeTab === "calendari" ? "text-foreground" : "hover:text-foreground/80",
          )}
        >
          <CalendarDays className="size-5" strokeWidth={activeTab === "calendari" ? 2.5 : 2} />
          Calendari
        </button>
        <button
          onClick={() => setActiveTab("historial")}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-1 py-3 transition-colors",
            activeTab === "historial" ? "text-foreground" : "hover:text-foreground/80",
          )}
        >
          <History className="size-5" strokeWidth={activeTab === "historial" ? 2.5 : 2} />
          Historial
        </button>
      </nav>
    </div>
  );
}

// ── Tab: Avui ──────────────────────────────────────────────────────────

function TabAvui({
  todayStops,
  routeResult,
  generatingRoute,
  online,
  isManualOrder,
  onGenerateRoute,
  onDelivered,
  onIncident,
  customOrderIds,
  setCustomOrderIds,
  setRouteResult,
  setIsManualOrder,
}: {
  todayStops: Stop[];
  routeResult: RouteResult | null;
  generatingRoute: boolean;
  online: boolean;
  isManualOrder: boolean;
  onGenerateRoute: () => void;
  onDelivered: (id: string) => void;
  onIncident: (id: string, note: string) => void;
  customOrderIds: string[];
  setCustomOrderIds: (ids: string[]) => void;
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
    setCustomOrderIds(newIds);
    setCustomOrder(newIds);
    setRouteResult(null);
    setIsManualOrder(true);
  }, [todayStops, setCustomOrderIds, setRouteResult, setIsManualOrder]);

  const handleMoveDown = useCallback((index: number) => {
    if (index >= todayStops.length - 1) return;
    const newOrder = [...todayStops];
    const [moved] = newOrder.splice(index, 1);
    newOrder.splice(index + 1, 0, moved);

    const newIds = newOrder.map((s) => s.id);
    setCustomOrderIds(newIds);
    setCustomOrder(newIds);
    setRouteResult(null);
    setIsManualOrder(true);
  }, [todayStops, setCustomOrderIds, setRouteResult, setIsManualOrder]);

  if (todayStops.length === 0) {
    return (
      <div className="animate-rise-in rounded-xl border border-border bg-card px-6 py-12 text-center shadow-sm">
        <p className="text-base">No tens comandes programades per a avui</p>
        <p className="mt-2 text-sm text-muted-foreground">Ves al Calendari per assignar comandes al dia d'avui.</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Repartiment d'avui</h2>
      </div>

      {pendents.length > 0 && (
        <div className="mb-6 animate-rise-in">
          {routeResult ? (
            <RouteSummary route={routeResult} onRecalculate={onGenerateRoute} generating={generatingRoute} />
          ) : (
            <Button
              className="w-full"
              size="touch"
              onClick={() => void onGenerateRoute()}
              disabled={generatingRoute || !online}
            >
              <Route className="size-4" />
              {generatingRoute
                ? "Calculant ruta…"
                : isManualOrder 
                  ? `Calcular ruta (Ordre Manual)` 
                  : `Generar ruta (${pendents.length} parades)`}
            </Button>
          )}
        </div>
      )}

      {enCurs.length > 0 && (
        <div className="mb-6 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-status-en-curs">En Curs</h3>
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
          <h3 className="text-xs font-semibold uppercase tracking-wide text-status-pendent">Pendents</h3>
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
    
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setSelectedDate(null)}>
            ← Tornar
          </Button>
          <h2 className="text-lg font-semibold tracking-tight">
            Repartiment del {selectedDate.split("-").reverse().join("/")}
            {isToday && " (Avui)"}
          </h2>
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comandes Assignades ({assigned.length})</h3>
          {assigned.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hi ha comandes assignades a aquest dia.</p>
          ) : (
            <ul className="space-y-3">
              {assigned.map((stop) => (
                <div key={stop.id} className="relative">
                  <StopCard
                    stop={stop}
                    onDelivered={() => {}} // No-op: los estados solo se marcan en "Avui"
                    onIncident={() => {}} // No-op
                  />
                  {/* Botón para desasignar (volver a la lista) */}
                  <div className="absolute right-3 top-3">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-7 text-[10px] px-2 shadow-sm border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAssignDate(stop.id, null);
                      }}
                    >
                      <X className="size-3 mr-1" />
                      Treure
                    </Button>
                  </div>
                </div>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3 pt-4 border-t border-border">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-status-pendent">Afegir Comanda Ràpid</h3>
          <p className="text-xs text-muted-foreground">Toca per assignar o <strong className="text-foreground">mantén premut</strong> per previsualitzar la comanda.</p>
          {unassignedStops.length === 0 ? (
            <p className="text-sm text-muted-foreground">No et queden comandes pendents d'assignar.</p>
          ) : (
            <FastAssignList stops={unassignedStops} onAssign={(id) => onAssignDate(id, selectedDate)} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={prevMonth}>←</Button>
          <h2 className="text-base font-semibold tracking-tight">
            {MONTH_NAMES[currentMonth.month - 1]} {currentMonth.year}
          </h2>
          <Button variant="ghost" size="sm" onClick={nextMonth}>→</Button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-2 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          {WEEKDAY_NAMES.map(d => <div key={d}>{d}</div>)}
        </div>
        
        <div className="grid grid-cols-7 gap-1">
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
                className={cn(
                  "flex aspect-square flex-col items-center justify-center rounded-lg border transition-colors relative",
                  isCurrentMonth ? "bg-card" : "bg-muted/30 text-muted-foreground/50",
                  isToday ? "border-foreground" : "border-transparent hover:border-border",
                )}
              >
                <span className={cn("text-sm", isToday && "font-bold")}>{dayNum}</span>
                {assignedCount > 0 && (
                  <span className="absolute bottom-1 right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                    {assignedCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold tracking-tight">Bossa de Comandes ({unassignedStops.length})</h2>
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
            className="flex flex-col items-start gap-1 rounded-md border border-border bg-card p-3 text-left shadow-sm transition-colors active:bg-muted select-none touch-none"
          >
            <span className="font-semibold text-sm pointer-events-none truncate w-full">{stop.customer || stop.id}</span>
            <span className="text-xs text-muted-foreground truncate w-full pointer-events-none">{stop.city || "Sense adreça"}</span>
          </button>
        ))}
      </div>

      {previewStop && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in" onClick={() => setPreviewStop(null)}>
          <div className="w-full max-w-md relative" onClick={(e) => e.stopPropagation()}>
            <Button 
              variant="secondary" 
              size="icon" 
              className="absolute -top-12 right-0 rounded-full bg-white/10 hover:bg-white/20 text-white border-0"
              onClick={() => setPreviewStop(null)}
            >
              <X className="size-5" />
            </Button>
            <StopCard stop={previewStop} onDelivered={() => {}} onIncident={() => {}} />
            <Button 
              className="w-full mt-4" 
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
      <div className="flex items-center gap-4 bg-card rounded-xl p-4 shadow-sm border border-border">
        <div className="flex-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Entregats</p>
          <p className="text-2xl font-semibold text-status-entregat">{historyStops.entregat.length}</p>
        </div>
        <div className="w-px h-10 bg-border" />
        <div className="flex-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Incidències</p>
          <p className="text-2xl font-semibold text-status-incidencia">{historyStops.incidencia.length}</p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input 
          type="search"
          placeholder="Cerca per comanda, client o adreça..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-card border border-border rounded-lg pl-9 pr-4 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
        />
      </div>

      <div className="space-y-6">
        {groupedByDate.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            No hi ha resultats a l'historial.
          </p>
        ) : (
          groupedByDate.map(group => (
            <div key={group.date} className="space-y-3">
              <h3 className="text-sm font-semibold tracking-tight text-foreground sticky top-16 bg-background/95 backdrop-blur py-1 z-10 border-b border-border/50">
                {group.date === "Sense data" ? group.date : formatLongDate(group.date)}
              </h3>
              <ul className="space-y-3">
                {group.stops.map((stop) => (
                  <StopCard key={stop.id} stop={stop} onDelivered={onDelivered} onIncident={onIncident} />
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
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            Ruta {route.optimized ? "optimitzada" : "ordre manual"}
          </p>
          <p className="mt-1 text-xl tracking-tight">
            {[distance, duration].filter(Boolean).join(" · ") || "Calculada"}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {route.fullRouteUrl && (
            <Button asChild variant="secondary" size="sm">
              <a href={route.fullRouteUrl} target="_blank" rel="noopener noreferrer">
                <Route className="size-4 mr-1" />
                Obrir Maps
              </a>
            </Button>
          )}
          {onRecalculate && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={onRecalculate} 
              disabled={generating}
              className="text-primary border-primary/20 bg-primary/5 hover:bg-primary/10"
            >
              🔄 {generating ? "Calculant..." : "Recalcular"}
            </Button>
          )}
        </div>
      </div>
      {!route.optimized && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Ruta calculada respectant el teu ordre manual.
        </p>
      )}
    </div>
  );
}

// ── Category Section ───────────────────────────────────────────────────

function CategorySection({
  label,
  color,
  bgColor,
  count,
  open,
  onToggle,
  children,
}: {
  category: StatusCategory;
  label: string;
  color: string;
  bgColor: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="mb-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "mb-3 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors",
          bgColor,
        )}
      >
        <span className={cn("text-xs font-semibold uppercase tracking-wide", color)}>
          {label}
        </span>
        <Badge variant="secondary" className={cn("text-xs", color)}>
          {count}
        </Badge>
        <ChevronDown
          className={cn(
            "ml-auto size-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && <div className="animate-fade-in">{children}</div>}
    </section>
  );
}

// ── Empty state ────────────────────────────────────────────────────────

function EmptyState({ online, syncing }: { online: boolean; syncing: boolean }) {
  if (syncing) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Descarregant...
      </p>
    );
  }

  return (
    <div className="animate-rise-in rounded-xl border border-border bg-card px-6 py-12 text-center shadow-sm">
      <p className="text-base">
        {online ? "Encara no hi ha dades" : "Sense dades descarregades"}
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {online
          ? "Selecciona una fulla del menú ☰ y prem Actualitzar."
          : "Connecta't a internet una vegada per descarregar les dades."}
      </p>
    </div>
  );
}
