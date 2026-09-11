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
      {/* En el móvil la que importa ocupa la fila entera: es la respuesta a
          la pregunta con la que se entra aquí, y en media columna le cabía
          el número pero no la etiqueta. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Xifra
          etiqueta="Pendent de cobrar"
          valor={pendent}
          tono="var(--primary)"
          destacada
          className="col-span-2 lg:col-span-1"
        />
        <Xifra etiqueta="Emeses" valor={totals.emesa} tono="var(--muted-foreground)" />
        <Xifra etiqueta="Enviades" valor={totals.enviada} tono="var(--primary)" />
        {/* También a lo ancho: deja las dos que están a medias juntas en una
            fila y lo cobrado cerrando, en vez de un hueco suelto al final. */}
        <Xifra
          etiqueta="Cobrades"
          valor={totals.cobrada}
          tono="var(--success)"
          className="col-span-2 lg:col-span-1"
        />
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

      <div className="flex items-center gap-1 rounded-full bg-muted p-1 lg:w-fit">
        {(["totes", "emesa", "enviada", "cobrada"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltre(f)}
            aria-pressed={filtre === f}
            className={cn(
              "pressable min-h-11 flex-1 rounded-full px-3 text-sm font-medium capitalize lg:min-h-9 lg:flex-none lg:px-4",
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
        /*
          En el móvil cada factura es una ficha de tres alturas —número e
          importe, de quién y de cuándo, y el estado— en vez de una fila con
          todo apretado de lado. Antes los tres botones de estado medían
          34x22 px y se quedaban sin etiqueta por falta de sitio: había que
          adivinar los iconos y apuntar con el dedo a un cuarto de la yema.

          De `lg` en adelante vuelve a ser una fila, que ahí sí cabe y leer
          veinte facturas seguidas es más rápido.
        */
        <ul className="soft-card divide-y divide-border">
          {visibles.map((factura) => (
            <li
              key={factura.numero}
              className={cn(
                "px-4 py-4 lg:flex lg:items-center lg:gap-4 lg:py-3",
                desant === factura.numero && "opacity-60",
              )}
            >
              <div className="flex items-baseline justify-between gap-3 lg:flex-1 lg:items-center">
                <div className="min-w-0">
                  <p className="text-base font-semibold tabular-nums lg:text-sm">
                    {formatearNumero(factura.numero)}
                  </p>
                  {/* Sin `truncate`: el nombre del cliente se cortaba por la
                      mitad y es lo que dice de qué factura se trata. */}
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground lg:truncate">
                    {fechaCorta(factura.fecha)} · {factura.periodo}
                    <span className="lg:inline"> · </span>
                    {clientePara(datos, factura.client).nombre}
                  </p>
                </div>
                <span className="shrink-0 text-base font-semibold tabular-nums lg:text-sm lg:font-medium">
                  {euros(factura.total)} €
                </span>
              </div>

              <div className="mt-3 flex items-center gap-1 rounded-full bg-muted p-1 lg:mt-0 lg:shrink-0 lg:p-0.5">
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
                        "pressable flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-full px-2 text-xs font-medium disabled:opacity-40 lg:min-h-0 lg:flex-none lg:px-2.5 lg:py-1",
                        activa ? "bg-card shadow-sm" : "text-muted-foreground",
                      )}
                      style={activa ? { color } : undefined}
                    >
                      <Icona className="size-3.5 shrink-0" aria-hidden />
                      {etiqueta}
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
  className,
}: {
  etiqueta: string;
  valor: number;
  tono: string;
  destacada?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "soft-card p-4",
        destacada && "bg-[color-mix(in_srgb,var(--primary)_8%,var(--card))]",
        className,
      )}
    >
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p
        className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight"
        style={{ color: tono }}
      >
        {euros(valor)} €
      </p>
    </div>
  );
}
