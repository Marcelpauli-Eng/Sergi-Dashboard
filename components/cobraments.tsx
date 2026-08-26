"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleCheck, Clock3, Send } from "lucide-react";
import type { EstatFactura, FacturaEmitida } from "@/lib/types";
import { clientePara, euros, fechaCorta, formatearNumero, type DatosFacturacion } from "@/lib/factura";
import { cn } from "@/lib/utils";

/**
 * Por dónde va el cobro de cada factura.
 *
 * Pantalla aparte de Factures a propósito: allí se emite y se imprime, que
 * es cosa de fin de mes; aquí se contesta "¿esto está cobrado?", que es una
 * pregunta de cualquier martes. Mezclarlas obligaba a leer la lista entera
 * de facturas para encontrar las tres que faltan por cobrar.
 *
 * El estado se guarda en la propia hoja, en la pestaña "Factures": la
 * oficina lo ve sin tener que pedirlo, y no se pierde al cambiar de móvil.
 * Por eso mover una factura de estado necesita cobertura.
 */

const ESTATS: {
  id: EstatFactura;
  etiqueta: string;
  icona: typeof Clock3;
  color: string;
}[] = [
  { id: "emesa", etiqueta: "Emesa", icona: Clock3, color: "var(--muted-foreground)" },
  { id: "enviada", etiqueta: "Enviada", icona: Send, color: "var(--primary)" },
  { id: "cobrada", etiqueta: "Cobrada", icona: CircleCheck, color: "var(--success)" },
];

export default function Cobraments({
  datos,
  online,
}: {
  datos: DatosFacturacion;
  online: boolean;
}) {
  const [facturas, setFacturas] = useState<FacturaEmitida[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Número de la factura que se está guardando ahora mismo. */
  const [desant, setDesant] = useState<number | null>(null);
  const [filtre, setFiltre] = useState<EstatFactura | "totes">("totes");

  useEffect(() => {
    let cancelat = false;
    void (async () => {
      try {
        const resposta = await fetch("/api/facturas");
        const cos = await resposta.json().catch(() => null);
        if (!resposta.ok) throw new Error(cos?.error ?? "No s'han pogut carregar");
        if (!cancelat) setFacturas(cos.facturas as FacturaEmitida[]);
      } catch (e) {
        if (!cancelat) setError(e instanceof Error ? e.message : "Error desconegut");
      }
    })();
    return () => {
      cancelat = true;
    };
  }, []);

  const totals = useMemo(() => {
    const suma = { emesa: 0, enviada: 0, cobrada: 0 };
    for (const f of facturas ?? []) suma[f.estat] += f.total;
    return suma;
  }, [facturas]);

  const pendent = totals.emesa + totals.enviada;

  const visibles = useMemo(
    () => (facturas ?? []).filter((f) => filtre === "totes" || f.estat === filtre),
    [facturas, filtre],
  );

  const canviar = async (factura: FacturaEmitida, estat: EstatFactura) => {
    if (estat === factura.estat) return;
    setDesant(factura.numero);
    setError(null);
    // Se pinta el cambio antes de que el servidor conteste y se deshace si
    // falla: mover tres facturas seguidas con medio segundo de espera cada
    // una se hace muy pesado.
    const anterior = facturas;
    setFacturas((previo) =>
      (previo ?? []).map((f) => (f.numero === factura.numero ? { ...f, estat } : f)),
    );
    try {
      const resposta = await fetch("/api/facturas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero: factura.numero, estat }),
      });
      if (!resposta.ok) {
        const cos = await resposta.json().catch(() => null);
        throw new Error(cos?.error ?? "No s'ha pogut desar");
      }
    } catch (e) {
      setFacturas(anterior);
      setError(e instanceof Error ? e.message : "Error desconegut");
    } finally {
      setDesant(null);
    }
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Xifra etiqueta="Pendent de cobrar" valor={pendent} tono="var(--primary)" destacada />
        <Xifra etiqueta="Emeses" valor={totals.emesa} tono="var(--muted-foreground)" />
        <Xifra etiqueta="Enviades" valor={totals.enviada} tono="var(--primary)" />
        <Xifra etiqueta="Cobrades" valor={totals.cobrada} tono="var(--success)" />
      </div>

      {error && (
        <p className="rounded-xl bg-warning-surface px-4 py-2.5 text-sm text-warning-foreground">
          {error}
        </p>
      )}

      {!online && (
        <p className="rounded-xl bg-warning-surface px-4 py-2.5 text-sm text-warning-foreground">
          Sense cobertura només es pot mirar: l&apos;estat es desa al full.
        </p>
      )}

      <div className="flex items-center gap-1 rounded-full bg-muted p-0.5 lg:w-fit">
        {(["totes", "emesa", "enviada", "cobrada"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltre(f)}
            aria-pressed={filtre === f}
            className={cn(
              "pressable flex-1 rounded-full px-4 py-1.5 text-sm font-medium capitalize lg:flex-none",
              filtre === f ? "bg-card text-primary shadow-sm" : "text-muted-foreground",
            )}
          >
            {f === "totes" ? "Totes" : ESTATS.find((e) => e.id === f)?.etiqueta}
          </button>
        ))}
      </div>

      {facturas === null && !error && (
        <p className="py-12 text-center text-sm text-muted-foreground">Carregant…</p>
      )}

      {facturas && visibles.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {facturas.length === 0
            ? "Encara no has emès cap factura des de l'app."
            : "Cap factura en aquest estat."}
        </p>
      )}

      {visibles.length > 0 && (
        <ul className="soft-card divide-y divide-border">
          {visibles.map((factura) => (
            <li
              key={factura.numero}
              className={cn(
                "flex flex-wrap items-center gap-3 px-4 py-3",
                desant === factura.numero && "opacity-60",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold tabular-nums">
                  {formatearNumero(factura.numero)}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {fechaCorta(factura.fecha)} · {factura.periodo} ·{" "}
                  {clientePara(datos, factura.client).nombre}
                </p>
              </div>
              <span className="tabular-nums text-sm font-medium">
                {euros(factura.total)} €
              </span>
              <div className="flex items-center gap-1 rounded-full bg-muted p-0.5">
                {ESTATS.map(({ id, etiqueta, icona: Icona, color }) => {
                  const activa = factura.estat === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={!online || desant === factura.numero}
                      onClick={() => void canviar(factura, id)}
                      aria-pressed={activa}
                      title={etiqueta}
                      className={cn(
                        "pressable flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-40",
                        activa ? "bg-card shadow-sm" : "text-muted-foreground",
                      )}
                      style={activa ? { color } : undefined}
                    >
                      <Icona className="size-3.5" aria-hidden />
                      <span className="hidden sm:inline">{etiqueta}</span>
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Xifra({
  etiqueta,
  valor,
  tono,
  destacada,
}: {
  etiqueta: string;
  valor: number;
  tono: string;
  destacada?: boolean;
}) {
  return (
    <div
      className={cn(
        "soft-card p-4",
        destacada && "bg-[color-mix(in_srgb,var(--primary)_8%,var(--card))]",
      )}
    >
      <p className="truncate text-xs text-muted-foreground">{etiqueta}</p>
      <p
        className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight"
        style={{ color: tono }}
      >
        {euros(valor)} €
      </p>
    </div>
  );
}
