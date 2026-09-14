"use client";

/**
 * La pestaña del historial: lo entregado y las incidencias, con su
 * exportación a CSV.
 *
 * Sacada de `dashboard.tsx` tal cual. Mismo comportamiento, misma carga.
 */

import { useMemo, useState } from "react";
import { ArrowUpDown, Check, Download, Search, TriangleAlert } from "lucide-react";
import { formatLongDate } from "@/lib/dates";
import { euros } from "@/lib/factura";
import type { Stop } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import StopCard from "@/components/stop-card";
import Previsualitzacio from "@/components/previsualitzacio";

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

export default function TabHistorial({
  historyStops,
  mes,
  onDelivered,
  onIncident,
  onImporte,
  onUndeliver,
}: {
  historyStops: { entregat: Stop[]; incidencia: Stop[] };
  /** Nombre del full, solo para el nombre del CSV. */
  mes: string;
  onDelivered: (id: string, price: number | null) => void;
  onIncident: (id: string, note: string) => void;
  onImporte: (id: string, importe: number | null) => void;
  onUndeliver: (id: string) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [ordre, setOrdre] = useState<{ clau: ClauHistorial; asc: boolean }>({
    clau: "date",
    asc: false,
  });
  /**
   * La comanda abierta desde la tabla, por su id: si se guarda el objeto, al
   * corregir el importe la ficha se queda enseñando el de antes.
   */
  const [obertId, setObertId] = useState<string | null>(null);

  const allHistory = useMemo(() => [...historyStops.entregat, ...historyStops.incidencia], [historyStops]);

  const filteredHistory = useMemo(() => {
    if (!searchTerm.trim()) return allHistory;
    const q = searchTerm.toLowerCase();
    return allHistory.filter(stop =>
      stop.codi.toLowerCase().includes(q) ||
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

  const obert = obertId ? (allHistory.find((s) => s.id === obertId) ?? null) : null;

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
                    onClick={() => setObertId(stop.id)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/60"
                  >
                    <td className="px-4 py-2 tabular-nums">{stop.codi}</td>
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

          {/* En el móvil, filas compactas que se tocan para abrir la ficha
              completa, como en el detall del dia del calendari. Una tabla de
              seis columnas en 375 px no se lee, y una tarjeta entera por
              comanda ocupa demasiado: la lista compacta deja ver más comandas
              de un vistazo y tocar la que interesa. */}
          <div className="space-y-6 lg:hidden">
            {groupedByDate.map(group => (
              <div key={group.date} className="space-y-2">
                <h3 className="sticky top-0 z-10 bg-background py-1 text-sm font-semibold">
                  {group.date === "Sense data" ? group.date : formatLongDate(group.date)}
                </h3>
                <section className="soft-card divide-y divide-border">
                  {group.stops.map((stop) => {
                    const incidencia = stop.statusCategory === "incidencia";
                    return (
                      <button
                        key={stop.id}
                        type="button"
                        onClick={() => setObertId(stop.id)}
                        className="pressable flex w-full items-start gap-3 px-4 py-3 text-left"
                      >
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

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {stop.customer || stop.codi}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {stop.codi}
                            {stop.city ? ` · ${stop.city}` : ""}
                          </span>
                          {incidencia && stop.incidentNote && (
                            <span className="mt-1 block text-xs text-status-incidencia">
                              {stop.incidentNote}
                            </span>
                          )}
                        </span>

                        <span className="shrink-0 text-right">
                          {stop.deliveredTime && (
                            <span className="block text-sm tabular-nums">
                              {stop.deliveredTime}
                            </span>
                          )}
                          {!incidencia && (
                            <span
                              className={cn(
                                "block text-xs tabular-nums",
                                stop.price ? "text-muted-foreground" : "text-warning",
                              )}
                            >
                              {stop.price ? `${euros(stop.price)} €` : "sense import"}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </section>
              </div>
            ))}
          </div>
        </>
      )}

      {obert && (
        <Previsualitzacio onTancar={() => setObertId(null)}>
            <div className="max-h-[85svh] overflow-y-auto overscroll-contain rounded-[var(--radius)]">
              <StopCard
                detall
                onImporte={onImporte}
                stop={obert}
                onDelivered={(id, price) => {
                  onDelivered(id, price);
                  setObertId(null);
                }}
                onIncident={(id, note) => {
                  onIncident(id, note);
                  setObertId(null);
                }}
                onUndeliver={(id) => {
                  onUndeliver(id);
                  setObertId(null);
                }}
              />
            </div>
        </Previsualitzacio>
      )}
    </div>
  );
}

// ── Route Summary ──────────────────────────────────────────────────────

