import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { env } from "@/lib/env";
import { cosAutocomplete, parseDetall, parseSuggeriments } from "@/lib/llocs";
import { getDepotCoord } from "@/lib/manifest";
import { isDemoMode } from "@/lib/demo";

/**
 * El buscador de direcciones de Google, desde el servidor.
 *
 * Desde el servidor A PROPÓSITO: la Places API se puede llamar desde el
 * navegador, pero entonces la clave viaja en el HTML y la puede usar
 * cualquiera que abra el inspector —y esa misma clave paga el geocoding y
 * las rutas—. Aquí la clave se queda donde está y el navegador solo ve
 * direcciones.
 *
 * Dos cosas:
 *   GET ?q=carrer cabr   → la lista mientras se escribe.
 *   GET ?placeId=ChIJ…   → la dirección elegida, ya repartida en columnas.
 *
 * El `sessionToken` los une: Google cobra una búsqueda entera —todo lo que
 * se teclea más la elección— en vez de una llamada por letra, si las dos
 * partes llevan el mismo token. Lo pone el navegador, uno por búsqueda.
 */

/** Cabeceras comunes de la Places API (New). */
function capçaleres(fieldMask?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": env.google.mapsApiKey,
  };
  if (fieldMask) h["X-Goog-FieldMask"] = fieldMask;
  return h;
}

/**
 * Qué contestar cuando Google dice que no.
 *
 * El 403 es casi siempre el mismo y es de configuración —la Places API sin
 * activar en el proyecto—, así que se dice con esas palabras en vez de un
 * "error" pelado que no lleva a ningún sitio.
 */
function errorDeGoogle(status: number, cos: string): NextResponse {
  console.error(`Places API respondió ${status}: ${cos.slice(0, 300)}`);
  return NextResponse.json(
    {
      error:
        status === 403
          ? 'El cercador d\'adreces no està activat: cal activar "Places API (New)" al projecte de Google Cloud.'
          : "El cercador d'adreces no respon",
    },
    { status: 502 },
  );
}

export async function GET(request: Request) {
  const driver = await getSession();
  if (!driver) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const placeId = searchParams.get("placeId");
  const q = searchParams.get("q");
  const sessionToken = searchParams.get("token") ?? "";

  if (isDemoMode()) {
    // En demo no hay clave de Google que valga: el campo sigue funcionando
    // como una caja de texto normal y la lista sale vacía.
    return NextResponse.json({ suggeriments: [], lloc: null });
  }

  try {
    if (placeId) {
      const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
      url.searchParams.set("languageCode", "ca");
      if (sessionToken) url.searchParams.set("sessionToken", sessionToken);

      const resposta = await fetch(url, {
        headers: capçaleres("id,formattedAddress,location,addressComponents,displayName"),
        cache: "no-store",
      });
      if (!resposta.ok) return errorDeGoogle(resposta.status, await resposta.text());

      const lloc = parseDetall(await resposta.json());
      if (!lloc) {
        return NextResponse.json({ error: "Adreça sense coordenades" }, { status: 502 });
      }
      return NextResponse.json({ lloc });
    }

    if (!q || q.trim().length < 3) {
      // Con menos de tres letras no hay nada que sugerir, y cada llamada se
      // paga: la lista se queda vacía y ya está.
      return NextResponse.json({ suggeriments: [] });
    }

    /*
      El sesgo: la central.

      Es el sitio del que salen todas las rutas, así que las direcciones que
      se teclean están casi siempre a su alrededor. Si no se puede saber
      —falta la clave, o Google no contesta— se busca sin sesgo, que es peor
      pero funciona.
    */
    const aprop = await getDepotCoord().catch(() => null);

    const resposta = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: capçaleres(),
      body: JSON.stringify(cosAutocomplete(q.trim(), aprop, sessionToken)),
      cache: "no-store",
    });
    if (!resposta.ok) return errorDeGoogle(resposta.status, await resposta.text());

    return NextResponse.json({ suggeriments: parseSuggeriments(await resposta.json()) });
  } catch (error) {
    console.error("Error buscando direcciones:", error);
    return NextResponse.json({ error: "El cercador d'adreces no respon" }, { status: 502 });
  }
}
