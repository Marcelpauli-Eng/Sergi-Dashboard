"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { getSelectedTab, subscribeLocalPrefs } from "@/lib/sync";
import { formatLongDate } from "@/lib/dates";

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

export default function NovaComanda() {
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

  const [id, setId] = useState("");
  const [camps, setCamps] = useState<Record<Clau, string>>({
    customer: "",
    address: "",
    city: "",
    phone: "",
    measures: "",
    notes: "",
  });
  const [desant, setDesant] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crear = async () => {
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
          ...(full ? { sheetTab: full } : {}),
        }),
      });
      const cos = (await resposta.json().catch(() => null)) as { error?: string } | null;
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
            onChange={(e) => setId(e.target.value)}
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
            </div>
          ))}
        </div>

        <p className="px-1 text-xs text-tertiary-foreground">
          La data de creació la posa l&apos;app: avui,{" "}
          {formatLongDate(new Date().toISOString().slice(0, 10))}. La comanda va
          a la bossa i des d&apos;allà se li assigna dia.
        </p>

        {error && (
          <p className="rounded-xl bg-warning-surface px-4 py-2.5 text-sm text-warning-foreground">
            {error}
          </p>
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
