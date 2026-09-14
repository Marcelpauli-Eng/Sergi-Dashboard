"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSelectedTab, syncNow } from "@/lib/sync";
import type { Stop } from "@/lib/types";
import CampAdreca from "@/components/camp-adreca";
import type { LlocTriat } from "@/lib/llocs";

/**
 * Corregir los datos de una comanda.
 *
 * Desde que se pueden crear comandas con solo el número, la dirección se
 * sabe cinco minutos después —por teléfono, al confirmar— y hasta ahora eso
 * era abrir el Google Sheet en el móvil. Sirve igual para lo de siempre: un
 * teléfono mal apuntado o un portal cambiado.
 *
 * Un diálogo y no una pantalla aparte porque se abre en medio de otra cosa:
 * mirando la ficha, o justo al generar la ruta cuando salta que una comanda
 * no tiene dirección. Salir de la pantalla ahí sería perder el hilo.
 *
 * Se guarda en la hoja al momento, sin pasar por la cola: la cola es para lo
 * que se marca en la calle. Aquí se corrige lo que hay escrito, y dos
 * correcciones encoladas del mismo dato se pisarían sin que nadie viera cuál
 * ha ganado. Por eso necesita cobertura.
 */

const CAMPS = [
  { clau: "address", etiqueta: "Adreça", exemple: "Carrer Cabrerés, 2" },
  { clau: "city", etiqueta: "Població", exemple: "08500 Vic" },
  { clau: "customer", etiqueta: "Client", exemple: "RICARD CIRCUNS" },
  { clau: "phone", etiqueta: "Telèfon", exemple: "650 90 43 59", type: "tel" },
  { clau: "measures", etiqueta: "Mides", exemple: "100 x 80 x 120 cm" },
  { clau: "notes", etiqueta: "Observacions", exemple: "Trucar abans d'anar" },
] as const;

type Clau = (typeof CAMPS)[number]["clau"];

export default function EditarComanda({
  stop,
  /** En qué campo se entra. La ruta manda aquí con la dirección delante. */
  focus = "address",
  onDesat,
  onTancar,
}: {
  stop: Stop;
  focus?: Clau;
  /** Guardado y ya releída la hoja: quien abrió esto puede seguir. */
  onDesat: () => void;
  onTancar: () => void;
}) {
  /*
    Las medidas se pueden tocar siempre.

    Antes no: cuando una comanda juntaba varias filas, lo que se enseñaba era
    la suma de todas —"100 x 80 · 220 x 80 · …"— y guardarlo habría escrito
    esa cadena entera en la casilla de la primera. Ya no se junta nada: cada
    fila del full es una entrega y las medidas que se ven son las suyas.
  */
  const visibles = CAMPS;

  const [camps, setCamps] = useState<Record<Clau, string>>({
    address: stop.address,
    city: stop.city ?? "",
    customer: stop.customer,
    phone: stop.phone ?? "",
    measures: stop.measures ?? "",
    notes: stop.notes ?? "",
  });
  /*
    La dirección elegida de la lista de Google, si se ha elegido.

    Se manda con el resto y hace que la hoja guarde el portal exacto en vez
    de tener que adivinarlo después. Si se escribe a mano se queda en `null`
    y se hace lo de siempre: buscarla al calcular la ruta.
  */
  const [lloc, setLloc] = useState<LlocTriat | null>(null);
  const [desant, setDesant] = useState(false);
  /* `createPortal` necesita el `document`, que en el servidor no existe: se
     espera al primer pintado en el navegador. Igual que en `stop-card.tsx`. */
  const muntat = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [error, setError] = useState<string | null>(null);

  const desar = async () => {
    setDesant(true);
    setError(null);
    const full = getSelectedTab();
    try {
      const resposta = await fetch("/api/comandes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Solo lo que se ha podido tocar: lo que no sale en el diálogo no
        // se manda, y así no se escribe encima de lo que hay en la hoja.
        body: JSON.stringify({
          id: stop.id,
          ...Object.fromEntries(visibles.map((c) => [c.clau, camps[c.clau]])),
          ...(lloc && lloc.address === camps.address ? { lloc } : {}),
          ...(full ? { sheetTab: full } : {}),
        }),
      });
      const cos = (await resposta.json().catch(() => null)) as { error?: string } | null;
      if (!resposta.ok) throw new Error(cos?.error ?? "No s'ha pogut desar");

      /*
        Y se relee la hoja antes de dar por hecho el cambio: lo que se ve en
        la pantalla sale de lo descargado, no de lo que acabamos de mandar.
        Sin esto, la comanda seguiría saliendo sin dirección hasta el
        siguiente refresco —justo lo que uno acaba de arreglar—.
      */
      await syncNow(full ?? undefined).catch(() => {});
      onDesat();
    } catch (e) {
      /*
        `fetch` lanza un TypeError seco cuando no hay red. Esto se escribe en
        la hoja de la oficina y no pasa por la cola, así que sin cobertura no
        se puede: más vale decirlo con esas palabras.
      */
      const sensaXarxa =
        e instanceof TypeError ||
        (typeof navigator !== "undefined" && !navigator.onLine);
      setError(
        sensaXarxa
          ? "Sense cobertura no es pot desar: això s'escriu al full de l'oficina."
          : e instanceof Error
            ? e.message
            : "Error desconegut",
      );
      setDesant(false);
    }
  };

  /*
    El diálogo se cuelga del `<body>`, no de donde se abrió.

    Se abre desde dentro de la ficha, que a su vez vive dentro del velo de la
    previsualización —y ese velo lleva `backdrop-blur`, que convierte a
    cualquier ancestro suyo en el marco de referencia de lo que esté
    `fixed`—. Según desde dónde se abriera, el diálogo dejaba de medir la
    pantalla entera: la cabecera se veía por encima y la barra de abajo
    tapaba los botones de Desar y Cancel·lar, que es justo lo que hay que
    poder tocar. Colgándolo del body no hay ancestro que valga.
  */
  if (!muntat) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="editar-titol"
      /*
        `z-[200]` deja por debajo la cabecera y la barra de navegación (las
        dos en `z-20`) y también el velo de la previsualización (`z-[100]`).
        En el móvil ocupa la pantalla entera: con la tarjeta centrada y el
        teclado abierto, los botones del pie se quedaban fuera de alcance.
      */
      className="fixed inset-0 z-[200] flex animate-fade-in items-stretch justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onTancar}
    >
      <div
        /*
          `max-sm:rounded-none!` y no `rounded-none` a secas: `.soft-card`
          está declarada fuera de las capas de Tailwind en `globals.css`, y
          el CSS sin capa gana siempre a las utilidades. Sin el `!`, las
          esquinas seguían redondeadas y en pantalla completa se veía el
          fondo negro asomando por las cuatro puntas.
        */
        className="soft-card flex h-full w-full flex-col max-sm:rounded-none! sm:h-auto sm:max-h-[85svh] sm:max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 p-5 max-sm:pt-[max(1.25rem,env(safe-area-inset-top))]">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Pencil className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="editar-titol" className="text-lg font-semibold">
              Dades de la comanda
            </h2>
            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
              {stop.codi}
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto border-t border-border">
          {visibles.map((camp) => (
            <div key={camp.clau} className="px-5 py-3">
              <label htmlFor={`ed-${camp.clau}`} className="block text-sm font-medium">
                {camp.etiqueta}
              </label>
              {camp.clau === "address" ? (
                /* La dirección, con la lista de Google: es la que hay que
                   clavar, y las demás son texto y ya está. */
                <CampAdreca
                  id={`ed-${camp.clau}`}
                  value={camps.address}
                  onChange={(valor) => {
                    setLloc(null);
                    setCamps((previs) => ({ ...previs, address: valor }));
                  }}
                  onTriar={(triat) => {
                    setLloc(triat);
                    setCamps((previs) => ({
                      ...previs,
                      address: triat.address,
                      // La población que dice Google, pero sin borrar la que
                      // ya hubiera si él no la sabe.
                      city: triat.city || previs.city,
                    }));
                  }}
                  autoFocus={camp.clau === focus}
                  placeholder={camp.exemple}
                />
              ) : (
                <input
                  id={`ed-${camp.clau}`}
                  value={camps[camp.clau]}
                  onChange={(e) =>
                    setCamps((previs) => ({ ...previs, [camp.clau]: e.target.value }))
                  }
                  type={"type" in camp ? camp.type : "text"}
                  autoFocus={camp.clau === focus}
                  placeholder={camp.exemple}
                  className="mt-1.5 w-full rounded-xl bg-muted px-3 py-2.5 text-base outline-none placeholder:text-tertiary-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                />
              )}
            </div>
          ))}
        </div>

        <div className="space-y-2 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3">
          {error && (
            <p className="rounded-xl bg-warning-surface px-3 py-2 text-sm text-warning-foreground">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" disabled={desant} onClick={onTancar}>
              Cancel·lar
            </Button>
            <Button className="flex-1" disabled={desant} onClick={() => void desar()}>
              {desant ? "Desant…" : "Desar"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
