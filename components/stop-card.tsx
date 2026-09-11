"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check, Navigation, Pencil, Phone, TriangleAlert, X } from "lucide-react";
import type { Stop } from "@/lib/types";
import { formatDistance, formatDuration, telHref } from "@/lib/format";
import { euros, parseImporte } from "@/lib/factura";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  stop: Stop;
  onDelivered: (orderId: string, price: number | null) => void;
  onIncident: (orderId: string, note: string) => void;
  /** Si true, muestra los botones de subir/bajar. */
  reorderable?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  /** Si se pasa, muestra un botón para desasignar la parada (p. ej. del calendario). */
  onRemove?: () => void;
  /**
   * Ficha completa en vez de tarjeta de lista.
   *
   * En una lista se ojean veinte comandas y lo que importa es el nombre y la
   * calle; abierta a solas hay sitio de sobra y lo que hace falta es TODO lo
   * que se sabe de ella, con su etiqueta y sin abreviar. Es el mismo
   * componente porque los botones de entregar y de incidencia son los
   * mismos: solo cambia cómo se reparte la información.
   */
  detall?: boolean;
  /**
   * Corrige el importe, tantas veces como haga falta y también después de
   * entregar. Sin esto, un dedazo en el precio solo se arreglaba editando el
   * Google Sheet a mano.
   *
   * Es un camino aparte de `onDelivered` a propósito: cambiar el importe no
   * puede reescribir la hora de entrega.
   */
  onImporte?: (orderId: string, importe: number | null) => void;
  /**
   * Qué va al pie de la tarjeta EN LUGAR de los botones de entregar.
   *
   * Existe por la previsualización de la bossa: allí la comanda se enseña
   * para decidir a qué día va, y "Entregat" e "Incidència" no hacían nada
   * —se abrían y se quedaban ahí— porque quien la abre no pasa ningún
   * manejador. Un botón que no hace nada es peor que no tener botón, así
   * que el pie se cambia por lo que sí toca hacer allí: assignar-la.
   */
  peu?: React.ReactNode;
}

/** Una fecha del Sheet, tal y como se lee: 01/07/2026. */
function data(valor: string | null | undefined): string | null {
  if (!valor) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor.split("-").reverse().join("/") : valor;
}

/**
 * Un dato de la ficha: nombre a la izquierda, valor a la derecha.
 *
 * En fila y no en rejilla. Con la rejilla de dos columnas, una ficha de tres
 * datos dejaba el tercero solo con medio hueco al lado, y los valores largos
 * —el teléfono con el nombre de quien recoge delante, las medidas de cuatro
 * bultos— partían por donde les tocaba. En fila cada dato ocupa lo que
 * necesita, la ficha se lee de arriba abajo y queda como la fila del
 * importe de abajo, que es una más.
 *
 * Lo que falta se enseña con una raya en vez de esconderse: en una comanda
 * que no se entrega, saber que NO hay teléfono es tan útil como el número.
 */
function Camp({
  etiqueta,
  valor,
  mono,
}: {
  etiqueta: string;
  valor: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-tertiary-foreground">
        {etiqueta}
      </dt>
      <dd
        className={cn(
          "min-w-0 break-words text-right text-sm",
          mono && "font-mono",
          valor ? "text-foreground" : "text-tertiary-foreground",
        )}
      >
        {valor || "—"}
      </dd>
    </div>
  );
}

const CATEGORY_BADGE: Record<
  string,
  { label: string; variant: "success" | "warning" | "secondary" | "default"; className?: string }
> = {
  entregat: { label: "Entregat", variant: "success" },
  incidencia: { label: "Incidència", variant: "warning" },
  en_curs: {
    label: "En curs",
    variant: "secondary",
    className: "bg-[color-mix(in_srgb,var(--status-en-curs)_15%,transparent)] text-status-en-curs",
  },
};

/**
 * Una parada de la ruta, como una celda de lista agrupada de iOS: fondo
 * blanco sobre el gris de la pantalla, esquinas redondeadas y sin sombra.
 * La separación la da el fondo, no una sombra difusa.
 *
 * El color se reserva para lo que informa: azul para lo pulsable, y el color
 * de cada categoría de estado (pendent/en curs/entregat/incidència).
 */
/**
 * El importe de la comanda, editable en el sitio.
 *
 * Se guarda al salir del campo o al pulsar Intro, sin botón de confirmar, y
 * la marca de guardado aparece un segundo para que no quede duda. Vale igual
 * para una entrega ya cerrada: corregir un precio no la reabre.
 *
 * Va en su propia fila al pie de la tarjeta, fuera del bloque que se atenúa
 * cuando la comanda ya está cerrada. En l'Historial casi todas lo están, así
 * que el importe salía descolorido como el resto —y es justo lo único de esa
 * tarjeta que se puede tocar—. Ahora es lo que más se ve: el número en
 * grande, encuadrado como un campo y con el lápiz en el color de lo pulsable.
 */
function ImportEditable({
  stop,
  onImporte,
  editant,
  setEditant,
  desat,
  setDesat,
}: {
  stop: Stop;
  onImporte?: (orderId: string, importe: number | null) => void;
  editant: string | null;
  setEditant: (v: string | null) => void;
  desat: boolean;
  setDesat: (v: boolean) => void;
}) {
  const actual = stop.price !== null ? `${euros(stop.price)} €` : null;

  const etiqueta = (
    <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      Import
      {desat && (
        <span className="flex items-center gap-0.5 normal-case text-[color:var(--success)]">
          <Check className="size-3" strokeWidth={3} />
          desat
        </span>
      )}
    </span>
  );

  // Sin quien lo guarde, es un dato más.
  if (!onImporte) {
    return (
      <div className="flex items-center justify-between gap-3">
        {etiqueta}
        <span
          className={cn(
            "text-base font-semibold tabular-nums",
            !actual && "font-normal text-tertiary-foreground",
          )}
        >
          {actual ?? "—"}
        </span>
      </div>
    );
  }

  const desar = () => {
    if (editant === null) return;
    const valor = parseImporte(editant);
    // Lo que no es un número se queda en el campo para poder corregirlo.
    if (valor === undefined) return;
    setEditant(null);
    if (valor !== stop.price) {
      onImporte(stop.id, valor);
      setDesat(true);
      setTimeout(() => setDesat(false), 1600);
    }
  };

  const malament = editant !== null && editant.trim() !== "" && parseImporte(editant) === undefined;

  return (
    <div className="flex items-center justify-between gap-3">
      {etiqueta}
      {editant !== null ? (
        <input
          value={editant}
          onChange={(e) => setEditant(e.target.value)}
          onBlur={desar}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditant(null);
            }
          }}
          onFocus={(e) => e.currentTarget.select()}
          autoFocus
          type="text"
          inputMode="decimal"
          placeholder="0,00"
          aria-label={`Import de la comanda ${stop.id}`}
          aria-invalid={malament || undefined}
          className={cn(
            "w-32 rounded-lg px-3 py-1.5 text-right text-base font-semibold tabular-nums outline-none ring-1",
            malament
              ? "bg-[color-mix(in_srgb,var(--destructive)_14%,transparent)] text-destructive ring-destructive"
              : "bg-muted ring-ring/50",
          )}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditant(stop.price !== null ? euros(stop.price) : "")}
          /* Con marco y fondo: sin ellos, un número suelto a la derecha de la
             tarjeta no se distingue de los otros datos y nadie prueba a
             pulsarlo. */
          className="pressable flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 ring-1 ring-border"
        >
          <span
            className={cn(
              "text-base font-semibold tabular-nums",
              !actual && "text-primary",
            )}
          >
            {actual ?? "Posar import"}
          </span>
          <Pencil className="size-3.5 shrink-0 text-primary" aria-hidden />
        </button>
      )}
    </div>
  );
}

export default function StopCard({
  stop,
  onDelivered,
  onIncident,
  reorderable,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  onRemove,
  detall,
  onImporte,
  peu,
}: Props) {
  const [showIncident, setShowIncident] = useState(false);
  const [showPrice, setShowPrice] = useState(false);
  const [showNav, setShowNav] = useState(false);
  const [note, setNote] = useState("");
  const [price, setPrice] = useState("");
  /** El importe que se está corrigiendo. `null` = no se está tocando. */
  const [editantImport, setEditantImport] = useState<string | null>(null);
  /** Se enciende un momento al guardar, para que se vea que ha ido. */
  const [desat, setDesat] = useState(false);

  // Coma o punto: en el móvil el teclado numérico da una u otro según el
  // idioma. La cuenta la hace `parseImporte`, la misma que la factura, para
  // que "12.50" valga lo mismo tecleado aquí que tecleado allí.
  const importeParseado = parseImporte(price);
  const importeValido = importeParseado !== undefined;
  const importe = importeParseado ?? null;

  // `false` durante el render de servidor y `true` ya en el cliente, sin
  // pasar por un estado: createPortal necesita el DOM, que en el servidor no
  // existe. Hacerlo con un `setState` en un efecto provoca un render extra
  // en cada tarjeta de la lista.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Un pedido "en curs" sigue abierto: es un reparto en marcha, el estado más
  // accionable de todos. Solo "entregat" e "incidencia" están cerrados.
  //
  // Compararlo únicamente con "pendent" lo daba por cerrado: la tarjeta salía
  // atenuada y sin el bloque de acciones, así que no había manera de marcarlo
  // como entregado desde la app aunque la lista sí lo mostrara.
  const isOpen =
    stop.statusCategory === "pendent" || stop.statusCategory === "en_curs";
  const done = !isOpen;

  // Quién conserva los botones: todo lo que no esté ya entregado.
  //
  // Una incidencia no es definitiva. "No estaba en casa" hoy puede acabar
  // entregándose mañana, y sin botón la única forma de cerrarla era editar la
  // hoja a mano. Mantiene el aspecto apagado —no es una parada activa de la
  // ruta— pero sigue pudiendo marcarse.
  //
  // Un pedido ya entregado sí los pierde: volver a marcarlo solo serviría
  // para pisar la hora de entrega que quedó guardada en la hoja.
  const canClose = stop.statusCategory !== "entregat";
  const leg = [
    formatDistance(stop.legDistanceMeters),
    formatDuration(stop.legDurationSeconds),
  ]
    .filter(Boolean)
    .join(" · ");

  const badgeInfo = CATEGORY_BADGE[stop.statusCategory ?? ""];

  return (
    // Un <div>, no un <li>: la tarjeta se usa dentro de listas, dentro de
    // bloques sueltos y dentro de un modal de vista previa. Siendo <li> los
    // tres últimos casos generaban HTML inválido —y en la lista de pendientes
    // un <li> dentro de otro <li>, que además rompe la hidratación—. Quien la
    // use dentro de una lista es el que pone su propio <li>.
    <div className="animate-rise-in overflow-hidden soft-card text-card-foreground">
      <div className={cn("flex gap-3 p-4", detall && "sm:gap-4 sm:p-6", done && "opacity-55")}>
        {/* Controles de orden manual (solo pendientes) */}
        {reorderable && isOpen && (
          <div className="flex shrink-0 flex-col items-center justify-center gap-1 text-tertiary-foreground">
            <button
              className="pressable rounded-md p-1 disabled:opacity-30"
              onClick={onMoveUp}
              disabled={isFirst}
              aria-label="Pujar"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
            </button>
            <button
              className="pressable rounded-md p-1 disabled:opacity-30"
              onClick={onMoveDown}
              disabled={isLast}
              aria-label="Baixar"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          </div>
        )}

        {/* Número de parada */}
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white",
            stop.statusCategory === "entregat"
              ? "bg-success"
              : stop.statusCategory === "incidencia"
                ? "bg-warning"
                : stop.statusCategory === "en_curs"
                  ? "bg-status-en-curs"
                  : "bg-primary",
          )}
          aria-hidden
        >
          {stop.statusCategory === "entregat" ? (
            <Check className="size-4" strokeWidth={2.5} />
          ) : stop.statusCategory === "incidencia" ? (
            <TriangleAlert className="size-3.5" strokeWidth={2.5} />
          ) : (
            stop.sequence
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p
              className={cn(
                "min-w-0 flex-1 truncate font-semibold",
                detall ? "text-xl" : "text-base",
              )}
            >
              {stop.customer || stop.address}
            </p>
            {badgeInfo && (
              <Badge variant={badgeInfo.variant} className={badgeInfo.className}>
                {badgeInfo.label}
              </Badge>
            )}
            {onRemove && (
              <button
                onClick={onRemove}
                className="pressable shrink-0 rounded-full bg-muted p-1 text-muted-foreground"
                aria-label="Treure del dia"
              >
                <X className="size-3.5" strokeWidth={2.5} />
              </button>
            )}
          </div>

          {/* Dirección y población. En la ficha, seguidas en una línea: hay
              ancho de sobra y partirlas en dos solo alarga la tarjeta. */}
          {detall ? (
            <p className="mt-1 text-base text-muted-foreground">
              {[stop.address, stop.city].filter(Boolean).join(" · ")}
            </p>
          ) : (
            <>
              <p className="mt-0.5 text-sm text-muted-foreground">{stop.address}</p>
              {stop.city && <p className="text-sm text-muted-foreground">{stop.city}</p>}
            </>
          )}

          {detall ? (
            /* Todo lo que se sabe de la comanda, cada dato con su nombre. En
               la tarjeta de lista esto no cabe y por eso allí va apretado en
               una línea de letra pequeña. */
            <dl className="mt-4 border-t border-border pt-2 sm:grid sm:grid-cols-2 sm:gap-x-10">
              <Camp etiqueta="Comanda" valor={stop.id} mono />
              {/*
                El día solo cuando ya está hecha, y entonces es el día en que
                se hizo.

                Mientras está por repartir no dice nada que no se sepa: en la
                bossa está vacío por definición, y abierta desde un día del
                calendario ese día es justo el que se está mirando. Donde sí
                hace falta es en l'Historial, que es mirar atrás.
              */}
              {done && stop.date && (
                <Camp
                  etiqueta={stop.statusCategory === "incidencia" ? "Incidència el" : "Entregat el"}
                  valor={[data(stop.date), stop.deliveredTime].filter(Boolean).join(" · ")}
                />
              )}
              <Camp etiqueta="Telèfon" valor={stop.phone} />
              {/* Cuántos paquetes hay que cargar. Una comanda son varias
                  filas en la hoja, una por bulto, y hasta ahora solo se veía
                  la primera. Ver `bultos` en lib/types.ts. */}
              <Camp
                etiqueta={stop.bultos > 1 ? `Mides · ${stop.bultos} bultos` : "Mides"}
                valor={stop.measures}
              />
              {leg && isOpen && <Camp etiqueta="Des de l'anterior" valor={leg} />}
            </dl>
          ) : (
            <>
              {/* El nº de comanda. La fecha en que la oficina la metió en la
                  hoja no sale: no cambia nada de lo que hay que hacer con
                  ella. Sigue sirviendo para ORDENAR la bossa —primero lo que
                  lleva más tiempo esperando—, que es para lo único que se
                  usa. */}
              <p className="mt-1 font-mono text-xs text-tertiary-foreground">{stop.id}</p>

              {(stop.measures || stop.bultos > 1) && (
                <p className="mt-1 text-xs text-tertiary-foreground">
                  📦{" "}
                  {stop.bultos > 1 && (
                    <span className="font-semibold text-foreground">
                      {stop.bultos} bultos
                    </span>
                  )}
                  {stop.bultos > 1 && stop.measures && " · "}
                  {stop.measures}
                </p>
              )}

              {leg && isOpen && (
                <p className="mt-1 text-xs text-tertiary-foreground">
                  {leg} des de la parada anterior
                </p>
              )}
            </>
          )}

          {stop.notes && (
            <div
              className={cn(
                "rounded-lg bg-warning-surface px-3 py-2 text-sm text-warning-foreground",
                detall ? "mt-4" : "mt-2.5",
              )}
            >
              {detall && (
                <p className="mb-0.5 text-[11px] font-medium uppercase tracking-wide opacity-70">
                  Observacions
                </p>
              )}
              {stop.notes}
            </div>
          )}

          <div className={cn("flex flex-col gap-2", detall ? "mt-4" : "mt-3")}>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowNav(true)}>
                <Navigation />
                Navegar
              </Button>
              {stop.phone && (
                <Button asChild variant="secondary" size="sm">
                  <a href={telHref(stop.phone)}>
                    <Phone />
                    Trucar
                  </a>
                </Button>
              )}
            </div>

            {/* Selector de app de navegación, como el action sheet de iOS. */}
            {showNav && mounted && createPortal(
              <div className="fixed inset-0 z-50 flex flex-col justify-end">
                <div
                  className="absolute inset-0 animate-fade-in bg-black/40 backdrop-blur-sm"
                  onClick={() => setShowNav(false)}
                />
                <div className="relative w-full animate-rise-in rounded-t-[20px] bg-[#1c1c1e] p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-white shadow-2xl">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-semibold tracking-tight">Seleccionar aplicació</h3>
                    <button
                      onClick={() => setShowNav(false)}
                      className="pressable rounded-full bg-[#3a3a3c] p-1.5"
                      aria-label="Tancar"
                    >
                      <X className="size-5" />
                    </button>
                  </div>

                  <div className="flex flex-col overflow-hidden rounded-xl bg-[#2c2c2e]">
                    <a
                      href={stop.lat ? `http://maps.apple.com/?daddr=${stop.lat},${stop.lng}&dirflg=d` : `http://maps.apple.com/?daddr=${encodeURIComponent(stop.address)}&dirflg=d`}
                      target="_blank" rel="noopener noreferrer"
                      className="border-b border-white/10 px-4 py-3.5 text-[17px] text-[#0a84ff] transition-colors active:bg-[#3a3a3c]"
                    >
                      Mapes
                    </a>
                    <a
                      href={stop.lat ? `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}&travelmode=driving`}
                      target="_blank" rel="noopener noreferrer"
                      className="border-b border-white/10 px-4 py-3.5 text-[17px] text-[#0a84ff] transition-colors active:bg-[#3a3a3c]"
                    >
                      Google Maps
                    </a>
                    <a
                      href={stop.lat ? `https://waze.com/ul?ll=${stop.lat},${stop.lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(stop.address)}&navigate=yes`}
                      target="_blank" rel="noopener noreferrer"
                      className="px-4 py-3.5 text-[17px] text-[#0a84ff] transition-colors active:bg-[#3a3a3c]"
                    >
                      Waze
                    </a>
                  </div>
                </div>
              </div>,
              document.body,
            )}
          </div>
        </div>
      </div>

      {/*
        El importe, en su propia fila y fuera del bloque de arriba.

        Ahí dentro se atenúa todo cuando la comanda está cerrada, que en
        l'Historial son casi todas, y el importe es lo único que se puede
        tocar: tiene que verse más que el resto, no menos. Solo sale donde el
        padre pasa `onImporte` —en la ruta del día estorbaría— o en la ficha,
        donde es un dato más de la comanda.
      */}
      {(onImporte || detall) && (
        <div className={cn("hairline px-4 py-3", detall && "sm:px-6")}>
          <ImportEditable
            stop={stop}
            onImporte={onImporte}
            editant={editantImport}
            setEditant={setEditantImport}
            desat={desat}
            setDesat={setDesat}
          />
        </div>
      )}

      {peu !== undefined && <div className="hairline p-3.5">{peu}</div>}

      {canClose && peu === undefined && (
        <div className="hairline p-3.5">
          {showPrice ? (
            /* Cuánto se cobra por esta entrega. Va aquí y no al final de mes
               porque es el único momento en que el transportista lo tiene
               delante. Se puede dejar en blanco: primero entregar, que es su
               trabajo; el importe se puede poner luego desde l'Historial. */
            <div className="animate-fade-in space-y-3">
              <label htmlFor={`price-${stop.id}`} className="block text-sm font-medium">
                Quant cobres per aquesta entrega?
              </label>
              <div className="flex items-center gap-2 rounded-lg bg-muted px-3">
                <input
                  id={`price-${stop.id}`}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  placeholder="0,00"
                  className="w-full bg-transparent py-2.5 text-base tabular-nums placeholder:text-tertiary-foreground outline-none"
                />
                <span className="text-base text-muted-foreground">€</span>
              </div>
              <div className="flex gap-1">
                <Button
                  size="touch"
                  className="flex-1"
                  disabled={!importeValido}
                  onClick={() => {
                    onDelivered(stop.id, importe);
                    setShowPrice(false);
                    setPrice("");
                  }}
                >
                  <Check strokeWidth={2.5} />
                  Entregat
                </Button>
                <Button
                  variant="ghost"
                  size="touch"
                  className="shrink-0"
                  onClick={() => {
                    setShowPrice(false);
                    setPrice("");
                  }}
                >
                  Cancel·lar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Si ho deixes en blanc, l&apos;entrega es guarda igualment i
                podràs posar l&apos;import en generar la factura.
              </p>
            </div>
          ) : !showIncident ? (
            <div className="flex items-center gap-1">
              <Button size="touch" className="flex-1" onClick={() => setShowPrice(true)}>
                <Check strokeWidth={2.5} />
                Entregat
              </Button>
              <Button variant="ghost" size="touch" onClick={() => setShowIncident(true)}>
                Incidència
              </Button>
            </div>
          ) : (
            <div className="animate-fade-in space-y-3">
              <label htmlFor={`note-${stop.id}`} className="block text-sm font-medium">
                Què ha passat?
              </label>
              <textarea
                id={`note-${stop.id}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={500}
                autoFocus
                placeholder="Absent, adreça incorrecta, rebutjat…"
                className="w-full resize-none rounded-lg bg-muted px-3 py-2.5 text-base placeholder:text-tertiary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <div className="flex gap-1">
                <Button
                  size="touch"
                  className="flex-1"
                  onClick={() => {
                    onIncident(stop.id, note.trim());
                    setShowIncident(false);
                    setNote("");
                  }}
                >
                  Guardar incidència
                </Button>
                <Button
                  variant="ghost"
                  size="touch"
                  onClick={() => {
                    setShowIncident(false);
                    setNote("");
                  }}
                >
                  Cancel·lar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
