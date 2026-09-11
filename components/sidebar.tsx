"use client";

import { useRouter } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  ChevronsUpDown,
  Clock,
  FileText,
  History,
  LogOut,
  Phone,
  Search,
  Settings,
  Truck,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Barra lateral de ordenador y iPad.
 *
 * La app es la misma: en el móvil se navega con la barra de abajo y a partir
 * de `lg` con esta, que cabe entera sin robar sitio al contenido. No hay una
 * versión de escritorio aparte a propósito —sería el doble de código y el
 * doble de sitios donde arreglar cada cosa—, solo puntos de ruptura.
 */

export type Seccion =
  | "avui"
  | "trucades"
  | "calendari"
  | "historial"
  | "factures"
  | "cobraments"
  | "informes";

const GRUPOS: { titol: string; items: { id: Seccion; label: string; icona: typeof Clock }[] }[] = [
  {
    titol: "Repartiment",
    items: [
      { id: "avui", label: "Avui", icona: Clock },
      { id: "trucades", label: "Trucades", icona: Phone },
      { id: "calendari", label: "Calendari", icona: CalendarDays },
      { id: "historial", label: "Historial", icona: History },
    ],
  },
  {
    titol: "Administració",
    items: [
      { id: "factures", label: "Factures", icona: FileText },
      { id: "cobraments", label: "Cobraments", icona: Wallet },
      { id: "informes", label: "Informes", icona: BarChart3 },
    ],
  },
];

export default function Sidebar({
  activa,
  onSeccio,
  driverName,
  full,
  fulls,
  onFull,
  onCercar,
  onAjustos,
}: {
  activa: Seccion;
  onSeccio: (seccion: Seccion) => void;
  driverName: string;
  /** Pestaña del Sheet en uso, para no perder de vista qué mes se está viendo. */
  full: string;
  /** Todas las pestañas del Sheet. Vacío mientras no se hayan podido leer. */
  fulls: string[];
  onFull: (full: string) => void;
  onCercar: () => void;
  onAjustos: () => void;
}) {
  const router = useRouter();

  const tancarSessio = async () => {
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  };

  return (
    <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <Truck className="size-6 text-primary" />
        <span className="text-xl font-semibold tracking-tight">
          Rep<span className="text-primary">arto</span>
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3">
        {/* Arriba del todo porque es lo que más se toca, y con el atajo a la
            vista para que se aprenda solo. */}
        <button
          onClick={onCercar}
          className="mb-5 flex w-full items-center gap-3 rounded-xl bg-muted px-3 py-2.5 text-left text-[15px] text-muted-foreground hover:bg-muted/70"
        >
          <Search className="size-5 shrink-0" strokeWidth={1.8} />
          <span className="flex-1">Cercar</span>
          <kbd className="rounded border border-border bg-card px-1.5 py-0.5 text-[11px] font-medium text-tertiary-foreground">
            ⌘K
          </kbd>
        </button>

        {GRUPOS.map((grupo) => (
          <div key={grupo.titol} className="mb-5">
            <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary-foreground">
              {grupo.titol}
            </p>
            <ul className="space-y-0.5">
              {grupo.items.map(({ id, label, icona: Icona }) => (
                <li key={id}>
                  <button
                    onClick={() => onSeccio(id)}
                    aria-current={activa === id ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium",
                      activa === id
                        ? "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-primary"
                        : "text-foreground hover:bg-muted",
                    )}
                  >
                    <Icona className="size-5 shrink-0" strokeWidth={activa === id ? 2.2 : 1.8} />
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/*
          El mes de trabajo se cambia aquí y no escondido en el menú ☰: en
          pantalla grande es un dato que se consulta y se cambia a menudo.
          Un <select> del sistema en vez de un desplegable propio — hace lo
          mismo, lo pinta el navegador y funciona con teclado de serie.
        */}
        <div className="mb-5">
          <label
            htmlFor="full-actiu"
            className="mb-1.5 block px-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary-foreground"
          >
            Full
          </label>
          {/* El icono y el galón son adorno encima del `select`: van con
              `pointer-events-none` para que el clic siga llegando al
              desplegable del navegador, que es quien abre la lista. */}
          <div className="relative">
            <CalendarRange
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary"
              strokeWidth={1.8}
              aria-hidden
            />
            <select
              id="full-actiu"
              value={full}
              onChange={(e) => onFull(e.target.value)}
              disabled={fulls.length === 0}
              className="w-full cursor-pointer appearance-none truncate rounded-xl border border-border bg-muted py-2.5 pl-9 pr-9 text-[15px] font-medium outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-60"
            >
              {full === "" && <option value="">Sense full</option>}
              {/* El full en uso puede no estar en la lista (modo demo, o una
                  pestaña renombrada): sin esta opción el <select> mostraría
                  otro nombre distinto del que se está viendo de verdad. */}
              {full !== "" && !fulls.includes(full) && <option value={full}>{full}</option>}
              {fulls.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <ChevronsUpDown
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-tertiary-foreground"
              strokeWidth={1.8}
              aria-hidden
            />
          </div>
          <p className="mt-1.5 px-2 text-[11px] text-tertiary-foreground">
            {fulls.length === 0
              ? "Carregant fulls…"
              : `${fulls.length} ${fulls.length === 1 ? "full" : "fulls"} disponibles`}
          </p>
        </div>

        <button
          onClick={onAjustos}
          className="mb-5 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium text-foreground hover:bg-muted"
        >
          <Settings className="size-5 shrink-0" strokeWidth={1.8} />
          Ajustos
        </button>
      </nav>

      <div className="flex items-center gap-3 border-t border-border px-4 py-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          {driverName.slice(0, 1).toUpperCase()}
        </div>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{driverName}</p>
        <button
          onClick={() => void tancarSessio()}
          className="pressable rounded-lg p-2 text-muted-foreground hover:bg-muted"
          aria-label="Tancar sessió"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </aside>
  );
}
