"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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

  /*
   * Título grande de iOS: se ve entero arriba del todo y, al desplazar, se
   * pliega en la barra fija. El observador vigila el propio <h1>: cuando
   * pasa por detrás de la barra (de ahí el margen negativo, que es su
   * altura aproximada), el nombre reaparece arriba en pequeño.
   */
  const largeTitle = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = largeTitle.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry.isIntersecting),
      { rootMargin: "-88px 0px 0px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
        // Texto negro sobre el naranja del sistema: en blanco no hay
        // contraste suficiente y este aviso tiene que leerse sí o sí.
        <p className="bg-warning px-4 py-1 text-center text-xs font-semibold text-black">
          Modo demo · pedidos de ejemplo
        </p>
      )}

      <header
        className={cn(
          "material sticky top-0 z-10 pt-[env(safe-area-inset-top)] transition-[border-color] duration-200",
          // El separador de la barra solo aparece cuando hay contenido
          // pasando por debajo: es el "borde de scroll" de iOS.
          collapsed ? "border-b border-border" : "border-b border-transparent",
        )}
      >
        <div className="flex h-11 items-center gap-3 px-4">
          {/* Contrapeso del contador: mantiene el título centrado de verdad,
              como la barra de navegación de iOS. */}
          {total > 0 && <span className="w-7 shrink-0" aria-hidden />}
          <p
            className={cn(
              "min-w-0 flex-1 truncate text-center text-base font-semibold transition-opacity duration-200",
              collapsed ? "opacity-100" : "opacity-0",
            )}
            aria-hidden={!collapsed}
          >
            {driverName}
          </p>
          {total > 0 && (
            <p
              className={cn(
                "shrink-0 text-sm tabular-nums text-muted-foreground transition-opacity duration-200",
                collapsed ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            >
              {closed.length}/{total}
            </p>
          )}
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

      <main className="flex-1 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-3">
        <h1 ref={largeTitle} className="text-3xl font-bold">
          {driverName}
        </h1>
        {todayRoute && (
          // `capitalize` pondría mayúscula en cada palabra ("4 De Agosto");
          // solo queremos la inicial de la frase.
          <p className="mt-0.5 text-sm text-muted-foreground first-letter:uppercase">
            {formatLongDate(todayRoute.date)}
            {total > 0 && ` · ${closed.length} de ${total} entregadas`}
          </p>
        )}

        {total > 0 && (
          <div
            className="mt-3 h-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={closed.length}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-label="Progreso de la jornada"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${(closed.length / total) * 100}%` }}
            />
          </div>
        )}

        <div className="mt-5">
          {loading ? (
            <p className="py-16 text-center text-base text-muted-foreground">
              Cargando…
            </p>
          ) : !manifest ? (
            <EmptyState online={online} syncing={syncing} />
          ) : (
            <>
              {todayRoute && <RouteSummary route={todayRoute} />}

              {pending.length === 0 ? (
                <div className="animate-rise-in rounded-xl bg-card px-6 py-12 text-center">
                  <p className="text-base font-medium">
                    {total === 0
                      ? "Hoy no tienes pedidos asignados"
                      : "Jornada completada"}
                  </p>
                  {total > 0 && (
                    <p className="mt-1 text-sm text-muted-foreground">
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
                  {/* Lista agrupada de iOS: un solo bloque, con las filas
                      separadas por una línea de medio píxel. */}
                  <ul className="overflow-hidden rounded-xl bg-card">
                    {manifest.tomorrow.stops.map((stop) => (
                      <TomorrowRow key={stop.id} stop={stop} />
                    ))}
                  </ul>
                </Section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function RouteSummary({ route }: { route: RouteDay }) {
  const distance = formatDistance(route.totalDistanceMeters);
  const duration = formatDuration(route.totalDurationSeconds);
  if (!distance && !duration && !route.fullRouteUrl) return null;

  return (
    <div className="mb-3 animate-rise-in rounded-xl bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Ruta de hoy</p>
          <p className="mt-0.5 text-xl font-semibold">
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
        <p className="mt-3 rounded-lg bg-warning-surface px-3 py-2 text-sm text-warning-foreground">
          No se ha podido calcular la ruta óptima. El orden mostrado es el de
          prioridad del listado.
        </p>
      )}
    </div>
  );
}

function TomorrowRow({ stop }: { stop: Stop }) {
  return (
    <li className="px-4 py-3 [&+li]:hairline">
      <p className="text-base font-medium">{stop.customer || stop.address}</p>
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
    <section className="mt-7">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="pressable mb-2 flex w-full items-center gap-1.5 px-1 py-1 text-left"
      >
        <span className="text-sm font-semibold text-muted-foreground">
          {title}
        </span>
        <span className="text-sm tabular-nums text-tertiary-foreground">
          {count}
        </span>
        <ChevronDown
          className={cn(
            "ml-auto size-5 text-tertiary-foreground transition-transform duration-300",
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
      <p className="py-16 text-center text-base text-muted-foreground">
        Descargando tu ruta…
      </p>
    );
  }

  return (
    <div className="animate-rise-in rounded-xl bg-card px-6 py-12 text-center">
      <p className="text-base font-medium">
        {online ? "Todavía no hay datos" : "Sin datos descargados"}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {online
          ? "Pulsa Actualizar para descargar la ruta de hoy."
          : "Conéctate a internet una vez para descargar la ruta. Después podrás trabajar sin cobertura."}
      </p>
    </div>
  );
}
