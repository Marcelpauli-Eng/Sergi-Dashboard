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
 * Una parada de la ruta, como una celda de lista agrupada de iOS: fondo
 * blanco sobre el gris de la pantalla, esquinas redondeadas y sin sombra.
 * La separación la da el fondo, no una sombra difusa.
 *
 * El color se reserva para lo que informa: azul para lo pulsable, verde y
 * naranja para el estado de la entrega. El resto es texto y gris.
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
    // Los estilos de la tarjeta van directos al <li>: envolverlo en un <div>
    // rompería la semántica de la lista.
    <li className="overflow-hidden rounded-xl bg-card text-card-foreground">
      <div className={cn("flex gap-3.5 p-4", done && "opacity-55")}>
        {/* Número de parada */}
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white",
            stop.status === "entregado"
              ? "bg-success"
              : stop.status === "incidencia"
                ? "bg-warning"
                : "bg-primary",
          )}
          aria-hidden
        >
          {stop.status === "entregado" ? (
            <Check className="size-4" strokeWidth={2.5} />
          ) : stop.status === "incidencia" ? (
            <TriangleAlert className="size-3.5" strokeWidth={2.5} />
          ) : (
            stop.sequence
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 flex-1 truncate text-base font-semibold">
              {stop.customer || stop.address}
            </p>
            {stop.status === "entregado" && (
              <Badge variant="success">Entregado</Badge>
            )}
            {stop.status === "incidencia" && (
              <Badge variant="warning">Incidencia</Badge>
            )}
          </div>

          <p className="mt-0.5 text-sm text-muted-foreground">{stop.address}</p>

          {leg && !done && (
            <p className="mt-1 text-xs text-tertiary-foreground">
              {leg} desde la parada anterior
            </p>
          )}

          {stop.notes && (
            <p className="mt-2.5 rounded-lg bg-warning-surface px-3 py-2 text-sm text-warning-foreground">
              {stop.notes}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
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
        <div className="hairline p-3.5">
          {!showIncident ? (
            <div className="flex items-center gap-1">
              <Button size="touch" className="flex-1" onClick={() => onDelivered(stop.id)}>
                <Check strokeWidth={2.5} />
                Entregado
              </Button>
              <Button variant="ghost" size="touch" onClick={() => setShowIncident(true)}>
                Incidencia
              </Button>
            </div>
          ) : (
            <div className="animate-fade-in space-y-3">
              <label htmlFor={`note-${stop.id}`} className="block text-sm font-medium">
                ¿Qué ha pasado?
              </label>
              <textarea
                id={`note-${stop.id}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={500}
                autoFocus
                placeholder="Ausente, dirección incorrecta, rechazado…"
                className="w-full resize-none rounded-lg bg-muted px-3 py-2.5 text-base placeholder:text-tertiary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <div className="flex gap-1">
                <Button
                  size="touch"
                  className="flex-1"
                  onClick={() => {
                    onIncident(stop.id, note.trim());
                    setShowIncident(false);
                    setNote("");
                  }}
                >
                  Guardar
                </Button>
                <Button
                  variant="ghost"
                  size="touch"
                  onClick={() => {
                    setShowIncident(false);
                    setNote("");
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
