"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { Stop } from "@/lib/types";
import { euros } from "@/lib/factura";
import { cn } from "@/lib/utils";

/**
 * Búsqueda global sobre todas las comandas del full.
 *
 * Se abre con ⌘K / Ctrl+K y busca en número, cliente, dirección y población
 * a la vez. La de Historial seguía existiendo pero solo miraba lo ya
 * entregado, así que buscar una comanda que aún estaba pendiente no daba
 * nada — que es justo cuando la buscas.
 *
 * Sale de lo que hay en IndexedDB, así que funciona sin cobertura.
 */

const ETIQUETA_ESTAT: Record<string, { texto: string; color: string }> = {
  pendent: { texto: "Pendent", color: "var(--primary)" },
  en_curs: { texto: "En curs", color: "var(--status-en-curs)" },
  entregat: { texto: "Entregat", color: "var(--success)" },
  incidencia: { texto: "Incidència", color: "var(--warning)" },
};

/** Cuántos resultados se enseñan. Más no caben ni hacen falta: afina la búsqueda. */
const MAX_RESULTATS = 12;

/**
 * Quien lo abre lo monta y quien lo cierra lo desmonta: no hay un `obert`
 * que sincronizar. Así la consulta y la fila resaltada arrancan limpias cada
 * vez sin un efecto que las vaya reseteando.
 */
export default function Cercador({
  stops,
  onTancar,
  onObrir,
}: {
  stops: Stop[];
  onTancar: () => void;
  /** Qué hacer con la comanda elegida. */
  onObrir: (stop: Stop) => void;
}) {
  const [consulta, setConsulta] = useState("");
  const [i, setI] = useState(0);
  const llistaRef = useRef<HTMLUListElement>(null);

  const resultats = useMemo(() => {
    const q = consulta.trim().toLowerCase();
    if (q === "") {
      // Sin nada escrito, lo que hay por hacer: es lo que se busca el 90%
      // de las veces y ahorra teclear.
      return stops
        .filter((s) => s.statusCategory === "pendent" || s.statusCategory === "en_curs")
        .slice(0, MAX_RESULTATS);
    }
    // Todas las palabras tienen que aparecer en algún sitio de la comanda:
    // así "aribau 1045" encuentra la de Aribau con ese número.
    const paraules = q.split(/\s+/);
    return stops
      .filter((s) => {
        const heno = [s.id, s.customer, s.address, s.city, s.notes]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return paraules.every((p) => heno.includes(p));
      })
      .slice(0, MAX_RESULTATS);
  }, [stops, consulta]);

  useEffect(() => {
    llistaRef.current?.children[i]?.scrollIntoView({ block: "nearest" });
  }, [i]);

  const teclat = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setI((n) => Math.min(n + 1, resultats.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setI((n) => Math.max(n - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const triat = resultats[i];
      if (triat) onObrir(triat);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onTancar();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex animate-fade-in items-start justify-center bg-black/40 p-4 pt-[10vh] backdrop-blur-sm"
      onClick={onTancar}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-5 shrink-0 text-tertiary-foreground" aria-hidden />
          <input
            autoFocus
            value={consulta}
            onChange={(e) => {
              setConsulta(e.target.value);
              // El resaltado vuelve arriba con cada tecla: si no, se quedaba
              // señalando la fila cuarta de una lista que ya es de dos.
              setI(0);
            }}
            onKeyDown={teclat}
            placeholder="Cerca per comanda, client, adreça o població…"
            aria-label="Cercar comandes"
            className="flex-1 bg-transparent py-4 text-base outline-none placeholder:text-tertiary-foreground"
          />
          <button
            type="button"
            onClick={onTancar}
            aria-label="Tancar"
            className="pressable rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>

        {resultats.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {consulta.trim() === ""
              ? "No et queda cap comanda per fer."
              : "Cap comanda coincideix."}
          </p>
        ) : (
          <ul ref={llistaRef} className="max-h-[55vh] overflow-y-auto py-1">
            {resultats.map((stop, n) => {
              const estat = ETIQUETA_ESTAT[stop.statusCategory];
              return (
                <li key={stop.id}>
                  <button
                    type="button"
                    onClick={() => onObrir(stop)}
                    onMouseMove={() => setI(n)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2.5 text-left",
                      n === i && "bg-muted",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        <span className="tabular-nums">{stop.id}</span>
                        {stop.customer && (
                          <span className="text-muted-foreground"> · {stop.customer}</span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[stop.address, stop.city].filter(Boolean).join(", ") || "Sense adreça"}
                        {stop.date && ` · ${stop.date.split("-").reverse().join("/")}`}
                      </p>
                    </div>
                    {stop.price !== null && stop.price > 0 && (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {euros(stop.price)} €
                      </span>
                    )}
                    {estat && (
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{
                          background: `color-mix(in srgb, ${estat.color} 14%, transparent)`,
                          color: estat.color,
                        }}
                      >
                        {estat.texto}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="hidden items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-tertiary-foreground sm:flex">
          <span>↑↓ per moure&apos;t</span>
          <span>↵ per obrir</span>
          <span>Esc per tancar</span>
        </p>
      </div>
    </div>
  );
}
