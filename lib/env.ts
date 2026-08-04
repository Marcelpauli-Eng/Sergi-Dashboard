/**
 * Configuración leída del entorno. Se valida al arrancar para fallar rápido
 * y con un mensaje claro, en vez de con un 500 opaco en producción.
 *
 * Este módulo es solo de servidor: nunca lo importes desde un componente
 * cliente o las credenciales acabarían en el bundle del navegador.
 */

import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Falta la variable de entorno ${name}. Copia .env.example a .env.local y rellénala.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

/**
 * La clave privada del service account llega con "\n" literales cuando se
 * pega en un panel de variables de entorno (Vercel, por ejemplo). Hay que
 * devolverle los saltos de línea reales o la firma JWT falla.
 */
function parsePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, "\n");
}

/**
 * Transportistas dados de alta, en formato `codigo:pin:nombre`.
 * El nombre es opcional. Ejemplo:
 *   DRIVERS="sergi:4821:Sergi Pons,juan:9034"
 *
 * Es deliberadamente simple para el arranque. Si mañana hay que gestionarlos
 * desde el propio Sheet, solo cambia esta función.
 */
function parseDrivers(raw: string): { id: string; pin: string; name: string }[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, pin, name] = entry.split(":").map((part) => part.trim());
      if (!id || !pin) {
        throw new Error(
          `Entrada inválida en DRIVERS: "${entry}". El formato es codigo:pin o codigo:pin:nombre`,
        );
      }
      return {
        id: id.toLowerCase(),
        pin,
        name: name || id.charAt(0).toUpperCase() + id.slice(1),
      };
    });
}

interface Env {
  google: {
    serviceAccountEmail: string;
    privateKey: string;
    sheetId: string;
    /** Nombre de la pestaña con los pedidos. */
    sheetTab: string;
    mapsApiKey: string;
  };
  /** Dirección de la central. Es el punto de partida de todas las rutas. */
  depotAddress: string;
  /** Secreto para firmar la cookie de sesión. Mínimo 32 caracteres. */
  sessionSecret: string;
  drivers: { id: string; pin: string; name: string }[];
  /**
   * Zona horaria del negocio. Determina qué se considera "hoy": si el
   * servidor está en UTC y el transportista abre la app a las 00:30 en
   * España, "hoy" tiene que ser su hoy, no el del servidor.
   */
  timezone: string;
}

/**
 * Un cargador por campo, en lugar de uno que valide todo de golpe.
 *
 * Importa: el login solo necesita SESSION_SECRET y DRIVERS. Si validáramos
 * el bloque entero al primer acceso, no se podría ni entrar en la app hasta
 * tener también las credenciales de Google — justo lo que no tienes durante
 * la puesta en marcha. Así cada parte falla solo cuando de verdad hace falta.
 */
const loaders: { [K in keyof Env]: () => Env[K] } = {
  google: () => ({
    serviceAccountEmail: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    privateKey: parsePrivateKey(required("GOOGLE_PRIVATE_KEY")),
    sheetId: required("GOOGLE_SHEET_ID"),
    sheetTab: optional("GOOGLE_SHEET_TAB", "Pedidos"),
    mapsApiKey: required("GOOGLE_MAPS_API_KEY"),
  }),
  depotAddress: () => required("DEPOT_ADDRESS"),
  sessionSecret: () => required("SESSION_SECRET"),
  drivers: () => parseDrivers(required("DRIVERS")),
  timezone: () => optional("BUSINESS_TIMEZONE", "Europe/Madrid"),
};

const cache = new Map<keyof Env, unknown>();

/**
 * La validación se hace al primer acceso a cada campo, no al importar el
 * módulo: así `next build` funciona en una máquina sin credenciales (CI, un
 * compañero clonando el repo) y el error, si falta algo, aparece en la
 * petición que lo necesita diciendo exactamente qué variable falta.
 */
export const env = new Proxy({} as Env, {
  get(_target, property: keyof Env) {
    if (!cache.has(property)) cache.set(property, loaders[property]());
    return cache.get(property);
  },
});

/**
 * `true` si el error viene de una variable de entorno mal puesta.
 *
 * Permite responder al operador con el mensaje concreto en vez de un 500
 * mudo. No expone secretos: solo dice qué variable falta.
 */
export function isConfigError(error: unknown): error is Error {
  return error instanceof Error && error.message.includes("variable de entorno");
}
