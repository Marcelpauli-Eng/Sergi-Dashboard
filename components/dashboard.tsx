"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ChevronDown,
  GripVertical,
  Menu,
  Route,
  X,
} from "lucide-react";
import { db } from "@/lib/db";
import {
  recordDelivery,
  syncNow,
  SessionExpiredError,
  getSelectedTab,
  setSelectedTab,
  getCustomOrder,
  setCustomOrder,
  applyCustomOrder,
} from "@/lib/sync";
import { formatDistance, formatDuration } from "@/lib/format";
import { formatLongDate } from "@/lib/dates";
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
    defaultOpen: false,
  },
  incidencia: {
    label: "Incidència",
    color: "text-status-incidencia",
    bgColor: "bg-orange-50",
    defaultOpen: false,
  },
};

const CATEGORY_ORDER: StatusCategory[] = ["pendent", "en_curs", "entregat", "incidencia"];

// ── Route generation types ─────────────────────────────────────────────

interface RouteResult {
  stops: Stop[];
  optimized: boolean;
  fullRouteUrl: string | null;
  totalDistanceMeters: number | null;
  totalDurationSeconds: number | null;
}

// ── Main Dashboard ─────────────────────────────────────────────────────

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

  // ── Menú hamburguesa & selector de pestaña ────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  const [selectedTab, setSelectedTabState] = useState<string | null>(null);
  const [loadingTabs, setLoadingTabs] = useState(false);

  // ── Secciones colapsables ─────────────────────────────────────────────
  const [openSections, setOpenSections] = useState<Record<StatusCategory, boolean>>({
    pendent: true,
    en_curs: true,
    entregat: false,
    incidencia: false,
  });

  // ── Orden personalizado (drag & drop) ─────────────────────────────────
  const [customOrderIds, setCustomOrderIds] = useState<string[]>([]);

  // ── Ruta bajo demanda ─────────────────────────────────────────────────
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [generatingRoute, setGeneratingRoute] = useState(false);

  // Inicializar tab y orden personalizado desde localStorage
  useEffect(() => {
    const saved = getSelectedTab();
    if (saved) setSelectedTabState(saved);
    setCustomOrderIds(getCustomOrder());
  }, []);

  // Cargar pestañas del Sheet cuando se abre el menú
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
      setSelectedTabState(tab);
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
      const outcome = await syncNow(selectedTab ?? undefined);
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
  }, [router, selectedTab]);

  // Sincroniza al abrir, al recuperar cobertura y al volver a la app.
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
  const allStops = manifest?.today?.stops ?? [];

  // Agrupar stops por categoría
  const grouped = useMemo(() => {
    const groups: Record<StatusCategory, Stop[]> = {
      pendent: [],
      en_curs: [],
      entregat: [],
      incidencia: [],
    };
    for (const stop of allStops) {
      const cat = (stop.statusCategory ?? "pendent") as StatusCategory;
      if (groups[cat]) {
        groups[cat].push(stop);
      } else {
        groups.pendent.push(stop);
      }
    }
    // Aplicar orden personalizado solo a pendientes
    groups.pendent = applyCustomOrder(groups.pendent, customOrderIds);
    return groups;
  }, [allStops, customOrderIds]);

  const totalPendent = grouped.pendent.length;

  // ── Drag & drop handlers ──────────────────────────────────────────────
  const dragItemRef = useRef<number | null>(null);
  const dragOverItemRef = useRef<number | null>(null);

  const handleDragStart = useCallback((index: number) => {
    dragItemRef.current = index;
  }, []);

  const handleDragOver = useCallback((index: number) => {
    dragOverItemRef.current = index;
  }, []);

  const handleDragEnd = useCallback(() => {
    const from = dragItemRef.current;
    const to = dragOverItemRef.current;
    if (from === null || to === null || from === to) {
      dragItemRef.current = null;
      dragOverItemRef.current = null;
      return;
    }

    const newOrder = [...grouped.pendent];
    const [moved] = newOrder.splice(from, 1);
    newOrder.splice(to, 0, moved);

    const newIds = newOrder.map((s) => s.id);
    setCustomOrderIds(newIds);
    setCustomOrder(newIds);
    setRouteResult(null); // Reset route when order changes

    dragItemRef.current = null;
    dragOverItemRef.current = null;
  }, [grouped.pendent]);

  // ── Touch drag handlers ───────────────────────────────────────────────
  const touchStartY = useRef<number>(0);
  const touchDragIdx = useRef<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const handleTouchStart = useCallback((index: number, e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchDragIdx.current = index;
    dragItemRef.current = index;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchDragIdx.current === null || !listRef.current) return;
    e.preventDefault();

    const y = e.touches[0].clientY;
    const items = listRef.current.querySelectorAll("[data-drag-item]");
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) {
        dragOverItemRef.current = i;

        // Visual feedback
        items.forEach((el) => el.classList.remove("drag-over"));
        if (i !== touchDragIdx.current) {
          items[i].classList.add("drag-over");
        }
        break;
      }
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (listRef.current) {
      listRef.current.querySelectorAll("[data-drag-item]").forEach((el) => {
        el.classList.remove("drag-over");
      });
    }
    touchDragIdx.current = null;
    handleDragEnd();
  }, [handleDragEnd]);

  // ── Generar ruta bajo demanda ─────────────────────────────────────────
  const generateRoute = useCallback(async () => {
    if (grouped.pendent.length === 0) return;
    setGeneratingRoute(true);
    try {
      const res = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: grouped.pendent.map((s) => s.id),
          sheetTab: selectedTab ?? undefined,
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

      // Actualizar el orden con el de la ruta optimizada
      const newIds = result.stops.map((s) => s.id);
      setCustomOrderIds(newIds);
      setCustomOrder(newIds);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error generando la ruta");
    } finally {
      setGeneratingRoute(false);
    }
  }, [grouped.pendent, selectedTab, router]);

  const handleDelivered = (orderId: string) => {
    void recordDelivery(orderId, "entregado");
  };
  const handleIncident = (orderId: string, note: string) => {
    void recordDelivery(orderId, "incidencia", note || null);
  };

  const toggleSection = (cat: StatusCategory) => {
    setOpenSections((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  return (
    <div className="mx-auto flex min-h-svh max-w-2xl flex-col">
      {manifest?.demo && (
        <p className="bg-amber-100 px-4 py-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-amber-800">
          Modo demo · pedidos de ejemplo
        </p>
      )}

      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="flex items-baseline justify-between gap-4 px-4 pb-2.5 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <h1 className="truncate text-lg tracking-tight">{driverName}</h1>
            {manifest?.today && (
              <p className="text-xs text-muted-foreground first-letter:uppercase">
                {formatLongDate(manifest.today.date)}
              </p>
            )}
            {(selectedTab || manifest?.sheetTab) && (
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                📋 {selectedTab || manifest?.sheetTab}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {allStops.length > 0 && (
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {grouped.entregat.length}
                </span>
                /{allStops.length}
              </p>
            )}

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
                  tab === selectedTab ||
                  (!selectedTab && tab === manifest?.sheetTab);
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

      <main className="flex-1 px-4 py-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {loading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : !manifest ? (
          <EmptyState online={online} syncing={syncing} />
        ) : allStops.length === 0 ? (
          <div className="animate-rise-in rounded-xl border border-border bg-card px-6 py-12 text-center shadow-sm">
            <p className="text-base">No hay pedidos en esta hoja</p>
          </div>
        ) : (
          <>
            {/* ── Botón generar ruta (solo si hay pendientes) ─────────── */}
            {totalPendent > 0 && (
              <div className="mb-4 animate-rise-in">
                {routeResult ? (
                  <RouteSummary route={routeResult} />
                ) : (
                  <Button
                    className="w-full"
                    size="touch"
                    onClick={() => void generateRoute()}
                    disabled={generatingRoute || !online}
                  >
                    <Route className="size-4" />
                    {generatingRoute
                      ? "Calculant ruta…"
                      : `Generar ruta (${totalPendent} parades)`}
                  </Button>
                )}
              </div>
            )}

            {/* ── Secciones por categoría ─────────────────────────────── */}
            {CATEGORY_ORDER.map((cat) => {
              const stops = grouped[cat];
              if (stops.length === 0) return null;
              const config = CATEGORY_CONFIG[cat];
              const isOpen = openSections[cat];

              return (
                <CategorySection
                  key={cat}
                  category={cat}
                  label={config.label}
                  color={config.color}
                  bgColor={config.bgColor}
                  count={stops.length}
                  open={isOpen}
                  onToggle={() => toggleSection(cat)}
                >
                  {cat === "pendent" ? (
                    <ul ref={listRef} className="space-y-3">
                      {stops.map((stop, index) => (
                        <li
                          key={stop.id}
                          data-drag-item
                          draggable
                          onDragStart={() => handleDragStart(index)}
                          onDragOver={(e) => {
                            e.preventDefault();
                            handleDragOver(index);
                          }}
                          onDragEnd={handleDragEnd}
                          onTouchStart={(e) => handleTouchStart(index, e)}
                          onTouchMove={handleTouchMove}
                          onTouchEnd={handleTouchEnd}
                          className="transition-transform"
                        >
                          <StopCard
                            stop={{
                              ...stop,
                              sequence: index + 1,
                              legDistanceMeters:
                                routeResult?.stops.find((s) => s.id === stop.id)
                                  ?.legDistanceMeters ?? null,
                              legDurationSeconds:
                                routeResult?.stops.find((s) => s.id === stop.id)
                                  ?.legDurationSeconds ?? null,
                            }}
                            onDelivered={handleDelivered}
                            onIncident={handleIncident}
                            draggable
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="space-y-3">
                      {stops.map((stop) => (
                        <StopCard
                          key={stop.id}
                          stop={stop}
                          onDelivered={handleDelivered}
                          onIncident={handleIncident}
                        />
                      ))}
                    </ul>
                  )}
                </CategorySection>
              );
            })}
          </>
        )}
      </main>
    </div>
  );
}

// ── Route Summary (solo cuando se ha generado) ─────────────────────────

function RouteSummary({ route }: { route: RouteResult }) {
  const distance = formatDistance(route.totalDistanceMeters);
  const duration = formatDuration(route.totalDurationSeconds);

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Ruta {route.optimized ? "optimitzada" : "per prioritat"}
          </p>
          <p className="mt-1 text-xl tracking-tight">
            {[distance, duration].filter(Boolean).join(" · ") || "Calculada"}
          </p>
        </div>
        {route.fullRouteUrl && (
          <Button asChild variant="secondary" size="sm">
            <a href={route.fullRouteUrl} target="_blank" rel="noopener noreferrer">
              <Route className="size-4" />
              Obrir
            </a>
          </Button>
        )}
      </div>
      {!route.optimized && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No s&apos;ha pogut calcular la ruta òptima. L&apos;ordre mostrat és el de prioritat.
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
        Descarregant la teva ruta…
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
          ? "Selecciona una fulla del menú ☰ i prem Actualitzar."
          : "Connecta't a internet una vegada per descarregar la ruta. Després podràs treballar sense cobertura."}
      </p>
    </div>
  );
}
