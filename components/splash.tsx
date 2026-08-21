"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/**
 * Pantalla de carga que se ve al abrir la app.
 *
 * Se retira sola a los `VISIBLE_MS` en vez de esperar a que carguen los
 * datos, a propósito: el dashboard lee de IndexedDB y suele estar listo
 * antes, así que atarla a la carga real la haría parpadear. Lo que se busca
 * aquí es el arranque de una app nativa, no una barra de progreso.
 *
 * Se muestra una vez por carga completa de la página; moverse entre
 * pestañas no la repite, porque el layout no se vuelve a montar.
 *
 * El asfalto y las líneas salen de los tokens del tema, así que siguen
 * encajando si la paleta cambia. La única excepción es la furgoneta, que es
 * una ilustración con sus propios colores.
 *
 * Quien se mueve es la carretera, no la furgoneta: vista desde arriba, es lo
 * que da la sensación de avance.
 */

/** Nombre bajo el camión. Cámbialo aquí y ya está. */
const NOMBRE = "Reparto";
/** Cuántas letras finales van en el color de acción. */
const LETRAS_ACENTUADAS = 5;

const VISIBLE_MS = 1900;
const FADE_MS = 450;

export default function Splash() {
  const [saliendo, setSaliendo] = useState(false);
  const [oculto, setOculto] = useState(false);

  useEffect(() => {
    const fuera = setTimeout(() => setSaliendo(true), VISIBLE_MS);
    const quitar = setTimeout(() => setOculto(true), VISIBLE_MS + FADE_MS);
    return () => {
      clearTimeout(fuera);
      clearTimeout(quitar);
    };
  }, []);

  if (oculto) return null;

  const corte = NOMBRE.length - LETRAS_ACENTUADAS;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-card ${
        saliendo ? "splash-out" : ""
      }`}
      // Decorativa: quien use lector de pantalla no gana nada anunciándola.
      aria-hidden
    >
      <div className="relative flex h-60 w-full max-w-sm items-center justify-center overflow-hidden">
        <div className="carretera">
          <div className="carretera-cinta" />
        </div>
        <div className="truck-bump relative">
          <Image
            src="/camion-top.webp"
            alt=""
            width={299}
            height={600}
            priority
            aria-hidden
            unoptimized
            className="w-[78px] select-none"
          />
        </div>
      </div>

      <h1 className="mt-1 text-4xl font-semibold tracking-tight">
        {NOMBRE.slice(0, corte)}
        <span className="text-primary">{NOMBRE.slice(corte)}</span>
      </h1>

      <p className="mt-3 max-w-[17rem] text-center text-sm leading-relaxed text-muted-foreground">
        Los pedidos del día, en la ruta más corta. Funciona sin cobertura.
      </p>
    </div>
  );
}
