"use client";

import { decodePolyline, proyectar, type Punto } from "@/lib/polyline";
import type { Stop } from "@/lib/types";

/**
 * Traza del recorrido del día.
 *
 * No es un mapa: es el dibujo de la ruta, sin teselas. Esa diferencia es
 * deliberada y es lo que permite que siga viéndose sin cobertura — los
 * términos de Google prohíben cachear las teselas de un mapa, así que uno
 * embebido se quedaría en blanco justo cuando más falta hace. La navegación
 * de verdad la sigue haciendo la app del móvil, con el botón de al lado.
 *
 * Si Google devolvió la geometría del recorrido, la traza sigue las calles.
 * Si no —porque se cayó al orden por prioridad—, se unen las paradas con
 * rectas: da la forma del recorrido igual, y se avisa de que es aproximada.
 */

const ANCHO = 320;
const ALTO = 150;

export default function RouteTrace({
  encodedPolyline,
  start,
  stops,
}: {
  encodedPolyline: string | null;
  start: Punto | null;
  stops: Stop[];
}) {
  const paradas = stops.filter(
    (s): s is Stop & { lat: number; lng: number } => s.lat !== null && s.lng !== null,
  );

  // Sin al menos dos puntos no hay recorrido que enseñar.
  if (paradas.length === 0) return null;

  const recorrido = encodedPolyline ? decodePolyline(encodedPolyline) : [];
  const sigueCalles = recorrido.length > 1;

  const puntosParada: Punto[] = paradas.map((s) => ({ lat: s.lat, lng: s.lng }));
  const linea: Punto[] = sigueCalles
    ? recorrido
    : [...(start ? [start] : []), ...puntosParada];

  if (linea.length < 2) return null;

  // Se proyecta todo junto para que la línea y los marcadores compartan
  // escala; proyectarlos por separado los descuadraría entre sí.
  const todos: Punto[] = [...linea, ...(start ? [start] : []), ...puntosParada];
  const planos = proyectar(todos, ANCHO, ALTO);

  const lineaXY = planos.slice(0, linea.length);
  const resto = planos.slice(linea.length);
  const startXY = start ? resto[0] : null;
  const paradasXY = start ? resto.slice(1) : resto;

  const d = lineaXY.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  return (
    <div className="relative overflow-hidden rounded-[var(--radius)] bg-muted">
      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        className="h-[150px] w-full"
        role="img"
        aria-label={`Recorrido con ${paradas.length} parada${paradas.length === 1 ? "" : "s"}`}
      >
        {/* Sombra del trazo, para que se despegue del fondo. */}
        <path
          d={d}
          fill="none"
          stroke="var(--foreground)"
          strokeOpacity="0.08"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={d}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          // A ojo se lee como un recorrido continuo aunque sea aproximado.
          strokeDasharray={sigueCalles ? undefined : "1 9"}
        />

        {paradasXY.map((p, i) => (
          <g key={paradas[i].id}>
            <circle cx={p.x} cy={p.y} r="7" fill="var(--card)" />
            <circle cx={p.x} cy={p.y} r="4.5" fill="var(--primary)" />
          </g>
        ))}

        {startXY && (
          <g>
            <circle cx={startXY.x} cy={startXY.y} r="8" fill="var(--card)" />
            <circle cx={startXY.x} cy={startXY.y} r="5.5" fill="var(--foreground)" />
          </g>
        )}
      </svg>

      {!sigueCalles && (
        <p className="absolute bottom-2 left-3 text-[10px] text-muted-foreground">
          Recorrido aproximado
        </p>
      )}
    </div>
  );
}
