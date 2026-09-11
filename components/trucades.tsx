"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Check, Phone, PhoneOff, RotateCcw } from "lucide-react";
import { formatLongDate } from "@/lib/dates";
import { telHref } from "@/lib/format";
import {
  diaPerDefecte,
  diesPerTrucar,
  etiquetaDia,
  resumTrucades,
} from "@/lib/trucades";
import {
  getTrucades,
  getTrucadesServer,
  marcarTrucada,
  subscribeLocalPrefs,
} from "@/lib/sync";
import type { Stop } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Las llamadas de la víspera.
 *
 * El cliente prepara las comandas para el día siguiente, así que las
 * llamadas se hacen la tarde de antes: hay que poder llamar a las de MAÑANA
 * estando en el día de hoy. Antes el teléfono solo estaba a mano en la ruta
 * del día, y para llamar a las de mañana había que ir al calendario, buscar
 * el día y abrir las fichas una por una.
 *
 * Por eso la pantalla se abre por mañana y no por hoy, y por eso están todos
 * los días —los atrasados y los que no tienen día también: son justo los que
 * hay que llamar para poder ponerles uno.
 *
 * Lo que se ha llamado se marca solo al pulsar Trucar. Marcarlo a mano
 * después de cada llamada es un paso que nadie da con el móvil en la oreja,
 * y sin ese dato la lista no sirve para saber por dónde ibas.
 */
export default function Trucades({
  stops,
  avui,
}: {
  /** Todas las comandas del full. */
  stops: Stop[];
  /** El día de hoy según el servidor, YYYY-MM-DD. */
  avui: string;
}) {
  const trucades = useSyncExternalStore(
    subscribeLocalPrefs,
    getTrucades,
    getTrucadesServer,
  );

  const dies = useMemo(() => diesPerTrucar(stops), [stops]);

  /** `null` mientras no se haya tocado ningún día: manda el que toca. */
  const [triat, setTriat] = useState<string | null>(null);
  const perDefecte = diaPerDefecte(dies, avui);
  // El elegido a mano puede haber desaparecido —se entregó lo último que
  // quedaba de ese día— y entonces vuelve a mandar el que toca.
  const diaActiu =
    triat !== null && dies.some((d) => d.date === triat) ? triat : perDefecte;

  const dia = dies.find((d) => d.date === diaActiu);
  const comandas = dia?.comandas ?? [];
  const resum = resumTrucades(comandas, trucades);

  if (dies.length === 0) {
    return (
      <div className="animate-fade-in py-16 text-center">
        <Phone className="mx-auto size-8 text-tertiary-foreground" aria-hidden />
        <p className="mt-3 text-base font-medium">No hi ha ningú per trucar</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Totes les comandes d&apos;aquest full estan tancades.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5">
      {/* ── Los días ──────────────────────────────────────────────────── */}
      <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <div className="flex w-max items-center gap-2">
          {dies.map((d) => {
            const pendents = resumTrucades(d.comandas, trucades).perTrucar;
            const actiu = d.date === diaActiu;
            return (
              <button
                key={d.date || "sense-dia"}
                type="button"
                onClick={() => setTriat(d.date)}
                aria-pressed={actiu}
                className={cn(
                  "pressable flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium",
                  actiu
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {etiquetaDia(d.date, avui)}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-xs font-semibold tabular-nums",
                    actiu
                      ? "bg-primary-foreground/20"
                      : pendents > 0
                        ? "bg-primary/15 text-primary"
                        : "bg-success/15 text-success",
                  )}
                >
                  {pendents > 0 ? pendents : <Check className="size-3" aria-hidden />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Cómo va el día ────────────────────────────────────────────── */}
      <div className="soft-card p-4">
        <p className="text-sm text-muted-foreground first-letter:uppercase">
          {diaActiu ? formatLongDate(diaActiu) : "Comandes sense dia assignat"}
        </p>
        <p className="mt-1 text-2xl font-semibold">
          {resum.perTrucar > 0
            ? `${resum.perTrucar} per trucar`
            : "Trucades fetes"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {resum.trucats} de {resum.ambTelefon} trucades
          {resum.senseTelefon > 0 && ` · ${resum.senseTelefon} sense telèfon`}
        </p>
      </div>

      {/* ── La lista ──────────────────────────────────────────────────── */}
      <ul className="space-y-2">
        {comandas.map((stop) => (
          <Fila
            key={stop.id}
            stop={stop}
            trucadaA={trucades[stop.id]}
            onTrucat={(feta) => marcarTrucada(stop.id, feta)}
          />
        ))}
      </ul>
    </div>
  );
}

/** Una comanda de la lista: a quién se llama y si ya se ha llamado. */
function Fila({
  stop,
  trucadaA,
  onTrucat,
}: {
  stop: Stop;
  /** ISO de cuándo se llamó, o `undefined` si todavía no. */
  trucadaA: string | undefined;
  onTrucat: (feta: boolean) => void;
}) {
  const telefon = (stop.phone ?? "").trim();
  const feta = trucadaA !== undefined;

  return (
    <li
      className={cn(
        "soft-card flex items-center gap-3 p-4",
        // Lo hecho se apaga en vez de desaparecer: hay que poder repasarlo,
        // y a veces hay que volver a llamar.
        feta && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{stop.customer || stop.id}</p>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {[stop.address, stop.city].filter(Boolean).join(" · ")}
        </p>
        <p className="mt-0.5 truncate text-xs text-tertiary-foreground">
          <span className="font-mono">{stop.id}</span>
          {stop.bultos > 1 && ` · ${stop.bultos} bultos`}
          {feta && ` · Trucat ${quan(trucadaA)}`}
        </p>
      </div>

      {telefon === "" ? (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-tertiary-foreground">
          <PhoneOff className="size-4" aria-hidden />
          Sense telèfon
        </span>
      ) : feta ? (
        <div className="flex shrink-0 items-center gap-1">
          {/* Volver a llamar sin tener que desmarcar primero. */}
          <a
            href={telHref(telefon)}
            className="pressable flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground"
          >
            <Phone className="size-4" aria-hidden />
            {telefon}
          </a>
          <button
            type="button"
            onClick={() => onTrucat(false)}
            aria-label={`Desmarcar la trucada de ${stop.customer || stop.id}`}
            className="pressable flex size-11 items-center justify-center rounded-full text-muted-foreground"
          >
            <RotateCcw className="size-4" aria-hidden />
          </button>
        </div>
      ) : (
        <Button
          asChild
          size="sm"
          className="shrink-0"
          // La llamada se da por hecha al pulsar: con el móvil en la oreja
          // nadie vuelve a la app a marcarla.
          onClick={() => onTrucat(true)}
        >
          <a href={telHref(telefon)}>
            <Phone aria-hidden />
            Trucar
          </a>
        </Button>
      )}
    </li>
  );
}

/** "fa 10 min", "ahir": lo justo para saber si la llamada es de ahora. */
function quan(iso: string): string {
  const minuts = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(minuts) || minuts < 1) return "ara mateix";
  if (minuts < 60) return `fa ${minuts} min`;
  const hores = Math.floor(minuts / 60);
  if (hores < 24) return `fa ${hores} h`;
  const dies = Math.floor(hores / 24);
  return dies === 1 ? "ahir" : `fa ${dies} dies`;
}
