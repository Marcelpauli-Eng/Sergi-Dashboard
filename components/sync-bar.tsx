"use client";

import { formatRelativeTime } from "@/lib/format";

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
    ? { dot: "bg-brand animate-pulse", text: "Sincronizando…" }
    : // Un error tiene que verse como error: si el punto sigue verde,
      // el transportista da por bueno un dato que no lo es.
      error
      ? { dot: "bg-danger", text: error }
      : !online
        ? { dot: "bg-warn", text: "Sin conexión" }
        : pendingCount > 0
          ? { dot: "bg-warn", text: `${pendingCount} sin enviar` }
          : {
              dot: "bg-ok",
              text: savedAt
                ? `Actualizado ${formatRelativeTime(savedAt)}`
                : "Al día",
            };

  return (
    <div className="flex items-center gap-3 border-t border-line bg-surface px-4 py-2.5">
      <span className={`size-2.5 shrink-0 rounded-full ${state.dot}`} aria-hidden />
      <p
        className={`min-w-0 flex-1 truncate text-sm ${
          error ? "text-danger" : "text-muted"
        }`}
      >
        {state.text}
      </p>
      <button
        type="button"
        onClick={onSync}
        disabled={syncing || !online}
        className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-brand active:bg-canvas disabled:opacity-40"
      >
        Actualizar
      </button>
    </div>
  );
}
