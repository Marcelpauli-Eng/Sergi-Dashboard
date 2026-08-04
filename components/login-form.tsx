"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

  return (
    <main className="flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-ink">Reparto</h1>
          <p className="mt-2 text-muted">Entra con tu código y tu PIN</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="driverId"
              className="mb-2 block text-sm font-semibold text-ink"
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
              className="w-full rounded-xl border border-line bg-surface px-4 py-4 text-lg text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>

          <div>
            <label htmlFor="pin" className="mb-2 block text-sm font-semibold text-ink">
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
              className="w-full rounded-xl border border-line bg-surface px-4 py-4 text-lg tracking-widest text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-danger"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !driverId || !pin}
            className="w-full rounded-xl bg-brand px-4 py-4 text-lg font-semibold text-white transition active:bg-brand-strong disabled:opacity-40"
          >
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p className="mt-8 text-center text-sm text-muted">
          Solo necesitas internet para entrar. Después, la app funciona sin
          cobertura.
        </p>
      </div>
    </main>
  );
}
