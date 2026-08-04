/**
 * Convierte el JSON de la cuenta de servicio en las líneas de .env.local.
 *
 *   npm run env:json -- ~/Downloads/tu-proyecto-a1b2c3.json
 *
 * Existe para evitar el fallo más habitual de la puesta en marcha: pegar la
 * clave privada con saltos de línea reales en vez de con "\n" literales.
 * Google devuelve entonces un `invalid_grant` que no explica nada.
 */

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const path = process.argv[2];

if (!path) {
  console.error(
    "\nFalta la ruta del JSON.\n\n" +
      "  npm run env:json -- ~/Downloads/tu-proyecto-a1b2c3.json\n",
  );
  process.exit(1);
}

let parsed: { client_email?: string; private_key?: string; type?: string };
try {
  parsed = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  console.error(
    `\nNo se ha podido leer "${path}": ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exit(1);
}

if (parsed.type !== "service_account" || !parsed.client_email || !parsed.private_key) {
  console.error(
    "\nEse archivo no es la clave de una cuenta de servicio.\n\n" +
      'Debe contener "type": "service_account", "client_email" y "private_key".\n' +
      "Es el JSON que se descarga en:\n" +
      "  Cuenta de servicio → pestaña Claves → Agregar clave → Crear clave nueva → JSON\n",
  );
  process.exit(1);
}

// Los saltos de línea reales pasan a "\n" literales, que es lo que espera
// un archivo .env.
const oneLineKey = parsed.private_key.replace(/\n/g, "\\n");

console.log(`
Pega estas líneas en tu .env.local:

──────────────────────────────────────────────────────────────────────────
GOOGLE_SERVICE_ACCOUNT_EMAIL="${parsed.client_email}"
GOOGLE_PRIVATE_KEY="${oneLineKey}"
SESSION_SECRET="${randomBytes(32).toString("base64")}"
──────────────────────────────────────────────────────────────────────────

Y comparte tu Google Sheet, con permiso de EDITOR, con:

    ${parsed.client_email}

(Google dirá que no puede notificar a esa dirección: es normal, es un robot.)

Te faltan aún GOOGLE_SHEET_ID, GOOGLE_MAPS_API_KEY, DEPOT_ADDRESS y DRIVERS.
Cuando los tengas:  npm run check
`);
