"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, Route } from "lucide-react";
import { db } from "@/lib/db";
import { recordDelivery, syncNow, SessionExpiredError } from "@/lib/sync";
import { formatDistance, formatDuration } from "@/lib/format";
import { formatLongDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { RouteDay, Stop } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import StopCard from "./stop-card";
import SyncBar from "./sync-bar";

/**
 * Suscripción al estado de conexión del navegador.
 *
 * Se usa con `useSyncExternalStore` en vez de un `useEffect` + `setState`:
 * el valor inicial se lee directamente de `navigator.onLine` en el primer
 * render, sin provocar un segundo renderizado en cascada.
 */
function subscribeToConnectivity(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Pantalla principal.
 *
 * Lee exclusivamente de IndexedDB mediante `useLiveQuery`, de modo que
 * cualquier cambio local (marcar una entrega) se refleja al instante y sin
 * pasar por la red. La sincronización ocurre aparte, en segundo plano.
 */
export default function Dashboard({ driverName }: { driverName: string }) {
  const router = useRouter();

  // Se envuelve el resultado en un objeto para poder distinguir "todavía
  // consultando IndexedDB" (undefined) de "consultado y no hay nada"
  // ({ value: undefined }). Sin esto, un móvil sin datos descargados se
  // quedaría en "Cargando…" para siempre.
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
    // En el servidor se asume conectado: es lo que verá el usuario en el
    // primer pintado, antes de que el navegador pueda opinar.
    () => true,
  );
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTomorrow, setShowTomorrow] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const outcome = await syncNow();
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
  }, [router]);

  // Sincroniza al abrir, al recuperar cobertura y al volver a la app.
  // Son los tres momentos en los que puede haber algo nuevo que enviar o
  // recibir, y cubrirlos evita tener que pedirle nada al transportista.
  useEffect(() => {
    // Se lanza fuera del ciclo de render (no de forma síncrona dentro del
    // efecto) para no encadenar un segundo renderizado con el primero.
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
  const todayRoute = manifest?.today;
  const pending = (todayRoute?.stops ?? []).filter((s) => s.status === "pendiente");
  const closed = (todayRoute?.stops ?? []).filter((s) => s.status !== "pendiente");
  const total = (todayRoute?.stops ?? []).length;

  const handleDelivered = (orderId: string) => {
    void recordDelivery(orderId, "entregado");
  };
  const handleIncident = (orderId: string, note: string) => {
    void recordDelivery(orderId, "incidencia", note || null);
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
            {/* `capitalize` pondría mayúscula en cada palabra ("4 De
                Agosto"); solo queremos la inicial de la frase. */}
            {todayRoute && (
              <p className="text-xs text-muted-foreground first-letter:uppercase">
                {formatLongDate(todayRoute.date)}
              </p>
            )}
          </div>
          {total > 0 && (
            <p className="shrink-0 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{closed.length}</span>
              /{total}
            </p>
          )}
        </div>

        {total > 0 && (
          <div
            className="mx-4 mb-2 h-0.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={closed.length}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-label="Progreso de la jornada"
          >
            <div
              className="h-full bg-foreground transition-all duration-500"
              style={{ width: `${(closed.length / total) * 100}%` }}
            />
          </div>
        )}

        <SyncBar
          online={online}
          syncing={syncing}
          savedAt={stored?.savedAt ?? null}
          pendingCount={pendingCount}
          error={error}
          onSync={() => void sync()}
        />
      </header>

      <main className="flex-1 px-4 py-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {loading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : !manifest ? (
          <EmptyState online={online} syncing={syncing} />
        ) : (
          <>
            {todayRoute && <RouteSummary route={todayRoute} />}

            {pending.length === 0 ? (
              <div className="animate-rise-in rounded-xl border border-border bg-card px-6 py-12 text-center shadow-sm">
                <p className="text-base">
                  {total === 0
                    ? "Hoy no tienes pedidos asignados"
                    : "Jornada completada"}
                </p>
                {total > 0 && (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {total} {total === 1 ? "parada cerrada" : "paradas cerradas"}
                  </p>
                )}
              </div>
            ) : (
              <ul className="space-y-3">
                {pending.map((stop) => (
                  <StopCard
                    key={stop.id}
                    stop={stop}
                    onDelivered={handleDelivered}
                    onIncident={handleIncident}
                  />
                ))}
              </ul>
            )}

            {closed.length > 0 && (
              <Section
                title="Cerrados hoy"
                count={closed.length}
                open={showDone}
                onToggle={() => setShowDone((v) => !v)}
              >
                <ul className="space-y-3">
                  {closed.map((stop) => (
                    <StopCard
                      key={stop.id}
                      stop={stop}
                      onDelivered={handleDelivered}
                      onIncident={handleIncident}
                    />
                  ))}
                </ul>
              </Section>
            )}

            {manifest.tomorrow && manifest.tomorrow.stops.length > 0 && (
              <Section
                title="Mañana"
                count={manifest.tomorrow.stops.length}
                open={showTomorrow}
                onToggle={() => setShowTomorrow((v) => !v)}
              >
                <ul className="space-y-2">
                  {manifest.tomorrow.stops.map((stop) => (
                    <TomorrowRow key={stop.id} stop={stop} />
                  ))}
                </ul>
              </Section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function RouteSummary({ route }: { route: RouteDay }) {
  const distance = formatDistance(route.totalDistanceMeters);
  const duration = formatDuration(route.totalDurationSeconds);
  if (!distance && !duration && !route.fullRouteUrl) return null;

  return (
    <div className="mb-3 animate-rise-in rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Ruta de hoy
          </p>
          <p className="mt-1 text-xl tracking-tight">
            {[distance, duration].filter(Boolean).join(" · ") || "Sin calcular"}
          </p>
        </div>
        {route.fullRouteUrl && (
          <Button asChild variant="secondary" size="sm">
            <a href={route.fullRouteUrl} target="_blank" rel="noopener noreferrer">
              <Route />
              Abrir ruta
            </a>
          </Button>
        )}
      </div>
      {!route.optimized && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No se ha podido calcular la ruta óptima. El orden mostrado es el de
          prioridad del listado.
        </p>
      )}
    </div>
  );
}

function TomorrowRow({ stop }: { stop: Stop }) {
  return (
    <li className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm">
      <p className="font-medium">{stop.customer || stop.address}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{stop.address}</p>
    </li>
  );
}

function Section({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="mb-3 flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-muted"
      >
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <Badge variant="secondary">{count}</Badge>
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

function EmptyState({ online, syncing }: { online: boolean; syncing: boolean }) {
  if (syncing) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Descargando tu ruta…
      </p>
    );
  }

  return (
    <div className="animate-rise-in rounded-xl border border-border bg-card px-6 py-12 text-center shadow-sm">
      <p className="text-base">
        {online ? "Todavía no hay datos" : "Sin datos descargados"}
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {online
          ? "Pulsa Actualizar para descargar la ruta de hoy."
          : "Conéctate a internet una vez para descargar la ruta. Después podrás trabajar sin cobertura."}
      </p>
    </div>
  );
}
