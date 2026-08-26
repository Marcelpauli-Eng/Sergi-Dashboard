"use client";

import { useMemo } from "react";
import { CheckCircle2, Euro, Package, TriangleAlert } from "lucide-react";
import type { Stop } from "@/lib/types";
import { euros } from "@/lib/factura";
import { cn } from "@/lib/utils";

/**
 * Informes del mes de trabajo.
 *
 * Todo sale del manifiesto que ya está en IndexedDB: no hay ni una llamada
 * de red, así que la pantalla funciona igual sin cobertura que el resto de
 * la app. Es la pantalla que más gana con una pantalla grande —cifras,
 * barras y tablas a la vez— y por eso el móvil la apila y el ordenador la
 * reparte en columnas, pero es la misma.
 */

interface Fila {
  clave: string;
  entregues: number;
  import: number;
}

function agrupar(stops: Stop[], clave: (s: Stop) => string): Fila[] {
  const mapa = new Map<string, Fila>();
  for (const s of stops) {
    const k = clave(s).trim() || "Sense dades";
    const fila = mapa.get(k) ?? { clave: k, entregues: 0, import: 0 };
    fila.entregues += 1;
    fila.import += s.price ?? 0;
    mapa.set(k, fila);
  }
  return [...mapa.values()].sort((a, b) => b.entregues - a.entregues || b.import - a.import);
}

export default function Informes({
  stops,
  mes,
}: {
  /** Todas las comandas de la hoja seleccionada. */
  stops: Stop[];
  mes: string;
}) {
  const dades = useMemo(() => {
    const entregats = stops.filter((s) => s.statusCategory === "entregat");
    const incidencies = stops.filter((s) => s.statusCategory === "incidencia");
    const pendents = stops.filter(
      (s) => s.statusCategory === "pendent" || s.statusCategory === "en_curs",
    );
    const ambImport = entregats.filter((s) => s.price !== null && s.price > 0);
    const facturat = ambImport.reduce((suma, s) => suma + (s.price ?? 0), 0);

    // Por día: solo los días que tienen algo, ordenados. Un mes con huecos
    // no dibuja treinta barras a cero.
    const perDia = new Map<string, { entregues: number; import: number }>();
    for (const s of entregats) {
      if (!s.date) continue;
      const d = perDia.get(s.date) ?? { entregues: 0, import: 0 };
      d.entregues += 1;
      d.import += s.price ?? 0;
      perDia.set(s.date, d);
    }
    const dies = [...perDia.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));

    return {
      total: stops.length,
      entregats,
      incidencies,
      pendents,
      ambImport,
      senseImport: entregats.length - ambImport.length,
      facturat,
      mitjana: ambImport.length > 0 ? facturat / ambImport.length : 0,
      dies,
      clients: agrupar(entregats, (s) => s.customer ?? "").slice(0, 8),
      poblacions: agrupar(entregats, (s) => s.city ?? "").slice(0, 8),
    };
  }, [stops]);

  const fets = dades.entregats.length + dades.incidencies.length;
  const percentatge = dades.total > 0 ? Math.round((fets / dades.total) * 100) : 0;
  const maxDia = Math.max(1, ...dades.dies.map((d) => d.entregues));

  if (dades.total === 0) {
    return (
      <div className="soft-card px-6 py-12 text-center">
        <p className="text-base font-medium">Encara no hi ha dades per informar</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Selecciona un full amb comandes des de la barra lateral.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6 pb-4">
      {/* ── Cifras ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Xifra
          icono={<CheckCircle2 className="size-5" aria-hidden />}
          tono="success"
          etiqueta="Entregades"
          valor={String(dades.entregats.length)}
          peu={`${percentatge}% del full`}
        />
        <Xifra
          icono={<Euro className="size-5" aria-hidden />}
          tono="primary"
          etiqueta="Facturable"
          valor={`${euros(dades.facturat)} €`}
          peu={
            dades.senseImport > 0
              ? `${dades.senseImport} sense import`
              : "totes amb import"
          }
        />
        <Xifra
          icono={<Package className="size-5" aria-hidden />}
          tono="primary"
          etiqueta="Mitjana per entrega"
          valor={`${euros(dades.mitjana)} €`}
          peu={`${dades.ambImport.length} amb import`}
        />
        <Xifra
          icono={<TriangleAlert className="size-5" aria-hidden />}
          tono="warning"
          etiqueta="Incidències"
          valor={String(dades.incidencies.length)}
          peu={`${dades.pendents.length} pendents`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ── Entregas por día ───────────────────────────────────────── */}
        <section className="soft-card p-5 xl:col-span-2">
          <h3 className="text-base font-semibold">Entregues per dia</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            {mes || "Full sense nom"} · {dades.dies.length}{" "}
            {dades.dies.length === 1 ? "dia amb entregues" : "dies amb entregues"}
          </p>

          {dades.dies.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Encara no hi ha cap entrega registrada.
            </p>
          ) : (
            <div className="flex h-48 items-stretch gap-1.5 overflow-x-auto pb-1">
              {dades.dies.map((d) => (
                <div
                  key={d.date}
                  className="group flex h-full min-w-[1.75rem] max-w-16 flex-1 flex-col items-center gap-1.5"
                  title={`${d.date} · ${d.entregues} entregues · ${euros(d.import)} €`}
                >
                  <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                    {d.entregues}
                  </span>
                  {/* El envoltorio `flex-1` es lo que le da alto definido a la
                      barra: un porcentaje contra un padre de alto automático
                      no resuelve, y la barra se quedaba en nada. */}
                  <div className="flex w-full min-h-0 flex-1 items-end">
                    <div
                      className="w-full rounded-t-md bg-primary/80 transition-colors group-hover:bg-primary"
                      style={{ height: `${Math.max(4, (d.entregues / maxDia) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums text-tertiary-foreground">
                    {d.date.slice(8)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Reparto de estados ─────────────────────────────────────── */}
        <section className="soft-card p-5">
          <h3 className="mb-4 text-base font-semibold">Estat del full</h3>
          <ul className="space-y-3">
            {[
              { label: "Entregades", n: dades.entregats.length, color: "var(--success)" },
              { label: "Pendents", n: dades.pendents.length, color: "var(--primary)" },
              { label: "Incidències", n: dades.incidencies.length, color: "var(--warning)" },
            ].map(({ label, n, color }) => (
              <li key={label}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-semibold tabular-nums">{n}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${dades.total > 0 ? (n / dades.total) * 100 : 0}%`,
                      background: color,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">
            {dades.total} comandes al full
          </p>
        </section>
      </div>

      {/* ── Rankings ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Rànquing titol="Clients amb més entregues" files={dades.clients} />
        <Rànquing titol="Poblacions amb més entregues" files={dades.poblacions} />
      </div>
    </div>
  );
}

function Xifra({
  icono,
  tono,
  etiqueta,
  valor,
  peu,
}: {
  icono: React.ReactNode;
  tono: "success" | "warning" | "primary";
  etiqueta: string;
  valor: string;
  peu: string;
}) {
  return (
    <div className="soft-card p-4">
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
        <p className="min-w-0 truncate text-xs text-muted-foreground">{etiqueta}</p>
      </div>
      <p className="mt-2.5 text-2xl font-semibold tabular-nums tracking-tight">{valor}</p>
      <p className="mt-0.5 truncate text-xs text-tertiary-foreground">{peu}</p>
    </div>
  );
}

function Rànquing({ titol, files }: { titol: string; files: Fila[] }) {
  const max = Math.max(1, ...files.map((f) => f.entregues));

  return (
    <section className="soft-card p-5">
      <h3 className="mb-4 text-base font-semibold">{titol}</h3>
      {files.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Encara no hi ha dades.</p>
      ) : (
        <ul className="space-y-2.5">
          {files.map((f) => (
            <li key={f.clave} className="grid grid-cols-[1fr_auto] items-center gap-x-3">
              <span className="truncate text-sm">{f.clave}</span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {f.entregues} · {euros(f.import)} €
              </span>
              <div className="col-span-2 mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full bg-primary/70")}
                  style={{ width: `${(f.entregues / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
