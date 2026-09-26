"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { getSelectedTab, subscribeLocalPrefs } from "@/lib/sync";
import { formatLongDate } from "@/lib/dates";
import CampAdreca from "@/components/camp-adreca";
import type { LlocTriat } from "@/lib/llocs";

/**
 * Crear una comanda a mano.
 *
 * Pantalla aparte y no un diálogo encima del calendario: es un formulario de
 * siete campos que se rellena de pie, con el móvil en una mano, y un diálogo
 * de esa altura acaba tapado por el teclado.
 *
 * Solo el número es obligatorio. Es la clave de todo lo demás —el importe,
 * la factura y la propia fila de la hoja se buscan por él— y el resto se
 * puede completar después desde la ficha, así que pedirlo todo aquí sería
 * poner una barrera donde no hace falta.
 */

/** Un campo del formulario: qué se guarda y cómo se teclea. */
const CAMPS = [
  {
    clau: "customer",
    etiqueta: "Client",
    exemple: "RICARD CIRCUNS",
    autoCapitalize: "characters",
  },
  { clau: "address", etiqueta: "Adreça", exemple: "Carrer Cabrerés, 2" },
  { clau: "city", etiqueta: "Població", exemple: "08500 Vic" },
  { clau: "phone", etiqueta: "Telèfon", exemple: "650 90 43 59", type: "tel" },
  { clau: "measures", etiqueta: "Mides", exemple: "100 x 80 x 120 cm" },
  { clau: "notes", etiqueta: "Observacions", exemple: "Trucar abans d'anar" },
] as const;

type Clau = (typeof CAMPS)[number]["clau"];

export default function NovaComanda({
  origen = "",
}: {
  /** En qué documento se crea: "" el de siempre. Ver `Order.origen`. */
  origen?: string;
}) {
  const router = useRouter();

  /*
    El full donde se va a crear: el que estás mirando, y punto.

    No el que le tocaría por la fecha de hoy. Si estás repasando JUL 26 y
    creas una comanda, va a JUL 26; si estás en SET 26, a SET 26. Es el mismo
    que sale en la cabecera de la app: el elegido a mano si lo hay, y si no
    el del manifiesto que tienes descargado, que es el que estás viendo.
    Solo cuando no hay ninguno de los dos decide el servidor.
  */
  const triat = useSyncExternalStore(subscribeLocalPrefs, getSelectedTab, () => null);
  const desat = useLiveQuery(() => db.manifest.get("current"), []);
  const full = triat ?? desat?.data.sheetTab ?? null;
  /** La bossa donde va a caer, para decirlo. Solo si hay más de una. */
  const origens = desat?.data.origens ?? [];
  const bossa = origens.length > 1 ? origens.find((o) => o.id === origen) : undefined;

  const [id, setId] = useState("");
  const [camps, setCamps] = useState<Record<Clau, string>>({
    customer: "",
    address: "",
    city: "",
    phone: "",
    measures: "",
    notes: "",
  });
  /*
    La dirección elegida de la lista de Google, si se ha elegido.

    Se manda con la comanda y la hace nacer con el punto exacto: ni hay que
    buscarla después, ni puede salir el centro del pueblo. Escribiéndola a
    mano se queda en `null` y se hace lo de siempre.
  */
  const [lloc, setLloc] = useState<LlocTriat | null>(null);
  const [desant, setDesant] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
    El número ya está en el full y hay que preguntar qué es.

    Casi siempre es un número mal tecleado y por eso no se crea a la primera.
    Pero una comanda que se entrega en dos veces son dos filas con el mismo
    número —una parte hoy, el resto cuando llegue—, y eso solo lo sabe quien
    la está creando. Se le pregunta y se reenvía con `afegirPart`.
  */
  const [repetida, setRepetida] = useState(false);

  const crear = async (afegirPart = false) => {
    if (id.trim() === "" || desant) return;
    setDesant(true);
    setError(null);
    try {
      const resposta = await fetch("/api/comandes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: id.trim(),
          ...camps,
          // Solo si la dirección sigue siendo la que se eligió: si después
          // se ha retocado a mano, el punto ya no es de esa dirección.
          ...(lloc && lloc.address === camps.address ? { lloc } : {}),
          ...(full ? { sheetTab: full } : {}),
          ...(origen ? { origen } : {}),
          ...(afegirPart ? { afegirPart: true } : {}),
        }),
      });
      const cos = (await resposta.json().catch(() => null)) as {
        error?: string;
        repetida?: boolean;
      } | null;
      if (resposta.status === 409 && cos?.repetida) {
        setRepetida(true);
        setError(cos.error ?? null);
        setDesant(false);
        return;
      }
      if (!resposta.ok) throw new Error(cos?.error ?? "No s'ha pogut crear");
      // A la bossa, que es donde acaba de caer: el calendario la descarga al
      // entrar y desde allí se le pone día.
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconegut");
      setDesant(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-2xl flex-col">
      <header className="sticky top-0 z-20 bg-background pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/")}
            aria-label="Tornar"
          >
            <ChevronLeft />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">Nova comanda</h1>
            <p className="truncate text-xs text-muted-foreground">
              {bossa && `${bossa.nom} · `}
              {/* Al segundo documento también: si no tiene ese mes, el
                  servidor se lo crea con este mismo nombre. */}
              {full ? `S'afegirà al full ${full}` : "S'afegirà al full del mes"}
            </p>
          </div>
        </div>
      </header>

      <form
        className="flex-1 space-y-5 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void crear();
        }}
      >
        {/* El número, solo y arriba: es el único que hace falta de verdad. */}
        <div className="soft-card p-4">
          <label htmlFor="comanda" className="block text-sm font-medium">
            Nº de comanda
          </label>
          <input
            id="comanda"
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              // Otro número, otra pregunta: lo que se contestó del anterior
              // no vale para este.
              setRepetida(false);
              setError(null);
            }}
            autoFocus
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="C260600907W"
            aria-describedby="comanda-ajuda"
            className="mt-2 w-full rounded-xl bg-muted px-3 py-2.5 font-mono text-base outline-none placeholder:text-tertiary-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <p id="comanda-ajuda" className="mt-2 text-xs text-muted-foreground">
            L&apos;únic obligatori. És el número amb el que es guarda
            l&apos;import i es fa la factura, així que ha de ser el mateix que
            fa servir l&apos;oficina.
          </p>
        </div>

        <div className="soft-card divide-y divide-border">
          {CAMPS.map((camp) => (
            <div key={camp.clau} className="p-4">
              <label htmlFor={camp.clau} className="block text-sm font-medium">
                {camp.etiqueta}
                <span className="ml-1.5 text-xs font-normal text-tertiary-foreground">
                  opcional
                </span>
              </label>
              {camp.clau === "address" ? (
                /* La dirección se elige de la lista de Google: es la única
                   forma de que el punto sea exacto seguro. Se puede escribir
                   a mano igual, que entonces se busca al hacer la ruta. */
                <CampAdreca
                  id={camp.clau}
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
                      city: triat.city || previs.city,
                    }));
                  }}
                  placeholder={camp.exemple}
                />
              ) : (
                <input
                  id={camp.clau}
                  value={camps[camp.clau]}
                  onChange={(e) =>
                    setCamps((previs) => ({ ...previs, [camp.clau]: e.target.value }))
                  }
                  type={"type" in camp ? camp.type : "text"}
                  autoCapitalize={"autoCapitalize" in camp ? camp.autoCapitalize : undefined}
                  placeholder={camp.exemple}
                  className="mt-2 w-full rounded-xl bg-muted px-3 py-2.5 text-base outline-none placeholder:text-tertiary-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                />
              )}
            </div>
          ))}
        </div>

        <p className="px-1 text-xs text-tertiary-foreground">
          La data de creació la posa l&apos;app: avui,{" "}
          {formatLongDate(new Date().toISOString().slice(0, 10))}. La comanda va
          a la bossa i des d&apos;allà se li assigna dia.
        </p>

        {error && (
          <div className="rounded-xl bg-warning-surface px-4 py-2.5 text-sm text-warning-foreground">
            <p>{error}</p>
            {repetida && (
              <>
                <p className="mt-1">
                  Si és una altra part de la mateixa comanda —el que no cap en
                  un sol viatge— es pot afegir igualment: serà una entrega a
                  part, amb el seu dia i el seu import, amb el mateix número.
                  El client, l&apos;adreça i el telèfon es copien de la part
                  anterior; les mides i les notes, no, que són d&apos;aquest
                  viatge.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={desant}
                  onClick={() => void crear(true)}
                >
                  Afegir com a altra part del {id.trim()}
                </Button>
              </>
            )}
          </div>
        )}
      </form>

      {/* El botón, abajo y fijo: el formulario es más largo que la pantalla y
          si va al final hay que scrollear hasta el fondo para guardar. */}
      <div className="sticky bottom-0 border-t border-border bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <Button
          size="touch"
          className="w-full"
          disabled={id.trim() === "" || desant}
          onClick={() => void crear()}
        >
          <Plus strokeWidth={2.5} />
          {desant ? "Creant…" : "Crear comanda"}
        </Button>
      </div>
    </div>
  );
}
