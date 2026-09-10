/**
 * Mueve los importes de la hoja de repartos al documento privado.
 *
 *   npm run migrar:imports            (solo copia)
 *   npm run migrar:imports -- --borrar  (copia y vacía la columna original)
 *
 * Hasta ahora el importe de cada porte vivía en la columna "Import" de la
 * hoja de pedidos, que comparte la empresa. Ahora vive en la pestaña
 * "Imports" del documento de facturas, que no comparte con nadie. Este
 * script hace la mudanza de lo que ya hubiera escrito.
 *
 * Por defecto SOLO COPIA. Vaciar la columna de la hoja de la empresa es
 * destructivo y borra un dato que no está en ningún otro sitio hasta que la
 * copia ha ido bien, así que hay que pedirlo aparte y con la copia hecha.
 *
 * No importa `lib/sheets.ts` porque ese módulo es solo de servidor; sí
 * reutiliza el mapeo de columnas real, para leer exactamente lo que lee la
 * app.
 */

import { JWT } from "google-auth-library";
import { mapHeaders } from "../lib/sheet-schema.ts";

const ok = (m: string) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const info = (m: string) => console.log(`  ${m}`);
const warn = (m: string) => console.log(`\x1b[33m!\x1b[0m ${m}`);

function fail(mensaje: string, pista?: string): never {
  console.log(`\x1b[31m✗\x1b[0m ${mensaje}`);
  if (pista) console.log(`\n${pista}`);
  process.exit(1);
}

const borrar = process.argv.includes("--borrar");

const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const sheetId = process.env.GOOGLE_SHEET_ID;

if (!email || !privateKey || !sheetId) {
  fail(
    "Faltan credenciales de Google en el entorno",
    "Ejecuta con:  node --env-file=.env.local scripts/migrar-imports.mts\n" +
      "(es lo que hace `npm run migrar:imports`)",
  );
}

const facturasId = process.env.GOOGLE_SHEET_ID_FACTURAS || sheetId;

if (facturasId === sheetId) {
  warn("GOOGLE_SHEET_ID_FACTURAS no está definida.");
  info("Los importes se copiarían al MISMO documento que comparte la empresa,");
  info("que es justo lo que se quiere evitar. Créate un documento aparte,");
  info("compártelo con la cuenta de servicio y ponlo en .env.local.");
  process.exit(1);
}

const TAB_IMPORTS = "Imports";
const CABECERA = ["Comanda", "Import", "Full", "Actualitzat"];

const client = new JWT({
  email,
  key: privateKey,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const { token } = await client.getAccessToken();
if (!token) fail("Google no ha devuelto un token");

async function api(
  doc: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const respuesta = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${doc}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    },
  );
  const texto = await respuesta.text();
  return {
    status: respuesta.status,
    json: texto ? (JSON.parse(texto) as Record<string, unknown>) : {},
  };
}

const rango = (a1: string, tab: string) => `'${tab.replace(/'/g, "''")}'!${a1}`;
const letra = (i: number) => {
  let l = "";
  let n = i;
  while (n >= 0) {
    l = String.fromCharCode((n % 26) + 65) + l;
    n = Math.floor(n / 26) - 1;
  }
  return l;
};

// ── Qué pestañas hay en la hoja de repartos ──────────────────────────────
const meta = await api(sheetId, "?fields=sheets.properties.title");
if (meta.status !== 200) {
  fail(`No se puede leer el documento de repartos (${meta.status})`);
}
const pestañas = ((meta.json.sheets ?? []) as { properties?: { title?: string } }[])
  .map((s) => s.properties?.title ?? "")
  .filter(Boolean)
  // Ni el registro de facturas ni el de importes son meses de reparto.
  .filter((t) => t !== "Factures" && t !== TAB_IMPORTS);

ok(`${pestañas.length} pestañas en el documento de repartos`);

// ── Recoger los importes de cada pestaña ─────────────────────────────────
interface Encontrado {
  comanda: string;
  importe: string;
  full: string;
  fila: number;
  columna: number;
}

const encontrados: Encontrado[] = [];
/** Celdas que NO son un importe y por eso no se mudan. */
const sospechosas: { full: string; fila: number; comanda: string; visto: string }[] = [];

/** Formatos de celda que significan que ahí no hay dinero. */
const NO_ES_DINERO = new Set(["DATE", "TIME", "DATE_TIME"]);

for (const tab of pestañas) {
  /*
    Se piden el valor y el FORMATO de cada celda, no solo el valor.

    Es lo que distingue un importe de una fecha. En la hoja real había dos
    celdas de la columna "Import" con formato de fecha y un
    "18/08/2026 13:41" dentro; Google las devuelve como el número
    46252,57013888889, y copiarlas habría metido 46.252,57 € en una factura
    sin que nadie viera nada raro por el camino.
  */
  const datos = await api(
    sheetId,
    `?ranges=${encodeURIComponent(rango("A1:ZZ", tab))}&includeGridData=true` +
      `&fields=sheets.data.rowData.values(formattedValue,effectiveValue,effectiveFormat.numberFormat.type)`,
  );
  if (datos.status !== 200) {
    warn(`No se ha podido leer "${tab}" (${datos.status}), se salta`);
    continue;
  }

  interface Celda {
    formattedValue?: string;
    effectiveValue?: { stringValue?: string; numberValue?: number };
    effectiveFormat?: { numberFormat?: { type?: string } };
  }
  const filas = (
    ((datos.json.sheets ?? []) as { data?: { rowData?: { values?: Celda[] }[] }[] }[])[0]
      ?.data?.[0]?.rowData ?? []
  ).map((f) => f.values ?? []);
  if (filas.length < 2) continue;

  const cabecera = filas[0].map((c) => c?.formattedValue ?? "");
  const mapa = mapHeaders(cabecera);
  if (mapa.id === undefined || mapa.price === undefined) continue;

  let enEsta = 0;
  for (let i = 1; i < filas.length; i++) {
    const comanda = (filas[i][mapa.id]?.formattedValue ?? "").trim();
    const celda = filas[i][mapa.price];
    const visto = (celda?.formattedValue ?? "").trim();
    if (comanda === "" || visto === "") continue;

    const formato = celda?.effectiveFormat?.numberFormat?.type ?? "";
    if (NO_ES_DINERO.has(formato)) {
      sospechosas.push({ full: tab, fila: i + 1, comanda, visto });
      continue;
    }

    // El valor crudo si es número (sin separadores de miles ni símbolo de
    // moneda), y si no lo que se ve tal cual.
    const numero = celda?.effectiveValue?.numberValue;
    encontrados.push({
      comanda,
      importe: numero !== undefined ? String(numero).replace(".", ",") : visto,
      full: tab,
      fila: i + 1,
      columna: mapa.price,
    });
    enEsta++;
  }
  if (enEsta > 0) info(`${tab}: ${enEsta} importes`);
}

if (sospechosas.length > 0) {
  console.log();
  warn(`${sospechosas.length} celda(s) de "Import" NO son un importe y se dejan como están:`);
  for (const s of sospechosas.slice(0, 10)) {
    info(`  ${s.full} fila ${s.fila} · ${s.comanda} · "${s.visto}" (formato de fecha)`);
  }
  if (sospechosas.length > 10) info(`  …y ${sospechosas.length - 10} más`);
  info("Repásalas en la hoja: o son un error de tecleo, o esa celda tiene");
  info("puesto formato de fecha y hay que quitárselo antes de volver a pasar.");
}

if (encontrados.length === 0) {
  ok("No hay ningún importe que mover. Nada que hacer.");
  process.exit(0);
}

// La misma comanda no debería estar dos veces, pero si lo está manda la
// última pestaña, que es la más reciente.
const porComanda = new Map<string, Encontrado>();
for (const e of encontrados) porComanda.set(e.comanda, e);
ok(`${porComanda.size} importes a mover`);

// ── Escribirlos en el documento privado ──────────────────────────────────
const metaFacturas = await api(facturasId, "?fields=sheets.properties.title");
if (metaFacturas.status !== 200) {
  fail(
    `No se puede abrir el documento de facturas (${metaFacturas.status})`,
    `Compártelo con ${email} dándole permiso de Editor.`,
  );
}
const tabsFacturas = ((metaFacturas.json.sheets ?? []) as { properties?: { title?: string } }[])
  .map((s) => s.properties?.title ?? "");

if (!tabsFacturas.includes(TAB_IMPORTS)) {
  await api(facturasId, ":batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: TAB_IMPORTS } } }],
    }),
  });
  await api(
    facturasId,
    `/values/${encodeURIComponent(rango("A1:D1", TAB_IMPORTS))}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values: [CABECERA] }) },
  );
  ok(`Creada la pestaña "${TAB_IMPORTS}"`);
}

// Lo que ya esté allí no se pisa: una migración repetida no puede machacar
// un importe corregido desde la app después de la primera pasada.
const yaHay = await api(
  facturasId,
  `/values/${encodeURIComponent(rango("A2:A", TAB_IMPORTS))}`,
);
const existentes = new Set(
  ((yaHay.json.values ?? []) as unknown[][])
    .map((f) => String(f[0] ?? "").trim())
    .filter(Boolean),
);

const ahora = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
const nuevas = [...porComanda.values()]
  .filter((e) => !existentes.has(e.comanda))
  .map((e) => [e.comanda, e.importe, e.full, ahora]);

if (nuevas.length === 0) {
  ok("Todos los importes ya estaban en el documento privado");
} else {
  const escrito = await api(
    facturasId,
    `/values/${encodeURIComponent(rango("A:D", TAB_IMPORTS))}:append` +
      `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: nuevas }) },
  );
  if (escrito.status !== 200) {
    fail(`No se han podido escribir los importes (${escrito.status})`);
  }
  ok(`${nuevas.length} importes copiados al documento privado`);
}

if (existentes.size > 0 && nuevas.length < porComanda.size) {
  info(`${porComanda.size - nuevas.length} ya estaban y no se han tocado`);
}

// ── Y, si se pide, vaciar la columna original ────────────────────────────
if (!borrar) {
  console.log();
  info("La columna \"Import\" de la hoja de repartos NO se ha tocado.");
  info("Comprueba que los importes están bien en el documento privado y,");
  info("cuando lo tengas claro, vacíala con:");
  console.log();
  info("    npm run migrar:imports -- --borrar");
  process.exit(0);
}

// Solo se vacía lo que se ha copiado. Lo sospechoso se queda donde está:
// no se ha guardado en ninguna parte y borrarlo sería perderlo.
const aVaciar = encontrados.map((e) => ({
  range: rango(`${letra(e.columna)}${e.fila}`, e.full),
  values: [[""]],
}));

const vaciado = await api(sheetId, "/values:batchUpdate", {
  method: "POST",
  body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: aVaciar }),
});
if (vaciado.status !== 200) {
  fail(`No se ha podido vaciar la columna original (${vaciado.status})`);
}
ok(`${aVaciar.length} celdas vaciadas en la hoja de repartos`);
info("La empresa ya no ve lo que cobras por cada porte.");
