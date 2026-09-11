"use client";

import { useMemo } from "react";
import Image from "next/image";
import {
  CalendarDays,
  CheckCircle2,
  Coins,
  FileText,
  Inbox,
  MapPin,
  Route,
  TriangleAlert,
} from "lucide-react";
import { formatDistance, formatDuration } from "@/lib/format";
import { euros } from "@/lib/factura";
import type { Stop } from "@/lib/types";

/**
 * Resumen del día, arriba de la pestaña "Avui".
 *
 * Tres preguntas, en el orden en que se hacen a lo largo del día: qué me
 * queda por repartir, cómo voy hoy, y cuánto llevo en el full. Debajo, los
 * accesos a lo que da trabajo al día.
 *
 * Todo sale del manifiesto que ya está en IndexedDB: ni una llamada más a
 * Google, así que se ve igual sin cobertura y no gasta cuota.
 */

interface Props {
  /** Las de hoy que siguen abiertas: pendents i en curs. */
  todayStops: Stop[];
  /** TODAS las entregadas del full, no solo las de hoy. */
  entregats: Stop[];
  /** TODAS las incidencias del full. */
  incidencies: Stop[];
  /** El día que el servidor considera hoy, para separar hoy del resto del full. */
  avui: string;
  sensAssignar: number;
  /** Cuántas llamadas quedan del día que toca llamar (normalmente demà). */
  /** Kilómetros y minutos de la ruta, si ya se ha calculado. */
  totalDistanceMeters: number | null;
  totalDurationSeconds: number | null;
  rutaCalculada: boolean;
  generandoRuta: boolean;
  online: boolean;
  onGenerarRuta: () => void;
  onIr: (destino: "calendari" | "historial" | "factures") => void;
}

export default function HomeSummary({
  todayStops,
  entregats,
  incidencies,
  avui,
  sensAssignar,
  totalDistanceMeters,
  totalDurationSeconds,
  rutaCalculada,
  generandoRuta,
  online,
  onGenerarRuta,
  onIr,
}: Props) {
  const dades = useMemo(() => {
    const pendents = todayStops.filter((s) => s.statusCategory === "pendent");
    const enCurs = todayStops.filter((s) => s.statusCategory === "en_curs");

    /*
      Una comanda entregada lleva en `date` el día en que se entregó: al dar
      por entregada una parada, la app escribe el momento real en la misma
      columna "Data entrega" donde el calendario había dejado la fecha
      prevista. Por eso basta con comparar esa fecha para separar lo de hoy
      del resto del full, sin bajar nada más.

      Importa hacerlo: antes esta tarjeta ponía "Avui" encima del recuento
      del mes entero, así que después de un mes de reparto decía que hoy
      habías hecho setenta entregas.
    */
    const esDAvui = (s: Stop) => s.date === avui;
    const entregatsAvui = entregats.filter(esDAvui);
    const incidenciesAvui = incidencies.filter(esDAvui);

    const suma = (stops: Stop[]) => stops.reduce((t, s) => t + (s.price ?? 0), 0);
    // "Sin importe" y "cero euros" no son lo mismo, pero para avisar dan
    // igual: las dos acaban en una factura más corta de lo que tocaba.
    const senseImport = (stops: Stop[]) => stops.filter((s) => !s.price).length;

    /*
      Por dónde se reparte hoy. Con los bultos de cada sitio juntos se ve de
      un vistazo si queda un viaje largo por hacer o son cuatro portales.

      Las que no tienen población se cuentan aparte en vez de agruparse en un
      "Sense població": hay hojas que no traen esa columna —la población va
      dentro de la dirección— y entonces el reparto por zonas no dice nada.
      Sin ninguna población de verdad, la tarjeta no sale.
    */
    const perPoblacio = new Map<string, number>();
    let senseP = 0;
    for (const stop of [...enCurs, ...pendents]) {
      const lloc = (stop.city ?? "").trim();
      if (lloc === "") senseP++;
      else perPoblacio.set(lloc, (perPoblacio.get(lloc) ?? 0) + 1);
    }

    return {
      pendents: pendents.length,
      enCurs: enCurs.length,
      entregatsAvui: entregatsAvui.length,
      incidenciesAvui: incidenciesAvui.length,
      cobratAvui: suma(entregatsAvui),
      senseImportAvui: senseImport(entregatsAvui),
      entregatsFull: entregats.length,
      cobratFull: suma(entregats),
      senseImportFull: senseImport(entregats),
      poblacions: [...perPoblacio].sort((a, b) => b[1] - a[1]),
      sensePoblacio: senseP,
    };
  }, [todayStops, entregats, incidencies, avui]);

  const porRepartir = dades.pendents + dades.enCurs;
  const fetsAvui = dades.entregatsAvui + dades.incidenciesAvui;
  const totalAvui = porRepartir + fetsAvui;
  // Con el día vacío el resumen se queda igualmente: las cifras a cero y,
  // sobre todo, los accesos —"Sense assignar" y "Calendari"— que son la
  // manera de darle trabajo al día.
  const percentatge = totalAvui > 0 ? Math.round((fetsAvui / totalAvui) * 100) : 0;
  const ruta = [formatDistance(totalDistanceMeters), formatDuration(totalDurationSeconds)]
    .filter(Boolean)
    .join(" · ");
  /* Sobre las que tienen importe, no sobre todas las entregas: con una sin
     poner, la media por parada salía más baja de lo que se cobra de verdad. */
  const ambImport = dades.entregatsAvui - dades.senseImportAvui;
  const mitjana = ambImport > 0 ? dades.cobratAvui / ambImport : 0;

  return (
    // En pantalla grande las piezas caben en fila en vez de una debajo de
    // otra: la acción del día, las cifras de hoy y las del full.
    <div className="space-y-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0 xl:grid-cols-3">
      {/* ── Acción principal del día ─────────────────────────────────── */}
      {porRepartir > 0 && (
        <div className="soft-card relative overflow-hidden bg-[color-mix(in_srgb,var(--primary)_8%,var(--card))] p-5 xl:col-span-2">
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

      {/* ── Cómo va el día ───────────────────────────────────────────── */}
      <div className="soft-card p-5 lg:col-span-1">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-muted-foreground">Avui</p>
          <span className="rounded-full bg-[color-mix(in_srgb,var(--success)_14%,transparent)] px-2.5 py-1 text-xs font-semibold text-[var(--success)]">
            {percentatge}% fet
          </span>
        </div>

        <p className="mt-1 text-4xl font-bold tracking-tight">
          {porRepartir}
          <span className="ml-2 align-middle text-base font-medium text-muted-foreground">
            per repartir
          </span>
        </p>

        {/* La barra dice de un vistazo lo que el porcentaje dice con un
            número, y es lo que se mira de reojo en la furgoneta. */}
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={percentatge}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Feina del dia"
        >
          <div
            className="h-full rounded-full bg-[var(--success)] transition-[width] duration-500"
            style={{ width: `${percentatge}%` }}
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
          <Cifra
            icono={<CheckCircle2 className="size-4" aria-hidden />}
            tono="success"
            etiqueta="Entregades"
            valor={dades.entregatsAvui}
          />
          <Cifra
            icono={<TriangleAlert className="size-4" aria-hidden />}
            tono="warning"
            etiqueta="Incidències"
            valor={dades.incidenciesAvui}
          />
        </div>

        {/* Lo que se ha ganado hoy. Es el número por el que se trabaja y no
            estaba en ninguna pantalla hasta la factura de fin de mes. */}
        <div className="mt-4 flex items-center gap-2.5 border-t border-border pt-4">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-primary"
            aria-hidden
          >
            <Coins className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted-foreground">Cobrat avui</p>
            <p className="text-lg font-semibold leading-tight tabular-nums">
              {euros(dades.cobratAvui)} €
            </p>
          </div>
          {mitjana > 0 && (
            <p className="shrink-0 text-right text-xs text-muted-foreground">
              {euros(mitjana)} €<br />
              per parada
            </p>
          )}
        </div>

        {dades.senseImportAvui > 0 && (
          <Avis
            text={`${dades.senseImportAvui} ${
              dades.senseImportAvui === 1
                ? "entrega d'avui sense import"
                : "entregues d'avui sense import"
            }`}
            accio="Posa'ls"
            onClick={() => onIr("factures")}
          />
        )}
      </div>

      {/* ── El full, que es lo que se acaba facturando ────────────────── */}
      <div className="soft-card p-5 lg:col-span-1">
        <p className="text-sm text-muted-foreground">El full</p>
        <p className="mt-1 text-4xl font-bold tracking-tight tabular-nums">
          {euros(dades.cobratFull)}
          <span className="ml-1.5 align-middle text-base font-medium text-muted-foreground">
            €
          </span>
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {dades.entregatsFull}{" "}
          {dades.entregatsFull === 1 ? "entrega" : "entregues"} en aquest full
        </p>

        <button
          type="button"
          onClick={() => onIr("factures")}
          className="pressable mt-4 flex w-full items-center gap-2.5 rounded-xl border border-border px-3 py-2.5 text-left"
        >
          <FileText className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="flex-1 text-sm font-medium">Factures</span>
          <span className="text-xs text-muted-foreground">Veure</span>
        </button>

        {dades.senseImportFull > 0 && (
          <Avis
            text={`${dades.senseImportFull} ${
              dades.senseImportFull === 1
                ? "entrega del full sense import"
                : "entregues del full sense import"
            }`}
            detall={
              dades.senseImportFull === 1
                ? "No entrarà a la factura."
                : "No entraran a la factura."
            }
          />
        )}
      </div>

      {/* ── Por dónde toca hoy ───────────────────────────────────────── */}
      {dades.poblacions.length > 0 && (
        <div className="soft-card p-5 lg:col-span-2 xl:col-span-3">
          <div className="mb-3 flex items-center gap-2">
            <MapPin className="size-4 text-primary" aria-hidden />
            <h3 className="text-base font-semibold">On toca avui</h3>
            <span className="text-sm text-muted-foreground">
              {dades.poblacions.length}{" "}
              {dades.poblacions.length === 1 ? "població" : "poblacions"}
            </span>
          </div>
          <ul className="flex flex-wrap gap-2">
            {dades.poblacions.map(([lloc, quantes]) => (
              <li
                key={lloc}
                className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-sm"
              >
                <span className="font-medium">{lloc}</span>
                <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                  {quantes}
                </span>
              </li>
            ))}
            {dades.sensePoblacio > 0 && (
              <li className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground">
                Sense població
                <span className="text-xs font-semibold tabular-nums">
                  {dades.sensePoblacio}
                </span>
              </li>
            )}
          </ul>
        </div>
      )}

      {/* ── Accesos rápidos ──────────────────────────────────────────── */}
      <div className="lg:col-span-2 xl:col-span-3">
        <h3 className="mb-3 text-base font-semibold">Accessos</h3>
        {/* Dos por fila en el móvil y cuatro en pantalla grande: con tres
            columnas, el cuarto acceso se quedaba solo en una fila. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
            insignia={incidencies.length}
            onClick={() => onIr("historial")}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Un aviso de algo que hay que arreglar, con su salida cuando la hay.
 *
 * Sin `onClick` es solo información: no todo lo que conviene saber se
 * arregla desde donde se lee.
 */
function Avis({
  text,
  detall,
  accio,
  onClick,
}: {
  text: string;
  detall?: string;
  accio?: string;
  onClick?: () => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-2 rounded-xl bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] px-3 py-2">
      <TriangleAlert className="size-4 shrink-0 text-[var(--warning)]" aria-hidden />
      <p className="min-w-0 flex-1 text-xs leading-snug">
        {text}
        {detall && <span className="text-muted-foreground"> {detall}</span>}
      </p>
      {accio && onClick && (
        <button
          type="button"
          onClick={onClick}
          className="pressable shrink-0 text-xs font-semibold text-primary"
        >
          {accio}
        </button>
      )}
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
    <Image
      src="/furgoneta.webp"
      alt=""
      width={420}
      height={396}
      aria-hidden
      unoptimized
      className="pointer-events-none absolute bottom-0 right-0 w-[136px] select-none"
    />
  );
}
