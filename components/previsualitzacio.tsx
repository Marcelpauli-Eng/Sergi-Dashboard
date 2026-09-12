"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

function BotoTancarPrevisualitzacio({ onTancar }: { onTancar: () => void }) {
  return (
    <Button
      variant="secondary"
      size="icon"
      className="absolute -top-12 right-0 rounded-full shadow-lg"
      onClick={onTancar}
      aria-label="Tancar"
    >
      <X />
    </Button>
  );
}

/**
 * La previsualización de una comanda: velo, tarjeta centrada y cruz.
 *
 * Cuatro pantallas la abren —el buscador, la bolsa, el calendario y el
 * historial— y cada una llevaba su propia copia del mismo velo, la misma
 * caja y la misma cruz: cuatro sitios donde arreglar cada cosa.
 *
 * Tocar fuera cierra; tocar dentro no, que si no se cerraría sola al darle
 * a "Entregat".
 */
export default function Previsualitzacio({
  onTancar,
  children,
}: {
  onTancar: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex animate-fade-in items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onTancar}
    >
      <div
        className="relative w-full max-w-md sm:max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <BotoTancarPrevisualitzacio onTancar={onTancar} />
        {children}
      </div>
    </div>
  );
}

