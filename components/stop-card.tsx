"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check, Navigation, Phone, TriangleAlert, X } from "lucide-react";
import type { Stop } from "@/lib/types";
import { formatDistance, formatDuration, telHref } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  stop: Stop;
  onDelivered: (orderId: string) => void;
  onIncident: (orderId: string, note: string) => void;
  /** Si true, muestra los botones de subir/bajar. */
  reorderable?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  /** Si se pasa, muestra un botón para desasignar la parada (p. ej. del calendario). */
  onRemove?: () => void;
}

const CATEGORY_BADGE: Record<
  string,
  { label: string; variant: "success" | "warning" | "secondary" | "default"; className?: string }
> = {
  entregat: { label: "Entregat", variant: "success" },
  incidencia: { label: "Incidència", variant: "warning" },
  en_curs: {
    label: "En curs",
    variant: "secondary",
    className: "bg-[color-mix(in_srgb,var(--status-en-curs)_15%,transparent)] text-status-en-curs",
  },
};

/**
 * Una parada de la ruta, como una celda de lista agrupada de iOS: fondo
 * blanco sobre el gris de la pantalla, esquinas redondeadas y sin sombra.
 * La separación la da el fondo, no una sombra difusa.
 *
 * El color se reserva para lo que informa: azul para lo pulsable, y el color
 * de cada categoría de estado (pendent/en curs/entregat/incidència).
 */
export default function StopCard({
  stop,
  onDelivered,
  onIncident,
  reorderable,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  onRemove,
}: Props) {
  const [showIncident, setShowIncident] = useState(false);
  const [showNav, setShowNav] = useState(false);
  const [note, setNote] = useState("");

  // `false` durante el render de servidor y `true` ya en el cliente, sin
  // pasar por un estado: createPortal necesita el DOM, que en el servidor no
  // existe. Hacerlo con un `setState` en un efecto provoca un render extra
  // en cada tarjeta de la lista.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Un pedido "en curs" sigue abierto: es un reparto en marcha, el estado más
  // accionable de todos. Solo "entregat" e "incidencia" están cerrados.
  //
  // Compararlo únicamente con "pendent" lo daba por cerrado: la tarjeta salía
  // atenuada y sin el bloque de acciones, así que no había manera de marcarlo
  // como entregado desde la app aunque la lista sí lo mostrara.
  const isOpen =
    stop.statusCategory === "pendent" || stop.statusCategory === "en_curs";
  const done = !isOpen;

  // Quién conserva los botones: todo lo que no esté ya entregado.
  //
  // Una incidencia no es definitiva. "No estaba en casa" hoy puede acabar
  // entregándose mañana, y sin botón la única forma de cerrarla era editar la
  // hoja a mano. Mantiene el aspecto apagado —no es una parada activa de la
  // ruta— pero sigue pudiendo marcarse.
  //
  // Un pedido ya entregado sí los pierde: volver a marcarlo solo serviría
  // para pisar la hora de entrega que quedó guardada en la hoja.
  const canClose = stop.statusCategory !== "entregat";
  const leg = [
    formatDistance(stop.legDistanceMeters),
    formatDuration(stop.legDurationSeconds),
  ]
    .filter(Boolean)
    .join(" · ");

  const badgeInfo = CATEGORY_BADGE[stop.statusCategory ?? ""];

  return (
    // Los estilos de la tarjeta van directos al <li>: envolverlo en un <div>
    // rompería la semántica de la lista.
    <li className="animate-rise-in overflow-hidden rounded-xl bg-card text-card-foreground">
      <div className={cn("flex gap-3 p-4", done && "opacity-55")}>
        {/* Controles de orden manual (solo pendientes) */}
        {reorderable && isOpen && (
          <div className="flex shrink-0 flex-col items-center justify-center gap-1 text-tertiary-foreground">
            <button
              className="pressable rounded-md p-1 disabled:opacity-30"
              onClick={onMoveUp}
              disabled={isFirst}
              aria-label="Pujar"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
            </button>
            <button
              className="pressable rounded-md p-1 disabled:opacity-30"
              onClick={onMoveDown}
              disabled={isLast}
              aria-label="Baixar"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          </div>
        )}

        {/* Número de parada */}
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white",
            stop.statusCategory === "entregat"
              ? "bg-success"
              : stop.statusCategory === "incidencia"
                ? "bg-warning"
                : stop.statusCategory === "en_curs"
                  ? "bg-status-en-curs"
                  : "bg-primary",
          )}
          aria-hidden
        >
          {stop.statusCategory === "entregat" ? (
            <Check className="size-4" strokeWidth={2.5} />
          ) : stop.statusCategory === "incidencia" ? (
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
            {badgeInfo && (
              <Badge variant={badgeInfo.variant} className={badgeInfo.className}>
                {badgeInfo.label}
              </Badge>
            )}
            {onRemove && (
              <button
                onClick={onRemove}
                className="pressable shrink-0 rounded-full bg-muted p-1 text-muted-foreground"
                aria-label="Treure del dia"
              >
                <X className="size-3.5" strokeWidth={2.5} />
              </button>
            )}
          </div>

          {/* Dirección y población */}
          <p className="mt-0.5 text-sm text-muted-foreground">{stop.address}</p>
          {stop.city && (
            <p className="text-sm text-muted-foreground">{stop.city}</p>
          )}

          {/* Nº comanda y fecha de creación */}
          <div className="mt-1 flex items-center gap-1.5 text-xs text-tertiary-foreground">
            <p className="font-mono">{stop.id}</p>
            {stop.creationDate && (
              <>
                <span aria-hidden>·</span>
                <p>
                  Creat:{" "}
                  {stop.creationDate.match(/^\d{4}-\d{2}-\d{2}$/)
                    ? stop.creationDate.split("-").reverse().join("/")
                    : stop.creationDate}
                </p>
              </>
            )}
          </div>

          {stop.measures && (
            <p className="mt-1 text-xs text-tertiary-foreground">📦 {stop.measures}</p>
          )}

          {leg && isOpen && (
            <p className="mt-1 text-xs text-tertiary-foreground">
              {leg} des de la parada anterior
            </p>
          )}

          {stop.notes && (
            <p className="mt-2.5 rounded-lg bg-warning-surface px-3 py-2 text-sm text-warning-foreground">
              {stop.notes}
            </p>
          )}

          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowNav(true)}>
                <Navigation />
                Navegar
              </Button>
              {stop.phone && (
                <Button asChild variant="secondary" size="sm">
                  <a href={telHref(stop.phone)}>
                    <Phone />
                    Trucar
                  </a>
                </Button>
              )}
            </div>

            {/* Selector de app de navegación, como el action sheet de iOS. */}
            {showNav && mounted && createPortal(
              <div className="fixed inset-0 z-50 flex flex-col justify-end">
                <div
                  className="absolute inset-0 animate-fade-in bg-black/40 backdrop-blur-sm"
                  onClick={() => setShowNav(false)}
                />
                <div className="relative w-full animate-rise-in rounded-t-[20px] bg-[#1c1c1e] p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-white shadow-2xl">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-semibold tracking-tight">Seleccionar aplicació</h3>
                    <button
                      onClick={() => setShowNav(false)}
                      className="pressable rounded-full bg-[#3a3a3c] p-1.5"
                      aria-label="Tancar"
                    >
                      <X className="size-5" />
                    </button>
                  </div>

                  <div className="flex flex-col overflow-hidden rounded-xl bg-[#2c2c2e]">
                    <a
                      href={stop.lat ? `http://maps.apple.com/?daddr=${stop.lat},${stop.lng}&dirflg=d` : `http://maps.apple.com/?daddr=${encodeURIComponent(stop.address)}&dirflg=d`}
                      target="_blank" rel="noopener noreferrer"
                      className="border-b border-white/10 px-4 py-3.5 text-[17px] text-[#0a84ff] transition-colors active:bg-[#3a3a3c]"
                    >
                      Mapes
                    </a>
                    <a
                      href={stop.lat ? `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}&travelmode=driving`}
                      target="_blank" rel="noopener noreferrer"
                      className="border-b border-white/10 px-4 py-3.5 text-[17px] text-[#0a84ff] transition-colors active:bg-[#3a3a3c]"
                    >
                      Google Maps
                    </a>
                    <a
                      href={stop.lat ? `https://waze.com/ul?ll=${stop.lat},${stop.lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(stop.address)}&navigate=yes`}
                      target="_blank" rel="noopener noreferrer"
                      className="px-4 py-3.5 text-[17px] text-[#0a84ff] transition-colors active:bg-[#3a3a3c]"
                    >
                      Waze
                    </a>
                  </div>
                </div>
              </div>,
              document.body,
            )}
          </div>
        </div>
      </div>

      {canClose && (
        <div className="hairline p-3.5">
          {!showIncident ? (
            <div className="flex items-center gap-1">
              <Button size="touch" className="flex-1" onClick={() => onDelivered(stop.id)}>
                <Check strokeWidth={2.5} />
                Entregat
              </Button>
              <Button variant="ghost" size="touch" onClick={() => setShowIncident(true)}>
                Incidència
              </Button>
            </div>
          ) : (
            <div className="animate-fade-in space-y-3">
              <label htmlFor={`note-${stop.id}`} className="block text-sm font-medium">
                Què ha passat?
              </label>
              <textarea
                id={`note-${stop.id}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={500}
                autoFocus
                placeholder="Absent, adreça incorrecta, rebutjat…"
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
