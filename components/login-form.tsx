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
    <main className="flex min-h-svh flex-col justify-center px-4 py-12">
      <div className="mx-auto w-full max-w-sm animate-rise-in">
        <div className="mb-8 px-2">
          <h1 className="text-3xl font-bold">Reparto</h1>
          <p className="mt-1 text-base text-muted-foreground">
            Entra con tu código y tu PIN
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="overflow-hidden rounded-xl bg-card">
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
    </main>
  );
}
