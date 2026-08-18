"use client";

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
    <div className="flex items-center gap-2 px-4 pb-1.5">
      <span
        className={cn("size-1.5 shrink-0 rounded-full", state.dot)}
        aria-hidden
      />
      <p
        className={cn(
          "min-w-0 flex-1 truncate text-xs",
          error ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {state.text}
      </p>
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
  );
}
