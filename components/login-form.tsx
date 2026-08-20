"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, Lock, User } from "lucide-react";

/**
 * Login de una sola vez.
 *
 * La sesión dura un año a propósito, así que esta pantalla se ve el primer
 * día y prácticamente nunca más. Todo el diseño va orientado a eso: campos
 * grandes, teclado numérico para el PIN y cero fricción.
 *
 * La composición sigue la referencia de diseño: mitad superior cálida con la
 * ilustración y la marca, y una hoja blanca redondeada encima con el
 * formulario.
 */
export default function LoginForm() {
  const router = useRouter();
  const [driverId, setDriverId] = useState("");
  const [pin, setPin] = useState("");
  const [verPin, setVerPin] = useState(false);
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

  const campo =
    "h-14 w-full rounded-full bg-secondary pl-12 pr-12 text-[15px] outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/25";

  return (
    <main className="flex min-h-svh flex-col bg-card">
      {/* ── Mitad cálida: marca e ilustración ──────────────────────────── */}
      <div className="warm-gradient relative min-h-[36svh] shrink-0 overflow-hidden pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2 px-6">
          <CamionLogo />
          <span className="text-2xl font-bold tracking-tight">
            Rep<span className="text-primary">arto</span>
          </span>
        </div>

        {/*
          La ilustración se ancla abajo a la derecha y se sale por el borde,
          como en la referencia. `pointer-events-none` para que nunca robe un
          toque al formulario.
        */}
        {/*
          La ilustración conserva su fondo crema, el mismo con el que arranca
          el degradado de arriba. Para que no se vea el rectángulo, se
          difuminan sus bordes con una máscara: es mucho más fiable que
          recortar la figura, porque el render tiene brillos y sombras suaves
          del propio color del fondo.
        */}
        <Image
          src="/repartidor.webp"
          alt=""
          width={820}
          height={1010}
          priority
          aria-hidden
          className="pointer-events-none absolute -right-8 bottom-0 h-[82%] w-auto select-none object-contain"
          style={{
            // Dos máscaras que se cruzan: la horizontal disuelve el canto
            // izquierdo y la radial redondea el resto. Van en `style` y no en
            // clases de Tailwind porque el valor lleva comas y paréntesis
            // anidados, que allí hay que escapar y se vuelve ilegible.
            maskImage:
              "linear-gradient(to right, transparent 0%, #000 42%), radial-gradient(125% 115% at 72% 62%, #000 52%, transparent 90%)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent 0%, #000 42%), radial-gradient(125% 115% at 72% 62%, #000 52%, transparent 90%)",
            maskComposite: "intersect",
            WebkitMaskComposite: "source-in",
          }}
        />
      </div>

      {/* ── Hoja blanca con el formulario ──────────────────────────────── */}
      <div className="relative z-10 -mt-8 flex-1 rounded-t-[2rem] bg-card px-6 pb-10 pt-8">
        <div className="mx-auto w-full max-w-sm animate-rise-in">
          <h1 className="text-[26px] font-bold tracking-tight">Hola de nuevo</h1>

          <form onSubmit={handleSubmit} className="mt-6 space-y-3">
            <div className="relative">
              <User
                className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                id="driverId"
                name="driverId"
                type="text"
                inputMode="text"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                required
                placeholder="Código de transportista"
                aria-label="Código de transportista"
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                className={campo}
              />
            </div>

            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                id="pin"
                name="pin"
                type={verPin ? "text" : "password"}
                // Teclado numérico directamente, sin tener que cambiarlo a mano.
                inputMode="numeric"
                autoComplete="current-password"
                required
                placeholder="PIN"
                aria-label="PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className={campo}
              />
              <button
                type="button"
                onClick={() => setVerPin((v) => !v)}
                className="absolute right-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                aria-label={verPin ? "Ocultar el PIN" : "Mostrar el PIN"}
              >
                {verPin ? (
                  <Eye className="size-[18px]" aria-hidden />
                ) : (
                  <EyeOff className="size-[18px]" aria-hidden />
                )}
              </button>
            </div>

            {/*
              La sesión dura un año siempre, así que esto es informativo: se
              muestra marcado y sin interacción en vez de fingir una opción
              que no cambia nada.
            */}
            <div className="flex items-center gap-2.5 pt-1">
              <span
                className="flex size-[22px] items-center justify-center rounded-full bg-primary text-primary-foreground"
                aria-hidden
              >
                <Check className="size-3.5" strokeWidth={3} />
              </span>
              <span className="text-[15px]">No tendrás que volver a entrar</span>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-2xl bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] px-4 py-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !driverId || !pin}
              className="!mt-6 h-14 w-full rounded-full bg-primary text-[17px] font-semibold text-primary-foreground transition-opacity disabled:opacity-45"
            >
              {busy ? "Entrando…" : "Entrar"}
            </button>
          </form>

          <p className="mt-7 text-center text-xs leading-relaxed text-muted-foreground">
            Solo necesitas internet para entrar. Después, la app funciona sin
            cobertura.
          </p>
        </div>
      </div>
    </main>
  );
}

/** Marca: camión con el pin de destino encima. */
function CamionLogo() {
  return (
    <svg width="30" height="26" viewBox="0 0 30 26" fill="none" aria-hidden>
      <rect x="1" y="12" width="15" height="9" rx="2" fill="#2b2b31" />
      <path
        d="M16 15h4.6c.4 0 .8.2 1 .5l2.2 2.8c.2.2.2.4.2.7V21H16v-6Z"
        fill="#2b2b31"
      />
      <circle cx="7" cy="22" r="2.6" fill="#2b2b31" />
      <circle cx="20" cy="22" r="2.6" fill="#2b2b31" />
      <path
        d="M22 1c2.8 0 5 2.2 5 5 0 3.5-5 8-5 8s-5-4.5-5-8c0-2.8 2.2-5 5-5Z"
        fill="#f2701d"
      />
      <circle cx="22" cy="6" r="1.9" fill="#ffffff" />
    </svg>
  );
}
