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

  const field =
    "w-full rounded-md border border-input bg-card px-3.5 py-3 text-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/15";

  return (
    <main className="flex min-h-svh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm animate-rise-in">
        <div className="mb-10">
          <h1 className="text-3xl tracking-tight">Reparto</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Entra con tu código y tu PIN
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="driverId"
              className="mb-1.5 block text-sm font-medium"
            >
              Código de transportista
            </label>
            <input
              id="driverId"
              name="driverId"
              type="text"
              inputMode="text"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              required
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className={field}
            />
          </div>

          <div>
            <label htmlFor="pin" className="mb-1.5 block text-sm font-medium">
              PIN
            </label>
            <input
              id="pin"
              name="pin"
              type="password"
              // Teclado numérico directamente, sin tener que cambiarlo a mano.
              inputMode="numeric"
              autoComplete="current-password"
              required
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className={`${field} tracking-[0.3em]`}
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            size="touch"
            className="w-full"
            disabled={busy || !driverId || !pin}
          >
            {busy ? "Entrando…" : "Entrar"}
          </Button>
        </form>

        <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
          Solo necesitas internet para entrar. Después, la app funciona sin
          cobertura.
        </p>
      </div>
    </main>
  );
}
