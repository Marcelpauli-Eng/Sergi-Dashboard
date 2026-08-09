"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Check, GripVertical, Navigation, Phone, TriangleAlert, ChevronDown, X } from "lucide-react";
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
}

const CATEGORY_BADGE: Record<string, { label: string; variant: "success" | "warning" | "secondary" | "default"; className?: string }> = {
  entregat: { label: "Entregat", variant: "success" },
  incidencia: { label: "Incidència", variant: "warning" },
  en_curs: { label: "En curs", variant: "secondary", className: "border-purple-300 bg-purple-50 text-purple-700" },
};

/**
 * Una parada de la ruta.
 *
 * Sigue la regla del sistema de diseño: todo en escala de grises salvo el
 * estado de la entrega, que es la única información que merece color.
 */
export default function StopCard({ 
  stop, 
  onDelivered, 
  onIncident, 
  reorderable,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast
}: Props) {
  const [showIncident, setShowIncident] = useState(false);
  const [showNav, setShowNav] = useState(false);
  const [note, setNote] = useState("");

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isPendent = stop.statusCategory === "pendent";
  const done = !isPendent;
  const leg = [
    formatDistance(stop.legDistanceMeters),
    formatDuration(stop.legDurationSeconds),
  ]
    .filter(Boolean)
    .join(" · ");

  const badgeInfo = CATEGORY_BADGE[stop.statusCategory ?? ""];

  return (
    // Los estilos de Card van directos al <li>: envolverlo en un <div>
    // rompería la semántica de la lista.
    <li
      className={cn(
        "animate-rise-in rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        done && "opacity-55",
      )}
    >
        <div className="flex gap-3 p-5">
          {/* Controles de orden manual (solo pendientes) */}
          {reorderable && isPendent && (
            <div className="flex shrink-0 flex-col items-center justify-center gap-2 text-muted-foreground">
              <button 
                className="p-1 disabled:opacity-30" 
                onClick={onMoveUp} 
                disabled={isFirst}
                aria-label="Pujar"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
              </button>
              <button 
                className="p-1 disabled:opacity-30" 
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
            className={
              done
                ? "flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground"
                : "flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
            }
            aria-hidden
          >
            {stop.statusCategory === "entregat" ? (
              <Check className="size-4" />
            ) : stop.statusCategory === "incidencia" ? (
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
              {badgeInfo && (
                <Badge variant={badgeInfo.variant} className={badgeInfo.className}>
                  {badgeInfo.label}
                </Badge>
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

            {/* Nº Comanda y Fecha Creación */}
            <div className="mt-1 flex items-center gap-2">
              <p className="font-mono text-[11px] text-muted-foreground">
                {stop.id}
              </p>
              {stop.creationDate && (
                <>
                  <span className="text-[10px] text-muted-foreground/40">•</span>
                  <p className="text-[11px] text-muted-foreground">
                    Creat: {stop.creationDate}
                  </p>
                </>
              )}
            </div>

            {/* Medidas */}
            {stop.measures && (
              <p className="mt-1 text-xs text-muted-foreground">
                📦 {stop.measures}
              </p>
            )}

            {leg && isPendent && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {leg} des de la parada anterior
              </p>
            )}

            {stop.notes && (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-snug text-amber-800">
                {stop.notes}
              </p>
            )}

            <div className="mt-4 flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => setShowNav(true)}>
                  <Navigation className="mr-1 size-4" />
                  Navegar
                </Button>
                {stop.phone && (
                  <Button asChild variant="secondary" size="sm">
                    <a href={telHref(stop.phone)}>
                      <Phone className="mr-1 size-4" />
                      Trucar
                    </a>
                  </Button>
                )}
              </div>
              
              {/* iOS-style Bottom Sheet para Navegación */}
              {showNav && mounted && createPortal(
                <div className="fixed inset-0 z-50 flex flex-col justify-end">
                  <div 
                    className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in"
                    onClick={() => setShowNav(false)}
                  />
                  <div className="relative w-full bg-[#1c1c1e] text-white rounded-t-[20px] p-5 pb-8 shadow-2xl animate-in slide-in-from-bottom-full duration-300 ease-out">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold tracking-tight">Seleccionar aplicación</h3>
                      <button 
                        onClick={() => setShowNav(false)}
                        className="rounded-full bg-[#3a3a3c] p-1.5 hover:bg-[#4a4a4c] transition-colors"
                      >
                        <X className="size-5" />
                      </button>
                    </div>
                    
                    <div className="flex flex-col rounded-xl bg-[#2c2c2e] overflow-hidden">
                      <a 
                        href={stop.lat ? `http://maps.apple.com/?daddr=${stop.lat},${stop.lng}&dirflg=d` : `http://maps.apple.com/?daddr=${encodeURIComponent(stop.address)}&dirflg=d`} 
                        target="_blank" rel="noopener noreferrer"
                        className="px-4 py-3.5 text-[17px] active:bg-[#3a3a3c] transition-colors border-b border-white/10"
                      >
                        Mapas
                      </a>
                      <a 
                        href={stop.lat ? `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}&travelmode=driving`} 
                        target="_blank" rel="noopener noreferrer"
                        className="px-4 py-3.5 text-[17px] active:bg-[#3a3a3c] transition-colors border-b border-white/10"
                      >
                        Google Maps
                      </a>
                      <a 
                        href={stop.lat ? `https://waze.com/ul?ll=${stop.lat},${stop.lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(stop.address)}&navigate=yes`} 
                        target="_blank" rel="noopener noreferrer"
                        className="px-4 py-3.5 text-[17px] active:bg-[#3a3a3c] transition-colors"
                      >
                        Waze
                      </a>
                    </div>
                  </div>
                </div>,
                document.body
              )}
            </div>
          </div>
        </div>

        {isPendent && (
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
