"use client";

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
 * Los colores salen de los tokens del tema, así que sigue encajando si la
 * paleta cambia. La única excepción es el camión, que es una ilustración con
 * sus propios colores.
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
        <Carretera />
        <div className="truck-run absolute">
          <div className="truck-bump">
            <Camion />
          </div>
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

/** Franja en diagonal que insinúa una carretera. */
function Carretera() {
  return (
    <svg
      viewBox="0 0 320 240"
      className="absolute inset-0 h-full w-full text-muted"
      fill="none"
      aria-hidden
    >
      <path
        d="M-30 210 L350 40"
        stroke="currentColor"
        strokeWidth="26"
        strokeLinecap="round"
      />
      <path
        d="M-30 210 L350 40"
        stroke="var(--card)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="16 18"
      />
    </svg>
  );
}

/** Camión de reparto visto de lado. */
function Camion() {
  return (
    <svg width="96" height="60" viewBox="0 0 96 60" fill="none" aria-hidden>
      {/* Caja */}
      <rect x="2" y="12" width="52" height="30" rx="5" fill="#f2701d" />
      {/* Cabina */}
      <path
        d="M54 22h18.5c1.5 0 2.9.7 3.8 1.9l7.4 9.6c.6.8.9 1.7.9 2.7V42H54V22Z"
        fill="#2b2b31"
      />
      {/* Ventanilla */}
      <path d="M58 26h13l6 8H58v-8Z" fill="#cfe6f5" />
      {/* Parachoques */}
      <rect x="2" y="42" width="83" height="4" rx="2" fill="#2b2b31" opacity="0.85" />
      {/* Ruedas */}
      <circle cx="21" cy="48" r="8" fill="#2b2b31" />
      <circle cx="21" cy="48" r="3.2" fill="#d7d7dc" />
      <circle cx="70" cy="48" r="8" fill="#2b2b31" />
      <circle cx="70" cy="48" r="3.2" fill="#d7d7dc" />
      {/* Líneas de velocidad */}
      <g stroke="#f2701d" strokeWidth="3" strokeLinecap="round" opacity="0.5">
        <path d="M-8 20h10" />
        <path d="M-14 30h14" />
        <path d="M-6 39h8" />
      </g>
    </svg>
  );
}
