"use client";

import { CalendarDays, CheckCircle2, Inbox, Route, TriangleAlert } from "lucide-react";
import { formatDistance, formatDuration } from "@/lib/format";

/**
 * Resumen del día, arriba de la pestaña "Avui".
 *
 * Sigue la composición de la referencia de diseño —tarjeta destacada con la
 * acción principal, tarjeta de cifras y parrilla de accesos— pero con los
 * datos del reparto en vez de saldos y servicios.
 *
 * Todo lo que muestra sale del manifiesto que ya está en IndexedDB, así que
 * se ve igual sin cobertura.
 */

interface Props {
  pendents: number;
  enCurs: number;
  entregats: number;
  incidencies: number;
  sensAssignar: number;
  /** Kilómetros y minutos de la ruta, si ya se ha calculado. */
  totalDistanceMeters: number | null;
  totalDurationSeconds: number | null;
  rutaCalculada: boolean;
  generandoRuta: boolean;
  online: boolean;
  onGenerarRuta: () => void;
  onIr: (destino: "calendari" | "historial") => void;
}

export default function HomeSummary({
  pendents,
  enCurs,
  entregats,
  incidencies,
  sensAssignar,
  totalDistanceMeters,
  totalDurationSeconds,
  rutaCalculada,
  generandoRuta,
  online,
  onGenerarRuta,
  onIr,
}: Props) {
  const porRepartir = pendents + enCurs;
  const total = porRepartir + entregats + incidencies;
  // Sin ningún pedido no hay nada que resumir: la pestaña ya enseña su
  // propio mensaje de "no tienes pedidos".
  if (total === 0) return null;

  const hechos = entregats + incidencies;
  const porcentaje = total > 0 ? Math.round((hechos / total) * 100) : 0;
  const ruta = [formatDistance(totalDistanceMeters), formatDuration(totalDurationSeconds)]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4">
      {/* ── Acción principal del día ─────────────────────────────────── */}
      {porRepartir > 0 && (
        <div className="soft-card relative overflow-hidden bg-[color-mix(in_srgb,var(--primary)_8%,var(--card))] p-5">
          <div className="relative z-10 max-w-[58%]">
            <span className="inline-block rounded-full bg-card px-2.5 py-1 text-[11px] font-semibold text-primary">
              {porRepartir} {porRepartir === 1 ? "parada" : "parades"}
            </span>
            <h2 className="mt-2.5 text-[19px] font-bold leading-tight">
              Ruta d&apos;avui
            </h2>
            <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
              En l&apos;ordre més curt
            </p>
            {ruta && <p className="mt-0.5 text-[13px] font-medium">{ruta}</p>}

            <button
              type="button"
              onClick={onGenerarRuta}
              disabled={generandoRuta || !online}
              className="pressable mt-3.5 inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
            >
              <Route className="size-4" aria-hidden />
              {generandoRuta
                ? "Calculant…"
                : rutaCalculada
                  ? "Recalcular"
                  : "Generar ruta"}
            </button>
            {!online && (
              <p className="mt-2 text-xs text-muted-foreground">
                Necessites cobertura per calcular-la.
              </p>
            )}
          </div>
          <FurgonetaIlustracion />
        </div>
      )}

      {/* ── Cifras del día ───────────────────────────────────────────── */}
      <div className="soft-card p-5">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-muted-foreground">Avui</p>
          <span className="rounded-full bg-[color-mix(in_srgb,var(--success)_14%,transparent)] px-2.5 py-1 text-xs font-semibold text-[var(--success)]">
            {porcentaje}% fet
          </span>
        </div>

        <p className="mt-1 text-4xl font-bold tracking-tight">
          {porRepartir}
          <span className="ml-2 align-middle text-base font-medium text-muted-foreground">
            {porRepartir === 1 ? "per repartir" : "per repartir"}
          </span>
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
          <Cifra
            icono={<CheckCircle2 className="size-4" aria-hidden />}
            tono="success"
            etiqueta="Entregades"
            valor={entregats}
          />
          <Cifra
            icono={<TriangleAlert className="size-4" aria-hidden />}
            tono="warning"
            etiqueta="Incidències"
            valor={incidencies}
          />
        </div>
      </div>

      {/* ── Accesos rápidos ──────────────────────────────────────────── */}
      <div>
        <h3 className="mb-3 text-base font-semibold">Accessos</h3>
        <div className="grid grid-cols-3 gap-3">
          <Acceso
            icono={<Inbox className="size-6" aria-hidden />}
            etiqueta="Sense assignar"
            insignia={sensAssignar}
            onClick={() => onIr("calendari")}
          />
          <Acceso
            icono={<CalendarDays className="size-6" aria-hidden />}
            etiqueta="Calendari"
            onClick={() => onIr("calendari")}
          />
          <Acceso
            icono={<CheckCircle2 className="size-6" aria-hidden />}
            etiqueta="Historial"
            insignia={incidencies}
            onClick={() => onIr("historial")}
          />
        </div>
      </div>
    </div>
  );
}

function Cifra({
  icono,
  tono,
  etiqueta,
  valor,
}: {
  icono: React.ReactNode;
  tono: "success" | "warning";
  etiqueta: string;
  valor: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full"
        style={{
          background: `color-mix(in srgb, var(--${tono}) 14%, transparent)`,
          color: `var(--${tono})`,
        }}
        aria-hidden
      >
        {icono}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{etiqueta}</p>
        <p className="text-lg font-semibold leading-tight">{valor}</p>
      </div>
    </div>
  );
}

function Acceso({
  icono,
  etiqueta,
  insignia,
  onClick,
}: {
  icono: React.ReactNode;
  etiqueta: string;
  insignia?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable soft-card relative flex flex-col items-center gap-2 px-2 py-4 text-center"
    >
      <span className="text-primary" aria-hidden>
        {icono}
      </span>
      <span className="text-xs font-medium leading-tight">{etiqueta}</span>
      {insignia !== undefined && insignia > 0 && (
        <span className="absolute right-2 top-2 flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
          {insignia}
        </span>
      )}
    </button>
  );
}

/** Furgoneta de fondo de la tarjeta principal. Decorativa. */
function FurgonetaIlustracion() {
  return (
    <svg
      width="150"
      height="110"
      viewBox="0 0 150 110"
      fill="none"
      aria-hidden
      className="pointer-events-none absolute -bottom-2 -right-3 opacity-90"
    >
      <rect x="14" y="34" width="62" height="40" rx="6" fill="#f2701d" />
      <path
        d="M76 46h21c1.8 0 3.5.9 4.6 2.3l8.6 11.3c.7 1 1.1 2.1 1.1 3.3V74H76V46Z"
        fill="#2b2b31"
      />
      <path d="M81 51h15l7 9H81v-9Z" fill="#cfe6f5" />
      <rect x="14" y="74" width="97" height="5" rx="2.5" fill="#2b2b31" opacity="0.85" />
      <circle cx="36" cy="81" r="10" fill="#2b2b31" />
      <circle cx="36" cy="81" r="4" fill="#d7d7dc" />
      <circle cx="93" cy="81" r="10" fill="#2b2b31" />
      <circle cx="93" cy="81" r="4" fill="#d7d7dc" />
      {/* Cajas encima */}
      <rect x="26" y="16" width="20" height="16" rx="2" fill="#e8a86b" />
      <rect x="50" y="10" width="24" height="22" rx="2" fill="#f0bd82" />
    </svg>
  );
}
