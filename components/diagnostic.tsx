"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, RefreshCw, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * El estado de la configuración, dentro de la propia app.
 *
 * Existe porque `npm run check` solo mira el ordenador de quien lo ejecuta,
 * y esto se usa desplegado. Un fallo de configuración en producción —una
 * variable que no se copió, un documento compartido con la cuenta
 * equivocada— se veía como un error suelto en la pantalla que tocaras, sin
 * forma de saber qué mirar desde el móvil.
 *
 * Lo que sale de aquí no es ningún secreto: ni claves, ni PINs, ni los IDs
 * enteros de los documentos — solo su cola, que es lo que se compara de un
 * vistazo con la URL que tienes abierta.
 */

type Estado = "ok" | "aviso" | "error";

interface Comprobacion {
  id: string;
  titulo: string;
  estado: Estado;
  detalle: string;
  arreglo?: string;
}

const ICONO: Record<Estado, { Icona: typeof CheckCircle2; color: string }> = {
  ok: { Icona: CheckCircle2, color: "var(--success)" },
  aviso: { Icona: TriangleAlert, color: "var(--warning)" },
  error: { Icona: CircleAlert, color: "var(--destructive)" },
};

export default function Diagnostic({ onTancar }: { onTancar: () => void }) {
  const [comprobaciones, setComprobaciones] = useState<Comprobacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tanda, setTanda] = useState(0);

  useEffect(() => {
    let cancelat = false;
    void (async () => {
      try {
        const resposta = await fetch("/api/diagnostic");
        const cos = await resposta.json().catch(() => null);
        if (!resposta.ok) throw new Error(cos?.error ?? `El servidor respondió ${resposta.status}`);
        if (!cancelat) setComprobaciones(cos.comprobaciones as Comprobacion[]);
      } catch (e) {
        if (!cancelat) setError(e instanceof Error ? e.message : "Error desconegut");
      }
    })();
    return () => {
      cancelat = true;
    };
  }, [tanda]);

  const problemas = (comprobaciones ?? []).filter((c) => c.estado !== "ok").length;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background lg:left-64">
      <div className="mx-auto max-w-2xl space-y-6 px-4 pb-16 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight">Diagnòstic</h2>
            <p className="text-sm text-muted-foreground">
              Com està configurat aquest servidor, ara mateix.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                // El estado se limpia aquí y no dentro del efecto: hacerlo
                // allí encadena un render de más en cada montaje.
                setComprobaciones(null);
                setError(null);
                setTanda((n) => n + 1);
              }}
              aria-label="Tornar a comprovar"
            >
              <RefreshCw className={cn(comprobaciones === null && !error && "animate-spin")} />
            </Button>
            <Button variant="ghost" size="touch" onClick={onTancar} aria-label="Tancar">
              <X />
            </Button>
          </div>
        </div>

        {error && (
          <p className="rounded-xl bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {comprobaciones === null && !error && (
          <p className="py-12 text-center text-sm text-muted-foreground">Comprovant…</p>
        )}

        {comprobaciones && comprobaciones.length > 0 && (
          <>
            <p
              className={cn(
                "rounded-xl px-4 py-2.5 text-sm",
                problemas === 0
                  ? "bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[color:var(--success)]"
                  : "bg-warning-surface text-warning-foreground",
              )}
            >
              {problemas === 0
                ? "Tot correcte."
                : `${problemas} ${problemas === 1 ? "cosa" : "coses"} per revisar.`}
            </p>

            <ul className="soft-card divide-y divide-border">
              {comprobaciones.map((c) => {
                const { Icona, color } = ICONO[c.estado];
                return (
                  <li key={c.id} className="flex gap-3 px-4 py-3">
                    <Icona className="mt-0.5 size-5 shrink-0" style={{ color }} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{c.titulo}</p>
                      <p className="mt-0.5 break-words text-sm text-muted-foreground">
                        {c.detalle}
                      </p>
                      {c.arreglo && (
                        <p className="mt-1.5 rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed">
                          {c.arreglo}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <p className="text-xs leading-relaxed text-tertiary-foreground">
          D&apos;aquí no surt cap secret: ni claus, ni PINs, ni els identificadors
          sencers dels documents — només el seu final, per poder comparar-lo amb
          l&apos;adreça del document que tinguis obert.
        </p>
      </div>
    </div>
  );
}
