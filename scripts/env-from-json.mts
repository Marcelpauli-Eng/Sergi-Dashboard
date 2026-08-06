/**
 * Convierte el JSON de la cuenta de servicio en las líneas de .env.local.
 *
 *   npm run env:json -- ~/Downloads/tu-proyecto-a1b2c3.json
 *   npm run env:json -- ~/Downloads/tu-proyecto-a1b2c3.json --write
 *
 * Sin `--write` imprime las líneas para pegarlas a mano. Con `--write` las
 * escribe directamente en .env.local, que además evita que la clave privada
 * pase por el portapapeles y se quede en el historial de la terminal.
 *
 * Existe para evitar el fallo más habitual de la puesta en marcha: pegar la
 * clave privada con saltos de línea reales en vez de con "\n" literales.
 * Google devuelve entonces un `invalid_grant` que no explica nada.
 */

import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const write = args.includes("--write");
const path = args.find((arg) => !arg.startsWith("--"));

if (!path) {
  console.error(
    "\nFalta la ruta del JSON.\n\n" +
      "  npm run env:json -- ~/Downloads/tu-proyecto-a1b2c3.json\n" +
      "  npm run env:json -- ~/Downloads/tu-proyecto-a1b2c3.json --write\n",
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

const ENV_FILE = ".env.local";

/**
 * Sustituye el valor de una variable si ya está en el archivo, y la añade al
 * final si no. Se respeta el resto del contenido: comentarios, orden y
 * variables que el script no toca.
 */
function upsert(contents: string, name: string, value: string): string {
  const line = `${name}="${value}"`;
  // Solo cuenta como definición la que abre línea: así un `# GOOGLE_...`
  // comentado se queda como está y la variable se añade de verdad.
  const existing = new RegExp(`^${name}=.*$`, "m");
  if (existing.test(contents)) return contents.replace(existing, line);

  const base = contents.replace(/\n*$/, "");
  return base === "" ? `${line}\n` : `${base}\n${line}\n`;
}

if (!write) {
  console.log(`
Pega estas líneas en tu ${ENV_FILE}:

──────────────────────────────────────────────────────────────────────────
GOOGLE_SERVICE_ACCOUNT_EMAIL="${parsed.client_email}"
GOOGLE_PRIVATE_KEY="${oneLineKey}"
SESSION_SECRET="${randomBytes(32).toString("base64")}"
──────────────────────────────────────────────────────────────────────────

O deja que lo haga el script, sin pasar la clave por el portapapeles:

    npm run env:json -- ${path} --write

Y comparte tu Google Sheet, con permiso de EDITOR, con:

    ${parsed.client_email}

(Google dirá que no puede notificar a esa dirección: es normal, es un robot.)

Te faltan aún GOOGLE_SHEET_ID, GOOGLE_MAPS_API_KEY, DEPOT_ADDRESS y DRIVERS.
Cuando los tengas:  npm run check
`);
  process.exit(0);
}

// ── Modo --write ──────────────────────────────────────────────────────────

let contents = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
const isNew = contents === "";

contents = upsert(contents, "GOOGLE_SERVICE_ACCOUNT_EMAIL", parsed.client_email);
contents = upsert(contents, "GOOGLE_PRIVATE_KEY", oneLineKey);

// El secreto de sesión solo se genera si no había uno: regenerarlo echaría
// de la app a todos los transportistas que tuvieran la sesión abierta.
const hadSecret = /^SESSION_SECRET=.+$/m.test(contents);
if (!hadSecret) {
  contents = upsert(contents, "SESSION_SECRET", randomBytes(32).toString("base64"));
}

// 0600: el archivo lleva una clave privada, no tiene por qué leerlo nadie más.
// El `mode` de writeFileSync solo se aplica al crear, así que sobre un
// archivo que ya existía hay que forzarlo aparte.
writeFileSync(ENV_FILE, contents, { mode: 0o600 });
chmodSync(ENV_FILE, 0o600);

console.log(`
✓ ${isNew ? `${ENV_FILE} creado` : `${ENV_FILE} actualizado`}

  GOOGLE_SERVICE_ACCOUNT_EMAIL   escrito
  GOOGLE_PRIVATE_KEY             escrito
  SESSION_SECRET                 ${hadSecret ? "ya existía, se deja como estaba" : "generado"}

Ahora comparte tu Google Sheet, con permiso de EDITOR, con:

    ${parsed.client_email}

(Google dirá que no puede notificar a esa dirección: es normal, es un robot.)

Te faltan aún GOOGLE_SHEET_ID, GOOGLE_MAPS_API_KEY, DEPOT_ADDRESS y DRIVERS.
Cuando los tengas:  npm run check
`);
