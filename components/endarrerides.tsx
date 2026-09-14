"use client";

import { useState } from "react";
import { CalendarX2, Inbox } from "lucide-react";
import { formatLongDate } from "@/lib/dates";
import type { Stop } from "@/lib/types";
import { Button } from "@/components/ui/button";

/**
 * Las comandas de un día que ya pasó y que nadie cerró.
 *
 * Hasta ahora se quedaban en su día del calendario y no aparecían por ningún
 * otro sitio: ni en Avui, que solo enseña las de hoy, ni en la bossa, que son
 * las que no tienen día. Se perdían de vista hasta que alguien se acordaba de
 * mirar atrás en el calendario.
 *
 * Son dos cosas distintas y por eso hay dos salidas: o se entregó y nadie lo
 * marcó —entonces hace falta CUÁNDO, que es lo que va a la hoja— o no se
 * entregó, y entonces vuelve a la bossa sin día para poder replanificarla.
 * No hay una tercera: dejarla como está es lo que ya ha fallado.
 */

/** El valor que entiende un <input type="datetime-local">: sin zona ni segundos. */
function valorLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

export default function Endarrerides({
  stops,
  onEntregada,
  onTornarABossa,
  onTancar,
}: {
  /** Comandas pendientes con fecha anterior a hoy. */
  stops: Stop[];
  /** Se entregó: `quan` es el momento real, en ISO. */
  onEntregada: (orderId: string, quan: string) => void;
  /** No se entregó: se le quita el día y vuelve a la bossa. */
  onTornarABossa: (orderId: string) => void;
  onTancar: () => void;
}) {
  /** La comanda que se está cerrando, y a qué hora. */
  const [editant, setEditant] = useState<string | null>(null);
  const [quan, setQuan] = useState("");

  const ara = valorLocal(new Date());

  const obrirHora = (stop: Stop) => {
    setEditant(stop.id);
    // El día que tenía asignado, a media mañana. Es el valor que casi siempre
    // hay que corregir poco, y deja el campo listo para confirmar.
    setQuan(stop.date ? `${stop.date}T10:00` : ara);
  };

  const confirmar = (orderId: string) => {
    const data = new Date(quan);
    // Una fecha imposible o una entrega en el futuro no se guardan: lo que se
    // registra es cuándo pasó, y el futuro todavía no ha pasado. Se compara
    // contra el mismo `ara` que limita el campo, que ya es texto local y
    // ordena bien tal cual.
    if (!quan || quan > ara || Number.isNaN(data.getTime())) return;
    setEditant(null);
    onEntregada(orderId, data.toISOString());
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="endarrerides-titol"
      className="fixed inset-0 z-[110] flex animate-fade-in items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
    >
      <div className="soft-card flex max-h-[85svh] w-full max-w-md flex-col sm:max-w-lg">
        <div className="flex items-start gap-3 p-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
            <CalendarX2 className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="endarrerides-titol" className="text-lg font-semibold">
              {stops.length === 1
                ? "Una comanda sense tancar"
                : `${stops.length} comandes sense tancar`}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {stops.length === 1
                ? "Estava assignada a un dia que ja ha passat i no s'ha marcat com entregada."
                : "Estaven assignades a dies que ja han passat i no s'han marcat com entregades."}
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
          {stops.map((stop) => (
            <div key={stop.id} className="border-b border-border px-5 py-4 last:border-b-0">
              <p className="truncate font-medium">{stop.customer || stop.codi}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {stop.codi}
                {stop.date && (
                  <>
                    {" · "}
                    <span className="first-letter:uppercase">
                      {formatLongDate(stop.date)}
                    </span>
                  </>
                )}
              </p>

              {editant === stop.id ? (
                <div className="mt-3">
                  <label
                    htmlFor={`quan-${stop.id}`}
                    className="block text-sm font-medium"
                  >
                    Quan es va entregar?
                  </label>
                  <input
                    id={`quan-${stop.id}`}
                    type="datetime-local"
                    value={quan}
                    max={ara}
                    autoFocus
                    onChange={(e) => setQuan(e.target.value)}
                    className="mt-1.5 w-full rounded-xl bg-muted px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  />
                  <p className="mt-1 text-xs text-tertiary-foreground">
                    Aquesta data i aquesta hora són les que quedaran al full.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => confirmar(stop.id)}
                    >
                      Confirmar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditant(null)}
                    >
                      Cancel·lar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" className="flex-1" onClick={() => obrirHora(stop)}>
                    Sí, es va entregar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => onTornarABossa(stop.id)}
                  >
                    <Inbox aria-hidden />
                    Tornar a la bossa
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="border-t border-border p-3">
          <Button variant="ghost" size="sm" className="w-full" onClick={onTancar}>
            Ara no
          </Button>
        </div>
      </div>
    </div>
  );
}
