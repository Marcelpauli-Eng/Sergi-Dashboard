"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Login de una sola vez.
 *
 * La sesión dura un año a propósito, así que esta pantalla se ve el primer
 * día y prácticamente nunca más. Todo el diseño va orientado a eso: campos
 * grandes, teclado numérico para el PIN y cero fricción.
 */
export default function LoginForm() {
  const router = useRouter();
  const [driverId, setDriverId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId, pin }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "No se ha podido entrar");
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setError("Sin conexión. Necesitas internet solo para entrar la primera vez.");
    } finally {
      setBusy(false);
    }
  }

  // Fila de formulario agrupado de iOS: etiqueta a la izquierda, campo a la
  // derecha, dentro de un único bloque blanco con separadores de medio píxel.
  const field =
    "min-w-0 flex-1 bg-transparent text-right text-base outline-none placeholder:text-tertiary-foreground";

  return (
    <main className="flex min-h-svh flex-col">
      {/*
        Mitad superior cálida con la ilustración y, encima, una hoja blanca
        redondeada con el formulario.
      */}
      <div className="warm-gradient flex min-h-[32svh] shrink-0 items-center justify-center px-6 pb-16 pt-10">
        <RepartidorIlustracion />
      </div>

      <div className="-mt-10 flex-1 rounded-t-[2rem] bg-card px-4 pb-10 pt-9 shadow-[0_-8px_30px_-18px_rgba(16,16,20,0.25)]">
      <div className="mx-auto w-full max-w-sm animate-rise-in">
        <div className="mb-8 px-2">
          <h1 className="text-3xl font-bold">Hola de nuevo</h1>
          <p className="mt-1 text-base text-muted-foreground">
            Entra con tu código y tu PIN
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="overflow-hidden soft-card">
            <div className="flex items-center gap-4 px-4 py-3">
              <label htmlFor="driverId" className="shrink-0 text-base">
                Código
              </label>
              <input
                id="driverId"
                name="driverId"
                type="text"
                inputMode="text"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                placeholder="Obligatorio"
                required
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                className={field}
              />
            </div>

            <div className="hairline flex items-center gap-4 px-4 py-3">
              <label htmlFor="pin" className="shrink-0 text-base">
                PIN
              </label>
              <input
                id="pin"
                name="pin"
                type="password"
                // Teclado numérico directamente, sin tener que cambiarlo a mano.
                inputMode="numeric"
                autoComplete="current-password"
                placeholder="Obligatorio"
                required
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className={`${field} tracking-[0.3em]`}
              />
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-xl bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] px-4 py-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            size="touch"
            className="mt-5 w-full"
            disabled={busy || !driverId || !pin}
          >
            {busy ? "Entrando…" : "Entrar"}
          </Button>
        </form>

        <p className="mt-6 px-2 text-xs text-muted-foreground">
          Solo necesitas internet para entrar. Después, la app funciona sin
          cobertura.
        </p>
      </div>
      </div>
    </main>
  );
}

/** Repartidor con cajas. Decorativa: no aporta información. */
function RepartidorIlustracion() {
  return (
    <svg width="188" height="150" viewBox="0 0 188 150" fill="none" aria-hidden>
      {/* Cajas apiladas */}
      <rect x="96" y="66" width="60" height="46" rx="4" fill="#e8a86b" />
      <path d="M96 66h60v9H96z" fill="#d1904f" />
      <path d="M122 66h8v46h-8z" fill="#c98243" opacity="0.55" />
      <rect x="108" y="40" width="44" height="30" rx="4" fill="#f0bd82" />
      <path d="M126 40h8v30h-8z" fill="#d99a56" opacity="0.5" />
      {/* Cuerpo */}
      <path d="M40 70c0-13 9-22 21-22s21 9 21 22v34H40V70Z" fill="#f2701d" />
      {/* Brazo hacia las cajas */}
      <path
        d="M78 74c8 2 16 4 22 8"
        stroke="#f2701d"
        strokeWidth="11"
        strokeLinecap="round"
      />
      {/* Cabeza y gorra */}
      <circle cx="61" cy="36" r="14" fill="#f6c9a0" />
      <path d="M46 33c0-9 7-15 15-15s15 6 15 15H46Z" fill="#e2542c" />
      <path d="M74 33h12v4H74z" fill="#e2542c" />
      {/* Piernas */}
      <rect x="45" y="104" width="13" height="30" rx="5" fill="#2f3340" />
      <rect x="64" y="104" width="13" height="30" rx="5" fill="#3c4152" />
      {/* Suelo */}
      <ellipse cx="94" cy="138" rx="72" ry="7" fill="#e7c9ad" opacity="0.45" />
    </svg>
  );
}
