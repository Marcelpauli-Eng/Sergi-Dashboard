"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { recordDelivery, syncNow, SessionExpiredError } from "@/lib/sync";
import { formatDistance, formatDuration } from "@/lib/format";
import { formatLongDate } from "@/lib/dates";
import type { RouteDay, Stop } from "@/lib/types";
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
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      {manifest?.demo && (
        <p className="bg-warn px-4 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-white">
          Modo demo · pedidos de ejemplo
        </p>
      )}

      <header className="sticky top-0 z-10 bg-surface shadow-sm">
        <div className="flex items-baseline justify-between gap-4 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-ink">{driverName}</h1>
            {/* `capitalize` pondría mayúscula en cada palabra ("4 De
                Agosto"); solo queremos la inicial de la frase. */}
            {todayRoute && (
              <p className="text-sm text-muted first-letter:uppercase">
                {formatLongDate(todayRoute.date)}
              </p>
            )}
          </div>
          {total > 0 && (
            <p className="shrink-0 text-sm font-semibold text-muted">
              {closed.length}/{total}
            </p>
          )}
        </div>

        {total > 0 && (
          <div
            className="h-1 w-full bg-line"
            role="progressbar"
            aria-valuenow={closed.length}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-label="Progreso de la jornada"
          >
            <div
              className="h-full bg-ok transition-all duration-300"
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

      <main className="flex-1 px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {loading ? (
          <p className="py-16 text-center text-muted">Cargando…</p>
        ) : !manifest ? (
          <EmptyState online={online} syncing={syncing} />
        ) : (
          <>
            {todayRoute && <RouteSummary route={todayRoute} />}

            {pending.length === 0 ? (
              <p className="rounded-2xl border border-line bg-surface px-4 py-10 text-center text-lg font-semibold text-ok">
                {total === 0
                  ? "Hoy no tienes pedidos asignados"
                  : "¡Jornada completada!"}
              </p>
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
                title={`Cerrados hoy (${closed.length})`}
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
                title={`Mañana (${manifest.tomorrow.stops.length})`}
                open={showTomorrow}
                onToggle={() => setShowTomorrow((v) => !v)}
              >
                <ul className="space-y-3">
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
    <div className="mb-4 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Ruta de hoy</p>
          <p className="text-lg font-semibold text-ink">
            {[distance, duration].filter(Boolean).join(" · ") || "Sin calcular"}
          </p>
        </div>
        {route.fullRouteUrl && (
          <a
            href={route.fullRouteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white active:bg-brand-strong"
          >
            Abrir ruta
          </a>
        )}
      </div>
      {!route.optimized && (
        <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          No se ha podido calcular la ruta óptima. El orden mostrado es el de
          prioridad del listado.
        </p>
      )}
    </div>
  );
}

function TomorrowRow({ stop }: { stop: Stop }) {
  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <p className="font-semibold text-ink">{stop.customer || stop.address}</p>
      <p className="mt-0.5 text-[15px] text-muted">{stop.address}</p>
    </li>
  );
}

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
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
        className="mb-3 flex w-full items-center justify-between rounded-xl px-1 py-2 text-left"
      >
        <span className="text-sm font-bold uppercase tracking-wide text-muted">
          {title}
        </span>
        <span className="text-muted" aria-hidden>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && children}
    </section>
  );
}

function EmptyState({ online, syncing }: { online: boolean; syncing: boolean }) {
  if (syncing) {
    return <p className="py-16 text-center text-muted">Descargando tu ruta…</p>;
  }

  return (
    <div className="rounded-2xl border border-line bg-surface px-6 py-12 text-center">
      <p className="text-lg font-semibold text-ink">
        {online ? "Todavía no hay datos" : "Sin datos descargados"}
      </p>
      <p className="mt-2 text-muted">
        {online
          ? "Pulsa Actualizar para descargar la ruta de hoy."
          : "Conéctate a internet una vez para descargar la ruta. Después podrás trabajar sin cobertura."}
      </p>
    </div>
  );
}
