"use client";

import { useState } from "react";
import type { Stop } from "@/lib/types";
import { formatDistance, formatDuration, telHref } from "@/lib/format";

interface Props {
  stop: Stop;
  onDelivered: (orderId: string) => void;
  onIncident: (orderId: string, note: string) => void;
}

/**
 * Una parada de la ruta.
 *
 * Prioridades de diseño, en este orden: que se lea de un vistazo con el
 * móvil en el salpicadero, que el botón principal sea imposible de fallar
 * con el pulgar, y que navegar esté a un solo toque.
 */
export default function StopCard({ stop, onDelivered, onIncident }: Props) {
  const [showIncident, setShowIncident] = useState(false);
  const [note, setNote] = useState("");

  const done = stop.status !== "pendiente";
  const leg = [
    formatDistance(stop.legDistanceMeters),
    formatDuration(stop.legDurationSeconds),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li
      className={`overflow-hidden rounded-2xl border border-line bg-surface ${
        done ? "opacity-60" : ""
      }`}
    >
      <div className="flex gap-4 p-4">
        {/* Número de parada */}
        <div
          className={`flex size-11 shrink-0 items-center justify-center rounded-full text-lg font-bold ${
            stop.status === "entregado"
              ? "bg-ok-soft text-ok"
              : stop.status === "incidencia"
                ? "bg-warn-soft text-warn"
                : "bg-brand text-white"
          }`}
          aria-hidden
        >
          {stop.status === "entregado" ? "✓" : stop.status === "incidencia" ? "!" : stop.sequence}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold leading-tight text-ink">
            {stop.customer || stop.address}
          </p>
          <p className="mt-1 text-[15px] leading-snug text-muted">{stop.address}</p>

          {leg && !done && (
            <p className="mt-1.5 text-sm text-muted">
              <span aria-hidden>↳ </span>
              {leg} desde la parada anterior
            </p>
          )}

          {stop.notes && (
            <p className="mt-2.5 rounded-lg bg-warn-soft px-3 py-2 text-[15px] leading-snug text-warn">
              {stop.notes}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={stop.navUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-canvas px-3 py-2 text-sm font-semibold text-ink active:bg-line"
            >
              <span aria-hidden>➤</span> Navegar
            </a>
            {stop.phone && (
              <a
                href={telHref(stop.phone)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-canvas px-3 py-2 text-sm font-semibold text-ink active:bg-line"
              >
                <span aria-hidden>✆</span> Llamar
              </a>
            )}
          </div>
        </div>
      </div>

      {!done && (
        <div className="border-t border-line p-3">
          {!showIncident ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onDelivered(stop.id)}
                className="flex-1 rounded-xl bg-ok px-4 py-4 text-lg font-bold text-white transition active:brightness-90"
              >
                Entregado
              </button>
              <button
                type="button"
                onClick={() => setShowIncident(true)}
                className="shrink-0 rounded-xl px-4 py-4 text-sm font-semibold text-muted active:bg-canvas"
              >
                Incidencia
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <label
                htmlFor={`note-${stop.id}`}
                className="block text-sm font-semibold text-ink"
              >
                ¿Qué ha pasado?
              </label>
              <textarea
                id={`note-${stop.id}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Ausente, dirección incorrecta, rechazado…"
                className="w-full rounded-xl border border-line bg-surface px-3 py-3 text-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    onIncident(stop.id, note.trim());
                    setShowIncident(false);
                    setNote("");
                  }}
                  className="flex-1 rounded-xl bg-warn px-4 py-3 text-base font-bold text-white active:brightness-90"
                >
                  Guardar incidencia
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowIncident(false);
                    setNote("");
                  }}
                  className="rounded-xl px-4 py-3 text-base font-semibold text-muted active:bg-canvas"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
