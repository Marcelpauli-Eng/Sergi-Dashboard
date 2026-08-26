"use client";

import { useEffect, useState } from "react";
import { Undo2 } from "lucide-react";

/**
 * El aviso de "Desfer".
 *
 * Aparece medio minuto después de marcar una entrega o de mover una comanda
 * de día, y desaparece solo. Antes de esto, un dedazo en el botón de
 * Entregat solo se arreglaba editando el Google Sheet a mano desde un
 * ordenador — y el transportista está en la calle.
 *
 * Deshacer no borra el registro de la cola: manda uno nuevo que deja la fila
 * como estaba. Es lo mismo que hace el resto de la app y por eso funciona
 * igual sin cobertura: los dos se suben en cuanto haya red, en orden.
 */

export interface AccioDesfer {
  /** Qué se ha hecho, para poder decirlo: "Farmàcia Sant Pau · entregada". */
  etiqueta: string;
  fer: () => void;
  /** Marca de tiempo, para que un aviso nuevo reinicie la cuenta atrás. */
  quan: number;
}

/** Cuánto se puede deshacer. Medio minuto es lo que tarda uno en darse cuenta. */
export const MARGE_DESFER_MS = 30_000;

export default function Desfer({
  accio,
  onTancar,
}: {
  accio: AccioDesfer | null;
  onTancar: () => void;
}) {
  const [queden, setQueden] = useState(0);

  useEffect(() => {
    if (!accio) return;
    const tic = () => {
      const restant = accio.quan + MARGE_DESFER_MS - Date.now();
      if (restant <= 0) {
        onTancar();
        return;
      }
      setQueden(Math.ceil(restant / 1000));
    };
    tic();
    const id = setInterval(tic, 250);
    return () => clearInterval(id);
  }, [accio, onTancar]);

  if (!accio) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 z-[90] flex justify-center px-4
                 bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-6 lg:left-64"
    >
      <div className="material flex animate-rise-in items-center gap-3 rounded-full border border-border py-2 pl-4 pr-2 shadow-lg">
        <p className="truncate text-sm">{accio.etiqueta}</p>
        <button
          type="button"
          onClick={() => {
            accio.fer();
            onTancar();
          }}
          className="pressable flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
        >
          <Undo2 className="size-4" aria-hidden />
          Desfer
          <span className="tabular-nums opacity-70">{queden}</span>
        </button>
      </div>
    </div>
  );
}
