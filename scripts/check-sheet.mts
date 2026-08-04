/**
 * Diagnóstico de la conexión con Google Sheets.
 *
 *   npm run check
 *
 * Comprueba, por orden, cada eslabón de la cadena y se para en el primero
 * que falla explicando qué hacer. Está pensado para el momento de la puesta
 * en marcha, cuando lo único que sabes es que "no funciona".
 *
 * No importa nada de `lib/sheets.ts` porque ese módulo es solo de servidor,
 * pero sí reutiliza el mapeo de columnas real para que lo que aquí se ve sea
 * exactamente lo que la app va a ver.
 */

import { JWT } from "google-auth-library";
import {
  mapHeaders,
  canonicalHeader,
  COLUMNS,
  REQUIRED_COLUMNS,
  MANAGED_COLUMNS,
  type ColumnKey,
} from "../lib/sheet-schema.ts";
import { parseSheetDate } from "../lib/dates.ts";

const ok = (msg: string) => console.log(`\x1b[32m✓\x1b[0m ${msg}`);
const bad = (msg: string) => console.log(`\x1b[31m✗\x1b[0m ${msg}`);
const warn = (msg: string) => console.log(`\x1b[33m!\x1b[0m ${msg}`);
const dim = (msg: string) => console.log(`\x1b[2m  ${msg}\x1b[0m`);

function fail(message: string, hint?: string): never {
  bad(message);
  if (hint) {
    console.log();
    console.log(hint);
  }
  process.exit(1);
}

function columnLetter(index: number): string {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

// ── 1. Variables de entorno ───────────────────────────────────────────────

console.log("\nComprobando la conexión con Google Sheets\n");

const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const rawKey = process.env.GOOGLE_PRIVATE_KEY;
const sheetId = process.env.GOOGLE_SHEET_ID;
const tab = process.env.GOOGLE_SHEET_TAB || "Pedidos";

const missing = [
  ["GOOGLE_SERVICE_ACCOUNT_EMAIL", email],
  ["GOOGLE_PRIVATE_KEY", rawKey],
  ["GOOGLE_SHEET_ID", sheetId],
].filter(([, value]) => !value);

if (missing.length > 0) {
  fail(
    `Faltan variables en .env.local: ${missing.map(([name]) => name).join(", ")}`,
    "Copia .env.example a .env.local y rellénalo.",
  );
}

ok("Variables de entorno presentes");
dim(`cuenta de servicio: ${email}`);

const privateKey = rawKey!.replace(/\\n/g, "\n");
if (!privateKey.includes("BEGIN PRIVATE KEY")) {
  fail(
    "GOOGLE_PRIVATE_KEY no parece una clave privada",
    'Debe empezar por "-----BEGIN PRIVATE KEY-----". Cópiala del campo\n' +
      '"private_key" del JSON de la cuenta de servicio, entre comillas dobles\n' +
      "y dejando los \\n tal cual aparecen.",
  );
}

// ── 2. Autenticación ──────────────────────────────────────────────────────

const client = new JWT({
  email,
  key: privateKey,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

let token: string;
try {
  const result = await client.getAccessToken();
  if (!result.token) throw new Error("sin token");
  token = result.token;
  ok("Google acepta las credenciales");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // Los dos fallos habituales dan el mismo código pero se arreglan de forma
  // distinta, así que conviene distinguirlos.
  const hint = message.includes("account not found")
    ? `No existe ninguna cuenta de servicio con ese email:\n\n    ${email}\n\n` +
      "Cópialo del campo \"client_email\" del JSON que te descargaste de\n" +
      "Google Cloud, sin espacios ni caracteres de más."
    : message.includes("invalid_grant") || message.includes("Invalid JWT")
      ? "Causa habitual: los saltos de línea de la clave privada.\n" +
        "En .env.local la clave va en UNA sola línea, entre comillas dobles,\n" +
        "con los \\n literales — no con saltos de línea reales."
      : "Revisa GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_PRIVATE_KEY en .env.local.";

  fail(`Google ha rechazado las credenciales: ${message}`, hint);
}

const api = async (path: string) => {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return { status: response.status, body: await response.text() };
};

// ── 3. Acceso al documento ────────────────────────────────────────────────

const meta = await api("?fields=properties.title,sheets.properties.title");

if (meta.status === 403) {
  fail(
    "El documento existe, pero la cuenta de servicio no tiene acceso",
    `Abre el Sheet → botón Compartir → añade este email como EDITOR:\n\n    ${email}\n\n` +
      'Google avisará de que no puede notificar a esa dirección. Es normal:\n es un robot, no una persona.',
  );
}
if (meta.status === 404) {
  fail(
    "No existe ningún documento con ese GOOGLE_SHEET_ID",
    "El ID es el trozo de la URL entre /d/ y /edit:\n" +
      "docs.google.com/spreadsheets/d/ESTO_ES_EL_ID/edit",
  );
}
if (meta.status !== 200) {
  fail(`Google respondió ${meta.status}: ${meta.body.slice(0, 300)}`);
}

const info = JSON.parse(meta.body) as {
  properties: { title: string };
  sheets: { properties: { title: string } }[];
};
const tabs = info.sheets.map((s) => s.properties.title);

ok(`Acceso al documento "${info.properties.title}"`);

// ── 4. La pestaña ─────────────────────────────────────────────────────────

if (!tabs.includes(tab)) {
  fail(
    `El documento no tiene ninguna pestaña llamada "${tab}"`,
    `Pestañas disponibles: ${tabs.map((t) => `"${t}"`).join(", ")}\n\n` +
      "Ajusta GOOGLE_SHEET_TAB en .env.local con el nombre exacto.",
  );
}
ok(`Pestaña "${tab}" encontrada`);

// ── 5. Las columnas ───────────────────────────────────────────────────────

const values = await api(
  `/values/${encodeURIComponent(`${tab}!A1:ZZ`)}` +
    `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
);
if (values.status !== 200) {
  fail(`No se han podido leer los datos: ${values.body.slice(0, 300)}`);
}

const rows = (JSON.parse(values.body).values ?? []) as unknown[][];
if (rows.length === 0) {
  fail(`La pestaña "${tab}" está vacía. La fila 1 debe tener las cabeceras.`);
}

const headerRow = rows[0].map((c) => String(c ?? ""));
const headerMap = mapHeaders(headerRow);

console.log(`\nCabeceras encontradas en la fila 1:`);
dim(headerRow.map((h, i) => `${columnLetter(i)}="${h}"`).join("  "));

console.log(`\nColumnas que la app necesita:`);
let missingRequired = 0;
for (const key of Object.keys(COLUMNS) as ColumnKey[]) {
  const index = headerMap[key];
  const label = canonicalHeader(key).padEnd(16);
  const required = REQUIRED_COLUMNS.includes(key);

  if (index !== undefined) {
    ok(`${label} → columna ${columnLetter(index)}  ("${headerRow[index]}")`);
  } else if (required) {
    bad(`${label} → NO ENCONTRADA  (obligatoria)`);
    missingRequired++;
  } else if (MANAGED_COLUMNS.includes(key)) {
    warn(`${label} → no existe, la app la creará sola`);
  } else {
    warn(`${label} → no existe (opcional, no se mostrará)`);
  }
}

if (missingRequired > 0) {
  console.log();
  fail(
    `Faltan ${missingRequired} columna(s) obligatoria(s)`,
    "O bien las añades al Sheet, o bien añades el nombre que usas tú a la\n" +
      "lista de alias correspondiente en lib/sheet-schema.ts",
  );
}

// ── 6. Datos de muestra ───────────────────────────────────────────────────

const dataRows = rows.slice(1).filter((r) => r.some((c) => String(c ?? "") !== ""));
console.log(`\n${dataRows.length} fila(s) de datos.`);

const cell = (row: unknown[], key: ColumnKey) => {
  const i = headerMap[key];
  return i === undefined ? "" : String(row[i] ?? "");
};

const badDates = dataRows.filter(
  (row) => parseSheetDate(headerMap.date !== undefined ? row[headerMap.date] : null) === null,
);
if (badDates.length > 0) {
  warn(`${badDates.length} fila(s) con fecha ilegible: se ignorarán`);
}

const drivers = new Set(
  dataRows.map((r) => cell(r, "driverId").toLowerCase()).filter(Boolean),
);
if (drivers.size > 0) {
  console.log(`\nTransportistas en la columna "${canonicalHeader("driverId")}":`);
  dim([...drivers].map((d) => `"${d}"`).join(", "));
  dim("Estos códigos deben coincidir con los de DRIVERS en .env.local");
}

if (dataRows.length > 0) {
  const sample = dataRows[0];
  console.log(`\nPrimera fila, tal y como la va a leer la app:`);
  dim(`id:            ${cell(sample, "id")}`);
  dim(`transportista: ${cell(sample, "driverId")}`);
  dim(
    `fecha:         ${parseSheetDate(headerMap.date !== undefined ? sample[headerMap.date] : null) ?? "(ilegible)"}`,
  );
  dim(`dirección:     ${cell(sample, "address")}`);
  dim(`prioridad:     ${cell(sample, "priority") || "(vacía)"}`);
}

console.log(`\n\x1b[32mTodo correcto. La app puede leer tu Google Sheet.\x1b[0m\n`);
