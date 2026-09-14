"use client";

/**
 * La pestaña del calendario: el mes, la semana, el detalle de un día y la
 * bolsa de comandas sin asignar.
 *
 * Vivía dentro de `dashboard.tsx`, que llegó a 2.600 líneas. Aquí no cambia
 * nada de cómo funciona —se importa igual que antes, no se carga aparte—:
 * es solo que ahora se encuentra.
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Phone,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { addDays, formatLongDate, getMonthGrid, getWeekGrid, getYearMonth } from "@/lib/dates";
import { euros } from "@/lib/factura";
import { telHref } from "@/lib/format";
import type { Stop } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import StopCard from "@/components/stop-card";
import Previsualitzacio from "@/components/previsualitzacio";

const WEEKDAY_NAMES = ["Dl", "Dt", "Dc", "Dj", "Dv", "Ds", "Dg"];
const MONTH_NAMES = ["Gener", "Febrer", "Març", "Abril", "Maig", "Juny", "Juliol", "Agost", "Setembre", "Octubre", "Novembre", "Desembre"];

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
export default function TabCalendari({
  todayDate,
  unassignedStops,
  calendarStopsByDate,
  onAssignDate,
  onImporte,
  onDelivered,
  onIncident,
}: {
  todayDate: string;
  unassignedStops: Stop[];
  calendarStopsByDate: Record<string, Stop[]>;
  onAssignDate: (orderId: string, date: string | null) => void;
  /** Poner o corregir el importe sin salir de la bossa. */
  onImporte: (orderId: string, importe: number | null) => void;
  onDelivered: (orderId: string, price: number | null) => void;
  onIncident: (orderId: string, note: string) => void;
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
        onImporte={onImporte}
        onDelivered={onDelivered}
        onIncident={onIncident}
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
                      {stop.customer || stop.codi}
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
                          title={`${stop.customer || stop.codi}${stop.city ? ` · ${stop.city}` : ""}`}
                          className={cn(
                            "truncate rounded-md px-1.5 py-1 text-[11px] leading-4 lg:cursor-grab lg:active:cursor-grabbing",
                            classeChip(stop.statusCategory),
                          )}
                        >
                          {stop.statusCategory === "entregat" && "✓ "}
                          {stop.customer || stop.codi}
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
        <Bossa
          stops={unassignedStops}
          onAssign={null}
          onDelivered={onDelivered}
          onImporte={onImporte}
        />
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
  onImporte,
  onDelivered,
  onIncident,
  onTancar,
}: {
  date: string;
  /** Todas las comandas de ese día, cerradas incluidas. */
  stops: Stop[];
  todayDate: string;
  unassignedStops: Stop[];
  onAssignDate: (orderId: string, date: string | null) => void;
  onImporte: (orderId: string, importe: number | null) => void;
  onDelivered: (orderId: string, price: number | null) => void;
  onIncident: (orderId: string, note: string) => void;
  onTancar: () => void;
}) {
  /**
   * La comanda abierta desde una de las dos listas del día, por su id.
   *
   * Una comanda ya asignada a un día no se podía abrir: en el calendario
   * solo salían el nombre y la población, y para ver el teléfono, las
   * medidas o ponerle el importe había que buscarla en otra pantalla. Por
   * el id y no el objeto, para que al corregir el importe la ficha enseñe
   * el nuevo (ver la bossa).
   */
  const [obertId, setObertId] = useState<string | null>(null);
  const obert = obertId ? (stops.find((s) => s.id === obertId) ?? null) : null;
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

                    {/* Abre la ficha: el teléfono, les mides i l'import.
                        El botón de llamar va aparte, como hermano, que un
                        botón dentro de otro no es HTML válido. */}
                    <button
                      type="button"
                      onClick={() => setObertId(stop.id)}
                      className="pressable min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm font-medium">
                        {stop.customer || stop.codi}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {stop.codi}
                        {stop.city ? ` · ${stop.city}` : ""}
                      </p>
                      {incidencia && stop.incidentNote && (
                        <p className="mt-1 text-xs text-status-incidencia">
                          {stop.incidentNote}
                        </p>
                      )}
                    </button>

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
                <button
                  type="button"
                  onClick={() => setObertId(stop.id)}
                  className="pressable min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-medium">{stop.customer || stop.codi}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {stop.city || stop.address || stop.codi}
                  </p>
                </button>
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
        <Bossa
          stops={unassignedStops}
          onAssign={(id) => onAssignDate(id, date)}
          onDelivered={onDelivered}
          onImporte={onImporte}
        />
      )}

      {obert && (
        <Previsualitzacio onTancar={() => setObertId(null)}>
            <div className="max-h-[85svh] overflow-y-auto overscroll-contain rounded-[var(--radius)]">
              <StopCard
                detall
                stop={obert}
                onImporte={onImporte}
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
        </Previsualitzacio>
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
  onDelivered,
  onImporte,
}: {
  stops: Stop[];
  /** `null` cuando no hay ningún día abierto: entonces tocar solo previsualiza. */
  onAssign: ((id: string) => void) | null;
  /**
   * Darla por entregada sin pasar por ningún día.
   *
   * La oficina apunta comandas con retraso, así que a veces aparece en la
   * bolsa una que ya repartiste la semana pasada. Asignarla a un día para
   * marcarla acto seguido es dar un rodeo por algo que ya está hecho: desde
   * aquí se cierra y se va derecha al historial, con su importe.
   */
  onDelivered: (orderId: string, price: number | null) => void;
  /**
   * Poner el importe desde la previsualización.
   *
   * El precio de un porte se sabe muchas veces antes de repartirlo —lo dice
   * el albarán o es el de siempre para ese cliente— y hasta ahora solo se
   * podía escribir al marcar la entrega o después, en l'Historial. Aquí es
   * el mismo camino que allí: se guarda solo, sin tocar ni el estado ni la
   * hora.
   */
  onImporte: (orderId: string, importe: number | null) => void;
}) {
  /**
   * La comanda que se está mirando, por su id.
   *
   * Por el id y no el objeto: al ponerle el importe desde aquí, la comanda
   * se vuelve a construir con el precio nuevo, y una copia guardada se
   * quedaría enseñando el de antes —que es justo el que se acaba de
   * corregir—.
   */
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewStop = previewId ? (stops.find((s) => s.id === previewId) ?? null) : null;

  /*
    Por orden de llegada: primero la que la oficina apuntó antes.

    Es lo único para lo que sirve la fecha de creación —en la ficha no sale,
    porque cuándo la metieron en la hoja no cambia nada de lo que hay que
    hacer con ella— y aquí sí: la bossa es una cola de espera, y lo que lleva
    más tiempo esperando es lo primero que hay que colocar.

    Las que no traen fecha van al final: no hay con qué ordenarlas, y
    dejarlas arriba las pondría por delante de comandas de hace un mes.
  */
  const ordenades = useMemo(
    () =>
      [...stops].sort((a, b) => {
        if (!a.creationDate) return b.creationDate ? 1 : 0;
        if (!b.creationDate) return -1;
        return a.creationDate.localeCompare(b.creationDate);
      }),
    [stops],
  );
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
    else setPreviewId(stop.id);
  };

  const startPress = (stop: Stop) => {
    cancelRef.current = false;
    timerRef.current = setTimeout(() => {
      if (!cancelRef.current) {
        setPreviewId(stop.id);
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
      <div className="hairline flex items-center justify-between gap-2 pt-4">
        <div className="flex items-center gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-status-pendent">
            <Inbox className="size-4" aria-hidden />
            Bossa de comandes
          </h3>
          {/*
            Crear una comanda a mano. Pegado al título de la bossa porque es
            donde va a caer: la oficina no siempre apunta lo que sale al
            momento, y hasta ahora eso era abrir el Google Sheet en el móvil.

            Solo el signo, sin texto: al lado de "Bossa de comandes" un "+"
            ya se entiende, y así no compite con el título. El nombre entero
            sigue ahí para quien lea la pantalla en voz alta.

            Es un enlace a una pantalla aparte, no un diálogo: son siete
            campos y el teclado del móvil se come media pantalla.
          */}
          <Button asChild variant="secondary" size="icon" className="size-8">
            <Link href="/nova-comanda" aria-label="Crear una comanda">
              <Plus strokeWidth={2.5} />
            </Link>
          </Button>
        </div>
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
        /*
          En filas, como "Per repartir", y no en dos columnas de tarjetas.

          Con dos columnas en un móvil cabían veinte caracteres por línea: el
          nombre del cliente salía cortado —"FERRETERIA TORCA…"— y la
          población también, que son los dos únicos datos que hay ahí. Una
          fila por comanda ocupa lo mismo a lo alto, deja el ancho entero
          para el nombre y hace que las dos listas del día se lean igual.
        */
        <ul className="soft-card min-h-0 divide-y divide-border overflow-y-auto">
          {ordenades.map((stop) => (
            /*
              La fila es el área de asignar —tocar, mantener pulsado o
              arrastrar— y el botón de llamar va aparte, como hermano: un
              botón dentro de otro no es HTML válido y el teléfono acabaría
              asignando la comanda al día abierto.
            */
            <li key={stop.id} className="flex items-center gap-2 pr-3">
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
                className="pressable flex min-w-0 flex-1 touch-none select-none flex-col items-start gap-0.5 py-2.5 pl-3 text-left lg:cursor-grab lg:active:cursor-grabbing"
              >
                <span className="w-full truncate text-sm font-medium">{stop.customer || stop.codi}</span>
                <span className="w-full truncate text-xs text-muted-foreground">{stop.city || "Sense adreça"}</span>
              </button>
              <Trucar phone={stop.phone} />
            </li>
          ))}
        </ul>
      )}

      {previewStop && (
        <Previsualitzacio onTancar={() => setPreviewId(null)}>
            {/* El scroll va en esta caja de dentro y no en la de fuera: la
                cruz de cerrar vive por encima de la tarjeta y un contenedor
                con scroll se la come. Con tope de alto porque una comanda con
                observaciones largas se salía por abajo y el botón de
                assignar quedaba fuera de alcance. */}
            <div className="max-h-[85svh] overflow-y-auto overscroll-contain rounded-[var(--radius)]">
            {/*
              El botón va DENTRO de la tarjeta, en su pie.

              Suelto debajo parecía de otra cosa —flotando sobre el fondo
              gris— y encima convivía con "Entregat" e "Incidència", que aquí
              no hacían nada: esta pantalla no los sabe guardar. Ahora el pie
              es lo único que se puede hacer con la comanda desde aquí.
            */}
            <StopCard
              detall
              stop={previewStop}
              onDelivered={() => {}}
              onIncident={() => {}}
              onImporte={onImporte}
              peu={
                <div className="space-y-2">
                  {onAssign ? (
                    <Button
                      className="w-full"
                      size="touch"
                      onClick={() => {
                        onAssign(previewStop.id);
                        setPreviewId(null);
                      }}
                    >
                      Assignar comanda
                    </Button>
                  ) : (
                    <p className="text-center text-sm text-muted-foreground">
                      Obre un dia del calendari per assignar-la.
                    </p>
                  )}

                  {/*
                    Secundario y debajo: lo normal es asignar, y esto es para
                    la comanda que ya repartiste y te llega tarde a la bolsa.
                    El importe se pone aquí mismo con «Posar import», antes o
                    después — y si no, queda en l'Historial esperando.
                  */}
                  <Button
                    variant="secondary"
                    className="w-full"
                    size="touch"
                    onClick={() => {
                      onDelivered(previewStop.id, previewStop.price);
                      setPreviewId(null);
                    }}
                  >
                    <Check />
                    Ja està entregada
                  </Button>
                </div>
              }
            />
            </div>
        </Previsualitzacio>
      )}
    </div>
  );
}

// ── Tab: Historial ─────────────────────────────────────────────────────

/** Las columnas de la tabla, y por dónde se puede ordenar. */
