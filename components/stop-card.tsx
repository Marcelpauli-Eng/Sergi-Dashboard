"use client";

import { useState } from "react";
import { Check, Navigation, Phone, TriangleAlert } from "lucide-react";
import type { Stop } from "@/lib/types";
import { formatDistance, formatDuration, telHref } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  stop: Stop;
  onDelivered: (orderId: string) => void;
  onIncident: (orderId: string, note: string) => void;
}

/**
 * Una parada de la ruta.
 *
 * Sigue la regla del sistema de diseño: todo en escala de grises salvo el
 * estado de la entrega, que es la única información que merece color.
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
    // Los estilos de Card van directos al <li>: envolverlo en un <div>
    // rompería la semántica de la lista.
    <li
      className={cn(
        "animate-rise-in rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        done && "opacity-55",
      )}
    >
        <div className="flex gap-4 p-5">
          {/* Número de parada */}
          <div
            className={
              done
                ? "flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground"
                : "flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
            }
            aria-hidden
          >
            {stop.status === "entregado" ? (
              <Check className="size-4" />
            ) : stop.status === "incidencia" ? (
              <TriangleAlert className="size-4" />
            ) : (
              stop.sequence
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 truncate font-semibold leading-tight tracking-tight">
                {stop.customer || stop.address}
              </p>
              {stop.status === "entregado" && <Badge variant="success">Entregat</Badge>}
              {stop.status === "incidencia" && (
                <Badge variant="warning">Incidència</Badge>
              )}
            </div>

            {/* Dirección y Población */}
            <p className="mt-1 text-sm leading-snug text-muted-foreground">
              {stop.address}
            </p>
            {stop.city && (
              <p className="text-sm text-muted-foreground">
                {stop.city}
              </p>
            )}

            {/* Nº Comanda */}
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {stop.id}
            </p>

            {/* Medidas */}
            {stop.measures && (
              <p className="mt-1 text-xs text-muted-foreground">
                📦 {stop.measures}
              </p>
            )}

            {leg && !done && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {leg} desde la parada anterior
              </p>
            )}

            {stop.notes && (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-snug text-amber-800">
                {stop.notes}
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild variant="secondary" size="sm">
                <a href={stop.navUrl} target="_blank" rel="noopener noreferrer">
                  <Navigation />
                  Navegar
                </a>
              </Button>
              {stop.phone && (
                <Button asChild variant="secondary" size="sm">
                  <a href={telHref(stop.phone)}>
                    <Phone />
                    Llamar
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>

        {!done && (
          <div className="border-t border-border p-4">
            {!showIncident ? (
              <div className="flex items-center gap-2">
                <Button
                  size="touch"
                  className="flex-1"
                  onClick={() => onDelivered(stop.id)}
                >
                  <Check />
                  Entregat
                </Button>
                <Button
                  variant="ghost"
                  size="touch"
                  onClick={() => setShowIncident(true)}
                >
                  Incidència
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <label
                  htmlFor={`note-${stop.id}`}
                  className="block text-sm font-medium"
                >
                  Què ha passat?
                </label>
                <textarea
                  id={`note-${stop.id}`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Absent, adreça incorrecta, rebutjat…"
                  className="w-full rounded-md border border-input bg-card px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
                />
                <div className="flex gap-2">
                  <Button
                    size="touch"
                    className="flex-1"
                    onClick={() => {
                      onIncident(stop.id, note.trim());
                      setShowIncident(false);
                      setNote("");
                    }}
                  >
                    Guardar incidència
                  </Button>
                  <Button
                    variant="ghost"
                    size="touch"
                    onClick={() => {
                      setShowIncident(false);
                      setNote("");
                    }}
                  >
                    Cancel·lar
                  </Button>
                </div>
              </div>
            )}
        </div>
      )}
    </li>
  );
}
