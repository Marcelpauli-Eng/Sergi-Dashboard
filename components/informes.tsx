"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Euro, Package, TriangleAlert } from "lucide-react";
import type { Manifest, Stop } from "@/lib/types";
import { euros } from "@/lib/factura";
import { cn } from "@/lib/utils";

/**
 * Informes.
 *
 * Dos vistas sobre los mismos números: el full que se está trabajando, que
 * sale de IndexedDB y por tanto funciona sin cobertura, y la comparativa
 * entre meses, que sí la necesita porque hay que ir a leer los otros fulls.
 *
 * Es la pantalla que más gana con un ordenador —cifras, barras y tablas a la
 * vez— y por eso el móvil la apila y el ordenador la reparte en columnas,
 * pero es la misma.
 */

interface Fila {
  clave: string;
  entregues: number;
  import: number;
}

interface Resum {
  total: number;
  entregats: number;
  incidencies: number;
  pendents: number;
  ambImport: number;
  senseImport: number;
  facturat: number;
  mitjana: number;
  /** Importe ya puesto en comandas que aún no se han entregado. */
  pendentAmbImport: number;
  /** Comandas por hacer que todavía no tienen importe. */
  pendentSenseImport: number;
  dies: { date: string; entregues: number; import: number }[];
  clients: Fila[];
  poblacions: Fila[];
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

/** Las cuentas de un full. Una sola función para el mes abierto y para la comparativa. */
function resumir(stops: Stop[]): Resum {
  const entregats = stops.filter((s) => s.statusCategory === "entregat");
  const incidencies = stops.filter((s) => s.statusCategory === "incidencia");
  const pendents = stops.filter(
    (s) => s.statusCategory === "pendent" || s.statusCategory === "en_curs",
  );
  const ambImport = entregats.filter((s) => s.price !== null && s.price > 0);
  const facturat = ambImport.reduce((suma, s) => suma + (s.price ?? 0), 0);

  // Lo que queda por repartir y ya trae precio de la hoja. Hoy son pocas
  // —el precio se pone al entregar— pero cuando la oficina lo deja puesto
  // de antemano, esto es dinero conocido y no una estimación.
  const pendentsCaros = pendents.filter((s) => s.price !== null && s.price > 0);

  // Por día: solo los días que tienen algo, ordenados. Un mes con huecos no
  // dibuja treinta barras a cero.
  const perDia = new Map<string, { entregues: number; import: number }>();
  for (const s of entregats) {
    if (!s.date) continue;
    const d = perDia.get(s.date) ?? { entregues: 0, import: 0 };
    d.entregues += 1;
    d.import += s.price ?? 0;
    perDia.set(s.date, d);
  }

  return {
    total: stops.length,
    entregats: entregats.length,
    incidencies: incidencies.length,
    pendents: pendents.length,
    ambImport: ambImport.length,
    senseImport: entregats.length - ambImport.length,
    facturat,
    mitjana: ambImport.length > 0 ? facturat / ambImport.length : 0,
    pendentAmbImport: pendentsCaros.reduce((suma, s) => suma + (s.price ?? 0), 0),
    pendentSenseImport: pendents.length - pendentsCaros.length,
    dies: [...perDia.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v })),
    clients: agrupar(entregats, (s) => s.customer ?? "").slice(0, 8),
    poblacions: agrupar(entregats, (s) => s.city ?? "").slice(0, 8),
  };
}

export default function Informes({
  stops,
  mes,
  fulls,
  online,
}: {
  /** Todas las comandas de la hoja seleccionada. */
  stops: Stop[];
  mes: string;
  /** Los fulls que se pueden comparar. */
  fulls: string[];
  online: boolean;
}) {
  const [vista, setVista] = useState<"full" | "comparativa">("full");
  const dades = useMemo(() => resumir(stops), [stops]);

  return (
    <div className="animate-fade-in space-y-6 pb-4">
      <div className="flex items-center gap-1 self-start rounded-full bg-muted p-0.5 lg:w-fit">
        {([
          ["full", "Aquest full"],
          ["comparativa", "Comparativa"],
        ] as const).map(([v, etiqueta]) => (
          <button
            key={v}
            type="button"
            onClick={() => setVista(v)}
            aria-pressed={vista === v}
            className={cn(
              "pressable flex-1 rounded-full px-4 py-1.5 text-sm font-medium lg:flex-none",
              vista === v ? "bg-card text-primary shadow-sm" : "text-muted-foreground",
            )}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {vista === "full" ? (
        <ResumDelFull dades={dades} mes={mes} />
      ) : (
        <Comparativa fulls={fulls} online={online} />
      )}
    </div>
  );
}

/* ── El full que se está trabajando ─────────────────────────────────────── */

function ResumDelFull({ dades, mes }: { dades: Resum; mes: string }) {
  const fets = dades.entregats + dades.incidencies;
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
    <div className="space-y-6">
      {/* ── Cifras ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Xifra
          icono={<CheckCircle2 className="size-5" aria-hidden />}
          tono="success"
          etiqueta="Entregades"
          valor={String(dades.entregats)}
          peu={`${percentatge}% del full`}
        />
        <Xifra
          icono={<Euro className="size-5" aria-hidden />}
          tono="primary"
          etiqueta="Facturable"
          valor={`${euros(dades.facturat)} €`}
          peu={
            dades.senseImport > 0 ? `${dades.senseImport} sense import` : "totes amb import"
          }
        />
        <Xifra
          icono={<Package className="size-5" aria-hidden />}
          tono="primary"
          etiqueta="Mitjana per entrega"
          valor={`${euros(dades.mitjana)} €`}
          peu={`${dades.ambImport} amb import`}
        />
        <Xifra
          icono={<TriangleAlert className="size-5" aria-hidden />}
          tono="warning"
          etiqueta="Incidències"
          valor={String(dades.incidencies)}
          peu={`${dades.pendents} pendents`}
        />
      </div>

      {/* ── Previsión del full ─────────────────────────────────────────
          Lo que ya está + lo que queda. Lo que queda son dos cosas muy
          distintas y por eso van separadas: el importe que YA está puesto
          en comandas sin entregar es dinero conocido, y el resto es una
          estimación a partir de la media. Sumarlas en un solo número
          disfrazaría de dato lo que es un cálculo. */}
      <Previsio dades={dades} />

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
                  <div className="flex min-h-0 w-full flex-1 items-end">
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
              { label: "Entregades", n: dades.entregats, color: "var(--success)" },
              { label: "Pendents", n: dades.pendents, color: "var(--primary)" },
              { label: "Incidències", n: dades.incidencies, color: "var(--warning)" },
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

/* ── La comparativa entre meses ─────────────────────────────────────────── */

interface Mes {
  full: string;
  resum: Resum;
}

/**
 * Compara los fulls entre sí.
 *
 * Lee cada full por el mismo endpoint que usa la sincronización de cada día
 * (`/api/manifest?tab=…`) en vez de inventar uno nuevo: ya devuelve las
 * comandas de un full y ya sabe de sesiones y de permisos. En serie y no en
 * paralelo porque detrás hay una llamada a Google por full, y doce de golpe
 * es la manera de que te limiten.
 *
 * Necesita cobertura, y es lo único de esta pantalla que la necesita.
 */
function Comparativa({ fulls, online }: { fulls: string[]; online: boolean }) {
  const [mesos, setMesos] = useState<Mes[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [carregant, setCarregant] = useState(false);

  useEffect(() => {
    if (!online || fulls.length === 0) return;
    let cancelat = false;

    void (async () => {
      setCarregant(true);
      setError(null);
      const recollits: Mes[] = [];
      try {
        for (const full of fulls) {
          const resposta = await fetch(`/api/manifest?tab=${encodeURIComponent(full)}`);
          if (cancelat) return;
          if (!resposta.ok) {
            // Un full que no se deja leer no tumba la comparativa: se queda
            // fuera y los demás se enseñan igual.
            console.warn(`No s'ha pogut llegir el full "${full}"`);
            continue;
          }
          const manifest = (await resposta.json()) as Manifest;
          recollits.push({ full, resum: resumir(manifest.today?.stops ?? []) });
        }
        if (!cancelat) {
          setMesos(recollits);
          if (recollits.length === 0) setError("No s'ha pogut llegir cap full.");
        }
      } catch (e) {
        if (!cancelat) setError(e instanceof Error ? e.message : "Error desconegut");
      } finally {
        if (!cancelat) setCarregant(false);
      }
    })();

    return () => {
      cancelat = true;
    };
  }, [fulls, online]);

  if (!online) {
    return (
      <div className="soft-card px-6 py-12 text-center">
        <p className="text-base font-medium">Necessites cobertura per comparar</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Els altres fulls no estan descarregats: cal anar a buscar-los.
        </p>
      </div>
    );
  }

  if (carregant && mesos === null) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Llegint {fulls.length} {fulls.length === 1 ? "full" : "fulls"}…
      </p>
    );
  }

  if (error) {
    return <p className="py-16 text-center text-sm text-status-incidencia">{error}</p>;
  }

  if (!mesos || mesos.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No hi ha fulls per comparar.
      </p>
    );
  }

  const maxFacturat = Math.max(1, ...mesos.map((m) => m.resum.facturat));
  const totals = mesos.reduce(
    (acc, m) => ({
      entregats: acc.entregats + m.resum.entregats,
      incidencies: acc.incidencies + m.resum.incidencies,
      facturat: acc.facturat + m.resum.facturat,
    }),
    { entregats: 0, incidencies: 0, facturat: 0 },
  );

  return (
    <div className="space-y-6">
      <section className="soft-card p-5">
        <h3 className="text-base font-semibold">Facturable per full</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          {mesos.length} {mesos.length === 1 ? "full llegit" : "fulls llegits"} · {euros(totals.facturat)} € en total
        </p>
        <div className="flex h-56 items-stretch gap-3 overflow-x-auto pb-1">
          {mesos.map((m) => (
            <div
              key={m.full}
              className="group flex h-full min-w-20 flex-1 flex-col items-center gap-1.5"
              title={`${m.full} · ${m.resum.entregats} entregues · ${euros(m.resum.facturat)} €`}
            >
              <span className="text-xs font-semibold tabular-nums">
                {euros(m.resum.facturat)} €
              </span>
              <div className="flex min-h-0 w-full flex-1 items-end">
                <div
                  className="w-full rounded-t-lg bg-primary/80 transition-colors group-hover:bg-primary"
                  style={{ height: `${Math.max(2, (m.resum.facturat / maxFacturat) * 100)}%` }}
                />
              </div>
              <span className="w-full truncate text-center text-[11px] text-muted-foreground">
                {m.full}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="overflow-x-auto soft-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {["Full", "Comandes", "Entregades", "Incidències", "Pendents", "Facturable", "Mitjana"].map(
                (etiqueta, i) => (
                  <th
                    key={etiqueta}
                    className={cn(
                      "px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                      i === 0 ? "text-left" : "text-right",
                    )}
                  >
                    {etiqueta}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {mesos.map((m) => (
              <tr key={m.full} className="border-b border-border last:border-0">
                <td className="px-4 py-2 font-medium">{m.full}</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                  {m.resum.total}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{m.resum.entregats}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {m.resum.incidencies > 0 ? (
                    <span className="text-status-incidencia">{m.resum.incidencies}</span>
                  ) : (
                    <span className="text-tertiary-foreground">0</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                  {m.resum.pendents}
                </td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums">
                  {euros(m.resum.facturat)} €
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                  {euros(m.resum.mitjana)} €
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <td className="px-4 py-2.5 text-xs text-muted-foreground">Total</td>
              <td />
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                {totals.entregats}
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                {totals.incidencies}
              </td>
              <td />
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                {euros(totals.facturat)} €
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ── Piezas ─────────────────────────────────────────────────────────────── */

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
                  className="h-full rounded-full bg-primary/70"
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

function Previsio({ dades }: { dades: Resum }) {
  const estimat = dades.pendentSenseImport * dades.mitjana;
  const previsio = dades.facturat + dades.pendentAmbImport + estimat;
  const maxim = Math.max(1, previsio);

  const trams = [
    { etiqueta: "Ja entregat", valor: dades.facturat, color: "var(--success)" },
    { etiqueta: "Pendent amb import", valor: dades.pendentAmbImport, color: "var(--primary)" },
    { etiqueta: "Estimat", valor: estimat, color: "var(--tertiary-foreground)" },
  ];

  return (
    <section className="soft-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-base font-semibold">Previsió del full</h3>
        <p className="text-2xl font-semibold tabular-nums tracking-tight">
          {euros(previsio)} €
        </p>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        {dades.pendents} {dades.pendents === 1 ? "comanda" : "comandes"} per repartir
        {dades.pendentSenseImport > 0 &&
          ` · ${dades.pendentSenseImport} a ${euros(dades.mitjana)} € de mitjana`}
      </p>

      {/* Una sola barra en tres tramos: se ve de un vistazo cuánto de la
          previsión es dinero hecho y cuánto es todavía una suposición. */}
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {trams.map((t) => (
          <div
            key={t.etiqueta}
            style={{ width: `${(t.valor / maxim) * 100}%`, background: t.color }}
            title={`${t.etiqueta}: ${euros(t.valor)} €`}
          />
        ))}
      </div>

      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {trams.map((t) => (
          <li key={t.etiqueta} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: t.color }}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">{t.etiqueta}</p>
              <p className="text-sm font-semibold tabular-nums">{euros(t.valor)} €</p>
            </div>
          </li>
        ))}
      </ul>

      {dades.pendentSenseImport > 0 && dades.mitjana === 0 && (
        <p className="mt-3 border-t border-border pt-3 text-xs text-tertiary-foreground">
          Encara no hi ha cap entrega amb import, així que no hi ha mitjana amb què
          estimar el que queda.
        </p>
      )}
    </section>
  );
}
