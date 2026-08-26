"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  LogOut,
  Moon,
  Palette,
  Smartphone,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import AjustosFacturacio from "@/components/ajustos-facturacio";
import { setThemePreference, type ThemePreference } from "@/lib/sync";
import type { DatosFacturacion } from "@/lib/factura";

/**
 * Ajustes.
 *
 * Una página con apartados en vez de un panel: cada fila abre su propia
 * pantalla y se vuelve con la flecha, que es como funcionan los ajustes de
 * cualquier app del móvil. Así caben cosas nuevas sin que el panel crezca
 * hasta no poder leerse.
 */

type Apartado = "aparenca" | "facturacio" | "compte";

export default function Ajustos({
  driverName,
  theme,
  datosFactura,
  onDatosFactura,
  onTancar,
}: {
  driverName: string;
  theme: ThemePreference;
  datosFactura: DatosFacturacion;
  onDatosFactura: (datos: DatosFacturacion) => void;
  onTancar: () => void;
}) {
  const [apartado, setApartado] = useState<Apartado | null>(null);
  const router = useRouter();
  const [sortint, setSortint] = useState(false);

  // La de facturación ya es una pantalla entera por su cuenta.
  if (apartado === "facturacio") {
    return (
      <AjustosFacturacio
        datos={datosFactura}
        onDesar={onDatosFactura}
        onTancar={() => setApartado(null)}
      />
    );
  }

  const tancarSessio = async () => {
    setSortint(true);
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background lg:left-64">
      <div className="mx-auto max-w-lg px-4 pb-10 pt-6">
        <div className="mb-6 flex items-center gap-2">
          {apartado ? (
            <button
              onClick={() => setApartado(null)}
              className="pressable -ml-2 rounded-full p-2 text-primary"
              aria-label="Enrere"
            >
              <ChevronLeft className="size-6" />
            </button>
          ) : null}
          <h2 className="flex-1 text-2xl font-semibold tracking-tight">
            {apartado === "aparenca"
              ? "Aparença"
              : apartado === "compte"
                ? "Compte"
                : "Ajustos"}
          </h2>
          {!apartado && (
            <Button variant="ghost" size="touch" onClick={onTancar} aria-label="Tancar">
              <X />
            </Button>
          )}
        </div>

        {apartado === null && (
          <div className="space-y-6">
            <Grup titol="Preferències">
              <Fila
                icona={Palette}
                titol="Aparença"
                detall={
                  theme === "light" ? "Clar" : theme === "dark" ? "Fosc" : "Sistema"
                }
                onClick={() => setApartado("aparenca")}
              />
            </Grup>

            <Grup titol="Facturació">
              <Fila
                icona={FileText}
                titol="Dades d'emissor i client"
                detall={datosFactura.emisor.nombre}
                onClick={() => setApartado("facturacio")}
              />
            </Grup>

            <Grup titol="Compte">
              <Fila
                icona={UserRound}
                titol="Transportista"
                detall={driverName}
                onClick={() => setApartado("compte")}
              />
            </Grup>
          </div>
        )}

        {apartado === "aparenca" && (
          <div className="overflow-hidden rounded-xl bg-card">
            {(
              [
                { value: "light", label: "Clar", icon: Sun },
                { value: "dark", label: "Fosc", icon: Moon },
                { value: "system", label: "Sistema", icon: Smartphone },
              ] as { value: ThemePreference; label: string; icon: typeof Sun }[]
            ).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setThemePreference(value)}
                className="hairline flex w-full items-center gap-3 px-4 py-3 text-left text-base first:border-t-0"
              >
                <Icon className="size-5 shrink-0 text-muted-foreground" />
                <span className="flex-1">{label}</span>
                {theme === value && (
                  <Check className="size-5 shrink-0 text-primary" strokeWidth={2.5} />
                )}
              </button>
            ))}
          </div>
        )}

        {apartado === "compte" && (
          <div className="space-y-6">
            <div className="soft-card p-4">
              <p className="text-xs font-medium text-muted-foreground">Transportista</p>
              <p className="text-base font-medium">{driverName}</p>
            </div>

            <div className="overflow-hidden rounded-xl bg-card">
              <button
                onClick={() => void tancarSessio()}
                disabled={sortint}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-base text-status-incidencia disabled:opacity-50"
              >
                <LogOut className="size-5 shrink-0" />
                <span className="flex-1">
                  {sortint ? "Tancant…" : "Tancar sessió"}
                </span>
              </button>
            </div>
            <p className="px-1 text-xs text-muted-foreground">
              Per tornar a entrar necessitaràs el codi i el PIN. Les entregues
              que encara no s&apos;hagin enviat es queden al mòbil.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Grup({ titol, children }: { titol: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {titol}
      </h3>
      <div className="overflow-hidden rounded-xl bg-card">{children}</div>
    </section>
  );
}

function Fila({
  icona: Icona,
  titol,
  detall,
  onClick,
}: {
  icona: typeof Sun;
  titol: string;
  detall?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="hairline flex w-full items-center gap-3 px-4 py-3 text-left first:border-t-0"
    >
      <Icona className="size-5 shrink-0 text-muted-foreground" />
      {/* `min-w-0` para que el truncado funcione dentro del flex: sin él, el
          texto largo ensancha la celda en vez de recortarse. */}
      <span className="min-w-0 flex-1 truncate text-base">{titol}</span>
      {detall && (
        <span className="min-w-0 max-w-[42%] shrink truncate text-sm text-muted-foreground">
          {detall}
        </span>
      )}
      <ChevronRight className="size-5 shrink-0 text-tertiary-foreground" />
    </button>
  );
}
