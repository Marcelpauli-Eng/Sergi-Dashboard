"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpDown,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  Euro,
  ListChecks,
  Package,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import type { Stop } from "@/lib/types";
import { euros } from "@/lib/factura";
import {
  resumirFull,
  totalizar,
  variacio,
  type ResumFull,
} from "@/lib/informes";
import { cn } from "@/lib/utils";
import { parseTabMonth } from "@/lib/sheet-tab";
import { Button } from "@/components/ui/button";

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
        <Comparativa fulls={fulls} online={online} mes={mes} stops={stops} />
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


/**
 * Compara los fulls entre sí.
 *
 * Lee cada full por el mismo endpoint que usa la sincronización de cada día
 * (`/api/manifest?tab=…`) en vez de inventar uno nuevo: ya devuelve las
 * comandas de un full y ya sabe de sesiones y de permisos. En serie y no en
 * paralelo porque detrás hay una llamada a Google por full, y doce de golpe
 * es la manera de que te limiten.
 *
 * El full abierto no se va a buscar: son las mismas comandas que ya están
 * en pantalla, y leerlas del servidor dejaba la comparativa una entrega por
 * detrás de todo lo demás —lo que acababas de corregir salía con el valor
 * viejo hasta la siguiente descarga—. Los otros fulls sí, que no están
 * descargados, y por eso esto necesita cobertura.
 */
/* ── La comparativa entre fulls ─────────────────────────────────────────── */

/** Los fulls elegidos se recuerdan: nadie quiere volver a marcarlos cada vez. */
const CLAVE_TRIATS = "reparto:fulls-comparativa";

function llegirTriats(disponibles: string[]): string[] {
  try {
    const guardat = window.localStorage.getItem(CLAVE_TRIATS);
    if (guardat) {
      // Un full que ya no está en el documento se cae solo de la selección.
      const triats = (JSON.parse(guardat) as string[]).filter((f) =>
        disponibles.includes(f),
      );
      if (triats.length > 0) return triats;
    }
  } catch {
    // localStorage lleno o JSON roto: se empieza de cero, que no es grave.
  }
  /*
    Por defecto, los seis últimos QUE PAREZCAN UN MES.

    En el documento real hay pestañas que no son meses —una "Hoja 21" vacía—
    y colarlas en la selección de partida hacía que la primera comparativa
    que ves salga con un error, que es la peor manera de estrenar una
    pantalla. Seguen pudiendo elegirse a mano por si alguna guarda trabajo.
  */
  const mesos = disponibles.filter((f) => parseTabMonth(f) !== null);
  return (mesos.length > 0 ? mesos : disponibles).slice(-6);
}

type Columna = {
  clau: keyof ResumFull;
  etiqueta: string;
  /** Cómo se escribe el valor. */
  format: (r: ResumFull) => string;
  /** Los euros y las cuentas se alinean a la derecha. */
  dreta?: boolean;
  /** En pantalla estrecha solo caben las importantes. */
  sempre?: boolean;
};

const COLUMNES: Columna[] = [
  { clau: "full", etiqueta: "Full", format: (r) => r.full, sempre: true },
  { clau: "facturat", etiqueta: "Facturat", format: (r) => `${euros(r.facturat)} €`, dreta: true, sempre: true },
  { clau: "entregats", etiqueta: "Entregades", format: (r) => String(r.entregats), dreta: true, sempre: true },
  { clau: "mitjana", etiqueta: "Mitjana", format: (r) => `${euros(r.mitjana)} €`, dreta: true, sempre: true },
  { clau: "diesTreballats", etiqueta: "Dies", format: (r) => String(r.diesTreballats), dreta: true },
  {
    clau: "mitjanaPerDia",
    etiqueta: "Per dia",
    // Sin ningún día con entregas no hay media que valga: una raya dice la
    // verdad y un "0,00 €" miente, sobre todo en un full que SÍ ha
    // facturado. Pasa cuando la columna "Data entrega" está vacía.
    format: (r) => (r.diesTreballats === 0 ? "—" : `${euros(r.mitjanaPerDia)} €`),
    dreta: true,
  },
  { clau: "senseImport", etiqueta: "Sense import", format: (r) => String(r.senseImport), dreta: true },
  { clau: "incidencies", etiqueta: "Incidències", format: (r) => String(r.incidencies), dreta: true },
  { clau: "pendents", etiqueta: "Pendents", format: (r) => String(r.pendents), dreta: true },
];

function Comparativa({
  fulls,
  online,
  mes,
  stops,
}: {
  fulls: string[];
  online: boolean;
  /** El full abierto: ese sale de `stops` y no del servidor. */
  mes: string;
  stops: Stop[];
}) {
  const [triats, setTriats] = useState<string[]>(() =>
    typeof window === "undefined" ? fulls.slice(-6) : llegirTriats(fulls),
  );
  const [obertElSelector, setObertElSelector] = useState(false);
  const [delServidor, setDelServidor] = useState<ResumFull[] | null>(null);
  const [errores, setErrores] = useState<{ full: string; motiu: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [carregant, setCarregant] = useState(false);
  /** Ordenar por una columna, para ver enseguida el mejor mes o el peor. */
  const [ordre, setOrdre] = useState<{ clau: keyof ResumFull; asc: boolean } | null>(null);

  const alternar = (full: string) => {
    setTriats((previs) => {
      const seguents = previs.includes(full)
        ? previs.filter((f) => f !== full)
        : // Se guarda en el orden del documento, que es el cronológico.
          fulls.filter((f) => f === full || previs.includes(f));
      try {
        window.localStorage.setItem(CLAVE_TRIATS, JSON.stringify(seguents));
      } catch {
        // Que no se pueda recordar la selección no impide usarla ahora.
      }
      return seguents;
    });
  };

  /*
    Al servidor solo se le piden los fulls que NO son el abierto: ese se
    calcula aquí con lo que hay en IndexedDB, así que un importe que acabas
    de corregir se ve en la comparativa en el acto y no a la siguiente
    sincronización.
  */
  const aDemanar = useMemo(() => triats.filter((f) => f !== mes), [triats, mes]);
  const clau = aDemanar.join(",");
  const hiHaQueDemanar = online && aDemanar.length > 0;

  useEffect(() => {
    if (!hiHaQueDemanar) return;
    let cancelat = false;

    void (async () => {
      // Dentro de la función asíncrona y no en el cuerpo del efecto: ahí
      // encadenaría un render de más en cada montaje.
      setCarregant(true);
      setError(null);
      try {
        const resposta = await fetch(`/api/informes?fulls=${encodeURIComponent(clau)}`);
        const cos = await resposta.json().catch(() => null);
        if (cancelat) return;
        if (!resposta.ok) throw new Error(cos?.error ?? `El servidor respongué ${resposta.status}`);
        setDelServidor(cos.mesos as ResumFull[]);
        setErrores((cos.errores ?? []) as { full: string; motiu: string }[]);
      } catch (e) {
        if (!cancelat) setError(e instanceof Error ? e.message : "Error desconegut");
      } finally {
        if (!cancelat) setCarregant(false);
      }
    })();

    return () => {
      cancelat = true;
    };
  }, [clau, hiHaQueDemanar]);

  const mesos = useMemo(() => {
    const delFullObert = triats.includes(mes) ? [resumirFull(mes, stops)] : [];
    // Sin nada que pedir no hay nada del servidor, se haya quedado lo que se
    // haya quedado de una selección anterior.
    const tots = [...(hiHaQueDemanar ? (delServidor ?? []) : []), ...delFullObert];
    // En el orden del documento, que es el cronológico: una comparativa que
    // salta de mayo a enero y vuelve a marzo no se puede leer.
    return fulls.filter((f) => tots.some((m) => m.full === f))
      .map((f) => tots.find((m) => m.full === f)!);
  }, [delServidor, hiHaQueDemanar, triats, mes, stops, fulls]);

  const ordenats = useMemo(() => {
    if (!ordre) return mesos;
    const signe = ordre.asc ? 1 : -1;
    return [...mesos].sort((a, b) => {
      const va = a[ordre.clau];
      const vb = b[ordre.clau];
      if (typeof va === "number" && typeof vb === "number") return signe * (va - vb);
      return signe * String(va).localeCompare(String(vb));
    });
  }, [mesos, ordre]);

  const total = useMemo(() => totalizar(mesos), [mesos]);
  const maxFacturat = Math.max(1, ...mesos.map((m) => m.facturat));
  const millor = mesos.reduce<ResumFull | null>(
    (a, m) => (a === null || m.facturat > a.facturat ? m : a),
    null,
  );
  const mitjanaMensual = mesos.length > 0 ? total.facturat / mesos.length : 0;

  return (
    <div className="space-y-6">
      {/* ── Qué fulls se comparan ───────────────────────────────────────── */}
      <section className="soft-card overflow-hidden">
        <button
          type="button"
          onClick={() => setObertElSelector((v) => !v)}
          aria-expanded={obertElSelector}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <ListChecks className="size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Fulls a comparar</p>
            <p className="truncate text-xs text-muted-foreground">
              {triats.length === 0
                ? "Cap seleccionat"
                : `${triats.length} de ${fulls.length} · ${triats.join(", ")}`}
            </p>
          </div>
          <ChevronDown
            className={cn("size-5 shrink-0 text-muted-foreground", obertElSelector && "rotate-180")}
            aria-hidden
          />
        </button>

        {obertElSelector && (
          <div className="animate-fade-in border-t border-border p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setTriats(fulls)}>
                Tots
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setTriats(fulls.slice(-6))}>
                Últims 6
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={triats.length === 0}
                onClick={() => setTriats([])}
              >
                Cap
              </Button>
            </div>

            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {fulls.map((full) => (
                <label
                  key={full}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={triats.includes(full)}
                    onChange={() => alternar(full)}
                    className="size-[18px] shrink-0 accent-[var(--primary)]"
                  />
                  <span className="truncate text-sm">{full}</span>
                  {full === mes && (
                    <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      obert
                    </span>
                  )}
                </label>
              ))}
            </div>

            <p className="mt-3 text-xs text-tertiary-foreground">
              Cada full és una lectura del full de càlcul. Amb menys fulls, més
              ràpid.
            </p>
          </div>
        )}
      </section>

      {!online && (
        <p className="rounded-xl bg-warning-surface px-4 py-2.5 text-sm text-warning-foreground">
          Sense cobertura només es veu el full obert: la resta cal anar a buscar-los.
        </p>
      )}

      {error && (
        <p className="rounded-xl bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] px-4 py-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      {hiHaQueDemanar && errores.length > 0 && (
        <div className="rounded-xl bg-warning-surface px-4 py-2.5 text-sm text-warning-foreground">
          <p className="font-medium">
            {errores.length} {errores.length === 1 ? "full no s'ha pogut llegir" : "fulls no s'han pogut llegir"}:
          </p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {errores.map((e) => (
              <li key={e.full}>
                <strong>{e.full}</strong> — {e.motiu}
              </li>
            ))}
          </ul>
        </div>
      )}

      {carregant && mesos.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Llegint {aDemanar.length} {aDemanar.length === 1 ? "full" : "fulls"}…
        </p>
      )}

      {!carregant && mesos.length === 0 && !error && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Tria algun full per comparar.
        </p>
      )}

      {mesos.length > 0 && (
        <>
          {/* ── El resumen de todo lo elegido ──────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Xifra
              icono={<Euro className="size-5" aria-hidden />}
              tono="primary"
              etiqueta={`Facturat · ${mesos.length} ${mesos.length === 1 ? "full" : "fulls"}`}
              valor={`${euros(total.facturat)} €`}
              peu={`${total.entregats} entregues`}
            />
            <Xifra
              icono={<TrendingUp className="size-5" aria-hidden />}
              tono="primary"
              etiqueta="Mitjana per full"
              valor={`${euros(mitjanaMensual)} €`}
              peu={mesos.length === 1 ? "un sol full" : `entre ${mesos.length} fulls`}
            />
            <Xifra
              icono={<Package className="size-5" aria-hidden />}
              tono="success"
              etiqueta="Mitjana per entrega"
              valor={`${euros(total.mitjana)} €`}
              peu={`${total.ambImport} amb import`}
            />
            <Xifra
              icono={<CalendarCheck className="size-5" aria-hidden />}
              tono="success"
              etiqueta="Millor full"
              valor={millor ? `${euros(millor.facturat)} €` : "—"}
              peu={millor?.full ?? ""}
            />
          </div>

          {/* ── Facturado por full ─────────────────────────────────────── */}
          <section className="soft-card p-5">
            <h3 className="text-base font-semibold">Facturat per full</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              {total.diesTreballats > 0
                ? `${total.diesTreballats} dies treballats · ${euros(total.mitjanaPerDia)} € per dia`
                : "Cap entrega té dia assignat: la columna \"Data entrega\" del full està buida."}
            </p>
            <div className="flex h-56 items-stretch gap-3 overflow-x-auto pb-1">
              {mesos.map((m, i) => {
                const previ = i > 0 ? mesos[i - 1] : null;
                const canvi = previ ? variacio(m.facturat, previ.facturat) : null;
                return (
                  <div
                    key={m.full}
                    className="group flex h-full min-w-20 flex-1 flex-col items-center gap-1.5"
                    title={`${m.full} · ${m.entregats} entregues · ${euros(m.facturat)} €`}
                  >
                    {canvi !== null && (
                      <span
                        className={cn(
                          "text-[11px] font-semibold tabular-nums",
                          canvi >= 0 ? "text-[color:var(--success)]" : "text-destructive",
                        )}
                      >
                        {canvi >= 0 ? "+" : ""}
                        {String(canvi).replace(".", ",")}%
                      </span>
                    )}
                    <span className="text-xs font-semibold tabular-nums">
                      {euros(m.facturat)} €
                    </span>
                    <div className="flex min-h-0 w-full flex-1 items-end">
                      <div
                        className={cn(
                          "w-full rounded-t-lg transition-colors",
                          m.full === millor?.full ? "bg-primary" : "bg-primary/60 group-hover:bg-primary/80",
                        )}
                        style={{ height: `${Math.max(2, (m.facturat / maxFacturat) * 100)}%` }}
                      />
                    </div>
                    <span className="w-full truncate text-center text-[11px] text-muted-foreground">
                      {m.full}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── La tabla, ordenable ────────────────────────────────────── */}
          <div className="overflow-x-auto soft-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {COLUMNES.map((col, i) => {
                    const activa = ordre?.clau === col.clau;
                    return (
                      <th
                        key={col.clau}
                        className={cn(
                          "px-4 py-2.5 text-xs font-semibold uppercase tracking-wide",
                          !col.sempre && "hidden lg:table-cell",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setOrdre((previ) =>
                              previ?.clau === col.clau
                                ? { clau: col.clau, asc: !previ.asc }
                                : { clau: col.clau, asc: false },
                            )
                          }
                          aria-label={`Ordenar per ${col.etiqueta}`}
                          className={cn(
                            "flex w-full items-center gap-1",
                            col.dreta && "justify-end",
                            activa ? "text-primary" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {i > 0 && col.dreta && <ArrowUpDown className={cn("size-3", !activa && "opacity-0")} aria-hidden />}
                          {col.etiqueta}
                          {(i === 0 || !col.dreta) && <ArrowUpDown className={cn("size-3", !activa && "opacity-0")} aria-hidden />}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {ordenats.map((m) => (
                  <tr key={m.full} className="border-b border-border last:border-0">
                    {COLUMNES.map((col) => (
                      <td
                        key={col.clau}
                        className={cn(
                          "px-4 py-2 tabular-nums",
                          col.dreta && "text-right",
                          col.clau === "full" && "font-medium",
                          col.clau === "incidencies" && m.incidencies > 0 && "text-status-incidencia",
                          col.clau === "senseImport" && m.senseImport > 0 && "text-status-incidencia",
                          col.clau === "facturat" && "font-semibold",
                          !col.sempre && "hidden lg:table-cell",
                        )}
                      >
                        {col.format(m)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border">
                  {COLUMNES.map((col) => (
                    <td
                      key={col.clau}
                      className={cn(
                        "px-4 py-2.5 font-semibold tabular-nums",
                        col.dreta && "text-right",
                        !col.sempre && "hidden lg:table-cell",
                      )}
                    >
                      {col.clau === "full" ? "Total" : col.format(total)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="px-1 text-xs text-tertiary-foreground">
            «Mitjana» és per entrega amb import; «Per dia», el facturat entre els
            dies amb alguna entrega. Les entregues sense import no compten a cap
            de les dues: encara no se sap què valen.
          </p>
        </>
      )}
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
