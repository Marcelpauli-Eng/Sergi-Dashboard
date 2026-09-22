/**
 * Elegir la dirección de una lista de Google en vez de escribirla a mano.
 *
 * El problema que resuelve: una dirección tecleada es texto, y el texto hay
 * que adivinarlo después —"Ctra. de Vic 12" puede ser cuatro sitios—. Si
 * quien la pone la ELIGE de la lista de Google, lo que se guarda no es una
 * cadena que haya que interpretar: es el portal, con su identificador. Ahí
 * ya no hay nada que pueda salir mal más tarde.
 *
 * Aquí solo vive lo que no habla con nadie: montar la pregunta y leer la
 * respuesta. Las llamadas a Google las hace `app/api/llocs/route.ts`, que
 * es quien tiene la clave — la clave NO baja al navegador.
 *
 * Se comprueba sin red en `scripts/check-llocs.mts`.
 */

/** Una opción de la lista mientras se escribe. */
export interface Suggeriment {
  placeId: string;
  /** Lo gordo: "Carrer Cabrerés, 2". */
  principal: string;
  /** Lo de debajo, más flojo: "08500 Vic, Barcelona, Espanya". */
  secundari: string;
}

/** Una dirección ya elegida, con todo lo que hace falta para guardarla. */
export interface LlocTriat {
  placeId: string;
  /** Calle y número, tal y como va en la columna de dirección. */
  address: string;
  /** Población con su código postal, como la escribe la oficina. */
  city: string;
  lat: number;
  lng: number;
}

/* ── Lo que se le pregunta a Google ──────────────────────────────────────── */

/**
 * El cuerpo de la búsqueda mientras se teclea.
 *
 * `locationBias` es el pueblo o la central: sin él, escribir "Carrer Major"
 * devuelve los de toda España y la lista no sirve de nada. Es un sesgo, no
 * un filtro: una dirección de fuera de la zona se puede elegir igual.
 */
export function cosAutocomplete(
  input: string,
  aprop: { lat: number; lng: number } | null,
  sessionToken: string,
): Record<string, unknown> {
  const cos: Record<string, unknown> = {
    input,
    languageCode: "ca",
    regionCode: "ES",
    sessionToken,
    // Solo direcciones y sitios, no pueblos enteros ni provincias: lo que se
    // busca aquí es dónde descargar, y "Vic" a secas no es un sitio donde
    // descargar nada.
    includedRegionCodes: ["es"],
  };
  if (aprop) {
    cos.locationBias = {
      circle: {
        center: { latitude: aprop.lat, longitude: aprop.lng },
        radius: 50_000,
      },
    };
  }
  return cos;
}

/* ── Lo que contesta Google ──────────────────────────────────────────────── */

interface RespostaAutocomplete {
  suggestions?: {
    placePrediction?: {
      placeId?: string;
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
      text?: { text?: string };
    };
  }[];
}

/** Convierte la respuesta de Google en la lista que ve quien escribe. */
export function parseSuggeriments(resposta: unknown): Suggeriment[] {
  const dades = (resposta ?? {}) as RespostaAutocomplete;
  const llista: Suggeriment[] = [];

  for (const suggeriment of dades.suggestions ?? []) {
    const p = suggeriment.placePrediction;
    // Las sugerencias que no son un sitio —Google también devuelve
    // búsquedas sueltas— no llevan placeId y no se pueden guardar.
    if (!p?.placeId) continue;

    const principal = p.structuredFormat?.mainText?.text ?? p.text?.text ?? "";
    if (!principal) continue;

    llista.push({
      placeId: p.placeId,
      principal,
      secundari: p.structuredFormat?.secondaryText?.text ?? "",
    });
  }

  return llista;
}

interface RespostaDetall {
  id?: string;
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  displayName?: { text?: string };
  addressComponents?: { longText?: string; shortText?: string; types?: string[] }[];
}

/** El primer componente de un tipo, si está. */
function tros(detall: RespostaDetall, tipus: string): string | null {
  const trobat = detall.addressComponents?.find((c) => c.types?.includes(tipus));
  return trobat?.longText ?? trobat?.shortText ?? null;
}

/**
 * Reparte lo que contesta Google entre las dos columnas de la hoja.
 *
 * La hoja tiene "Adreça" y "Població" separadas, y así se siguen guardando:
 * meterlo todo junto en una obligaría a la oficina a cambiar cómo trabaja, y
 * de eso no va esto.
 *
 *  - Adreça: calle y número. Un negocio sin número de portal —naves,
 *    polígonos— se guarda con su nombre delante, que es como se encuentra.
 *  - Població: código postal y pueblo, "08500 Vic", como se escribe allí.
 *
 * Si Google no desglosa la dirección (pasa con algunos sitios), se cae a la
 * dirección formateada entera antes que quedarse sin nada.
 */
export function parseDetall(resposta: unknown): LlocTriat | null {
  const detall = (resposta ?? {}) as RespostaDetall;
  const lat = detall.location?.latitude;
  const lng = detall.location?.longitude;
  if (!detall.id || typeof lat !== "number" || typeof lng !== "number") return null;

  const carrer = tros(detall, "route");
  const numero = tros(detall, "street_number");
  const poble = tros(detall, "locality") ?? tros(detall, "postal_town");
  const cp = tros(detall, "postal_code");

  let address = carrer ? (numero ? `${carrer}, ${numero}` : carrer) : "";

  /*
    El nombre del negocio delante, pero solo cuando aporta.

    Google devuelve como `displayName` la calle misma cuando el sitio no es
    un negocio ("Carrer Cabrerés"), y repetirla sería "Carrer Cabrerés,
    Carrer Cabrerés, 2". Solo se antepone cuando es otra cosa: la nave, la
    tienda, la fábrica — que es justo lo que hace falta para encontrarla.
  */
  const nom = detall.displayName?.text ?? "";
  if (nom && carrer && !nom.startsWith(carrer) && !address.includes(nom)) {
    address = address ? `${nom}, ${address}` : nom;
  }

  if (!address) {
    // Sin desglose: la dirección entera, menos el país, que en la hoja no
    // lo escribe nadie.
    address = (detall.formattedAddress ?? "").replace(/,\s*Espanya$|,\s*España$|,\s*Spain$/u, "");
  }

  const city = [cp, poble].filter(Boolean).join(" ");

  return { placeId: detall.id, address, city, lat, lng };
}
