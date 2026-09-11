"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Props {
  online: boolean;
  syncing: boolean;
  savedAt: string | null;
  pendingCount: number;
  error: string | null;
  onSync: () => void;
}

/**
 * Franja de estado de sincronización.
 *
 * El transportista necesita saber dos cosas de un vistazo: si lo que está
 * viendo está actualizado, y si lo que ha marcado ya ha llegado a la
 * oficina. Todo lo demás sobra.
 */
export default function SyncBar({
  online,
  syncing,
  savedAt,
  pendingCount,
  error,
  onSync,
}: Props) {
  /** Un error largo se abre a tocarlo, para poder leerlo entero. */
  const [obert, setObert] = useState(false);

  const state = syncing
    ? { dot: "bg-muted-foreground animate-pulse", text: "Sincronizando…" }
    : // Un error tiene que verse como error: si el punto sigue verde,
      // el transportista da por bueno un dato que no lo es.
      error
      ? { dot: "bg-destructive", text: error }
      : !online
        ? { dot: "bg-warning", text: "Sin conexión" }
        : pendingCount > 0
          ? { dot: "bg-warning", text: `${pendingCount} sin enviar` }
          : {
              dot: "bg-success",
              text: savedAt
                ? `Actualizado ${formatRelativeTime(savedAt)}`
                : "Al día",
            };

  return (
    <div className="px-4 pb-1.5">
      <div className="flex items-center gap-2">
        <span
          className={cn("size-1.5 shrink-0 rounded-full", state.dot)}
          aria-hidden
        />
        {/*
          Con error, la franja se puede tocar para abrirla.

          Los mensajes del servidor son largos —"Petición inválida: status —
          Invalid option", una variable de entorno que falta— y en una línea
          cortada no se lee ni la mitad. `title` no vale: en un móvil no hay
          ratón que dejar encima, y justo en el móvil es donde hace falta
          poder leerlo entero para contarlo.
        */}
        {error ? (
          <button
            type="button"
            onClick={() => setObert((v) => !v)}
            aria-expanded={obert}
            className={cn(
              "min-w-0 flex-1 text-left text-xs text-destructive",
              !obert && "truncate",
            )}
          >
            {error}
          </button>
        ) : (
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {state.text}
          </p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="-mr-3.5 h-7"
          onClick={onSync}
          disabled={syncing || !online}
        >
          <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      {error && obert && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Toca el missatge per plegar-lo.
        </p>
      )}
    </div>
  );
}
