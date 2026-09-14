"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import type { LlocTriat, Suggeriment } from "@/lib/llocs";

/**
 * El recuadro de la dirección, con la lista de Google debajo.
 *
 * Para qué: una dirección tecleada hay que adivinarla después, y ahí es
 * donde se torcía —Google no encontraba el número y contestaba el centro del
 * pueblo—. Eligiéndola de la lista se guarda el portal de Google con su
 * identificador, y ya no hay nada que interpretar el día del reparto.
 *
 * Se puede seguir escribiendo a mano y no elegir nada: la lista es una
 * ayuda, no una barrera. Quien escribe de memoria una dirección que se sabe
 * no tiene por qué esperar a que Google conteste — lo que pase entonces es
 * lo de siempre: se busca al calcular la ruta.
 *
 * La búsqueda va por `/api/llocs`, no directa a Google: la clave se queda en
 * el servidor. Ver el comentario de aquel archivo.
 */

export default function CampAdreca({
  id,
  value,
  onChange,
  onTriar,
  autoFocus,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (valor: string) => void;
  /** Una dirección elegida de la lista: llega entera, con coordenadas. */
  onTriar: (lloc: LlocTriat) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [suggeriments, setSuggeriments] = useState<Suggeriment[]>([]);
  const [obert, setObert] = useState(false);
  const [carregant, setCarregant] = useState(false);
  const [avis, setAvis] = useState<string | null>(null);
  const llistaId = useId();

  /*
    El token de sesión de Google.

    Une todo lo que se teclea con la dirección que se acaba eligiendo, y
    hace que Google lo cobre como UNA búsqueda en vez de una llamada por
    letra. Se renueva en cuanto se elige algo: a partir de ahí, otra
    búsqueda.
  */
  const token = useRef(crearToken());

  /** Lo que se ha escrito desde la última vez que se eligió de la lista. */
  const teclejat = useRef(false);

  /*
    Si el buscador está apagado del todo.

    Pasa cuando la Places API no está activada en el proyecto de Google. No
    es un error de quien escribe y no se va a arreglar mientras rellena la
    comanda, así que se avisa UNA vez y el campo se queda como una caja de
    texto normal. Repetirle el mismo aviso cada tres letras es ruido.
  */
  const apagat = useRef(false);

  useEffect(() => {
    // Con menos de tres letras no se pregunta nada: cada llamada se paga y
    // "ca" no distingue nada. La lista que hubiera se vacía al buscar.
    if (apagat.current || !teclejat.current || value.trim().length < 3) return;

    /*
      Medio segundo de espera antes de preguntar.

      Cada llamada se paga y cada tecla dispararía una: se espera a que quien
      escribe pare. Y si mientras tanto sigue escribiendo, la anterior se
      cancela — sin eso, la respuesta de "carrer ca" podía llegar después de
      la de "carrer cabreres" y pisar la lista buena.
    */
    const aturar = new AbortController();
    const espera = setTimeout(async () => {
      setCarregant(true);
      try {
        const resposta = await fetch(
          `/api/llocs?q=${encodeURIComponent(value)}&token=${token.current}`,
          { signal: aturar.signal },
        );
        const cos = (await resposta.json()) as {
          suggeriments?: Suggeriment[];
          error?: string;
          desactivat?: boolean;
        };
        if (!resposta.ok) {
          if (cos.desactivat) apagat.current = true;
          setAvis(cos.error ?? "El cercador d'adreces no respon");
          setSuggeriments([]);
        } else {
          setAvis(null);
          setSuggeriments(cos.suggeriments ?? []);
          setObert(true);
        }
      } catch (error) {
        // Abortada al seguir escribiendo: no es un fallo, es la siguiente.
        if ((error as Error)?.name !== "AbortError") {
          setAvis("Sense connexió no es poden buscar adreces");
        }
      } finally {
        setCarregant(false);
      }
    }, 500);

    return () => {
      clearTimeout(espera);
      aturar.abort();
    };
  }, [value]);

  const triar = async (suggeriment: Suggeriment) => {
    setObert(false);
    teclejat.current = false;
    // Lo que se ve, ya: pedir el detalle tarda y dejar el recuadro con lo
    // medio escrito mientras tanto parece que no ha pasado nada.
    onChange(suggeriment.principal);
    setCarregant(true);
    try {
      const resposta = await fetch(
        `/api/llocs?placeId=${encodeURIComponent(suggeriment.placeId)}&token=${token.current}`,
      );
      const cos = (await resposta.json()) as { lloc?: LlocTriat; error?: string };
      if (resposta.ok && cos.lloc) {
        onTriar(cos.lloc);
        setAvis(null);
      } else {
        setAvis(cos.error ?? "No s'ha pogut llegir l'adreça");
      }
    } catch {
      setAvis("Sense connexió no es poden buscar adreces");
    } finally {
      setCarregant(false);
      // Elegida una: la siguiente búsqueda es otra sesión para Google.
      token.current = crearToken();
      setSuggeriments([]);
    }
  };

  return (
    <div className="relative">
      <input
        id={id}
        value={value}
        onChange={(e) => {
          teclejat.current = true;
          onChange(e.target.value);
        }}
        onFocus={() => suggeriments.length > 0 && setObert(true)}
        /* Un respiro antes de cerrar: sin él, el `blur` del recuadro mata la
           lista antes de que llegue el clic en la opción. */
        onBlur={() => setTimeout(() => setObert(false), 150)}
        autoFocus={autoFocus}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={obert}
        aria-controls={llistaId}
        className="mt-1.5 w-full rounded-xl bg-muted px-3 py-2.5 text-base outline-none placeholder:text-tertiary-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      />

      {obert && suggeriments.length > 0 && (
        <ul
          id={llistaId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-popover shadow-lg"
        >
          {suggeriments.map((suggeriment) => (
            <li key={suggeriment.placeId}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                /* `onMouseDown` y no `onClick`: el clic llega después del
                   `blur`, y para entonces la lista ya no está. */
                onMouseDown={(e) => {
                  e.preventDefault();
                  void triar(suggeriment);
                }}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors active:bg-muted"
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{suggeriment.principal}</span>
                  {suggeriment.secundari && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {suggeriment.secundari}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {carregant && (
        <p className="mt-1 text-xs text-tertiary-foreground">Buscant adreces…</p>
      )}
      {avis && <p className="mt-1 text-xs text-warning-foreground">{avis}</p>}
    </div>
  );
}

/**
 * Un identificador para la sesión de búsqueda de Google.
 *
 * `randomUUID` no está en todos los navegadores por HTTP —solo en contextos
 * seguros—, y esto se abre a veces desde la red local en pruebas. El
 * respaldo no tiene que ser criptográfico: solo tiene que ser distinto cada
 * vez para que Google no junte dos búsquedas que no tienen que ver.
 */
function crearToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
