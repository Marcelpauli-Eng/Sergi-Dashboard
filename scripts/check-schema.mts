/**
 * Comprobación del mapeo de columnas y de la elección de pestaña.
 *
 *   npm run check:schema
 *
 * Son las dos decisiones que se toman ANTES de leer un solo pedido: de qué
 * pestaña se lee y qué columna es cuál. Si se equivocan, la app no falla:
 * enseña la ruta del mes pasado, o pone la dirección donde va el cliente.
 */

import assert from "node:assert/strict";
import {
  canonicalHeader,
  mapHeaders,
  normalizeHeader,
  REQUIRED_COLUMNS,
  COLUMNS,
} from "../lib/sheet-schema.ts";
import {
  findLatestTabUpTo,
  findMonthTab,
  parseTabMonth,
} from "../lib/sheet-tab.ts";

// ── Normalización de cabeceras ───────────────────────────────────────────
{
  // Todo esto tiene que ser la misma columna.
  const iguales = ["Nº Albarán", "n albaran", "N_ALBARAN", "  Nº  ALBARAN  "];
  const claves = new Set(iguales.map(normalizeHeader));
  assert.equal(claves.size, 1, "cabeceras equivalentes dan claves distintas");

  assert.equal(normalizeHeader("Adreça"), "adreca");
  assert.equal(normalizeHeader("Població"), "poblacio");
  assert.equal(normalizeHeader("Estat de l'entrega"), "estatdelentrega");
}

// ── Ningún alias puede valer para dos columnas ───────────────────────────
// Es el fallo que rompería la hoja en silencio: dos columnas peleándose por
// la misma cabecera, y cuál gana depende del orden del objeto.
{
  const vistos = new Map<string, string>();
  for (const [columna, alias] of Object.entries(COLUMNS)) {
    for (const a of alias) {
      const clave = normalizeHeader(a);
      // "Data entrega" es de `date` y de `deliveredAt` a propósito: es la
      // misma celda, la fecha prevista que se sobrescribe al entregar.
      const permitido = new Set(["date", "deliveredAt"]);
      const previo = vistos.get(clave);
      // Dos alias de la MISMA columna que se normalizan igual ("Nº Comanda"
      // y "N Comanda") solo son redundancia, no un choque.
      if (previo && previo !== columna && !(permitido.has(previo) && permitido.has(columna))) {
        assert.fail(`"${a}" vale para "${previo}" y para "${columna}"`);
      }
      vistos.set(clave, columna);
    }
  }
}

// ── La hoja real de la oficina ───────────────────────────────────────────
{
  const cabecera = [
    "Data", "Nº Comanda", "Client", "Adreça", "Població", "Telèfon",
    "Mides", "Comentaris/Observacions", "Estat de l'entrega", "Import",
  ];
  const mapa = mapHeaders(cabecera);

  assert.equal(mapa.creationDate, 0);
  assert.equal(mapa.id, 1);
  assert.equal(mapa.customer, 2);
  assert.equal(mapa.address, 3);
  assert.equal(mapa.city, 4);
  assert.equal(mapa.phone, 5);
  assert.equal(mapa.measures, 6);
  assert.equal(mapa.notes, 7);
  assert.equal(mapa.status, 8);
  assert.equal(mapa.price, 9);

  for (const obligatoria of REQUIRED_COLUMNS) {
    assert.notEqual(mapa[obligatoria], undefined, `falta la columna ${obligatoria}`);
  }
}

// ── En castellano y con otro orden, lo mismo ─────────────────────────────
{
  const mapa = mapHeaders(["Direccion", "ID Pedido", "Estado", "Importe"]);
  assert.equal(mapa.address, 0);
  assert.equal(mapa.id, 1);
  assert.equal(mapa.status, 2);
  assert.equal(mapa.price, 3);
}

// ── Lo que no está, no está ──────────────────────────────────────────────
{
  const mapa = mapHeaders(["ID", "Direccion"]);
  assert.equal(mapa.phone, undefined);
  assert.equal(mapa.driverId, undefined);
  // Una columna vacía en la cabecera no puede casar con nada.
  assert.equal(mapHeaders(["", "  "]).id, undefined);
}

{
  assert.equal(canonicalHeader("status"), "Estat de l'entrega");
  assert.equal(canonicalHeader("lat"), "_lat");
}

// ── De qué mes es una pestaña ────────────────────────────────────────────
{
  assert.equal(parseTabMonth("Octubre 2024"), "2024-10");
  assert.equal(parseTabMonth("OCT 25"), "2025-10");
  assert.equal(parseTabMonth("Març 2026"), "2026-03");
  assert.equal(parseTabMonth("desembre 26"), "2026-12");
  assert.equal(parseTabMonth("2024-10"), "2024-10");
  assert.equal(parseTabMonth("102024"), "2024-10");
  assert.equal(parseTabMonth("202410"), "2024-10");

  // Sin año no se puede situar: en un documento de dos años es ambiguo.
  assert.equal(parseTabMonth("Octubre"), null);
  // Y lo que no es un mes, no lo es.
  assert.equal(parseTabMonth("Factures"), null);
  assert.equal(parseTabMonth("Resum"), null);
  assert.equal(parseTabMonth("Hoja 21"), null);
}

// ── "marc" no puede resolverse por la abreviatura de otro mes ────────────
{
  assert.equal(parseTabMonth("Marc 2026"), "2026-03");
  assert.equal(parseTabMonth("Maig 2026"), "2026-05");
  assert.equal(parseTabMonth("Juny 2026"), "2026-06");
  assert.equal(parseTabMonth("Juliol 2026"), "2026-07");
}

// ── Elegir la pestaña del mes ────────────────────────────────────────────
{
  const tabs = ["Resum", "JUNY 26", "JUL 26", "Agost 2026", "Factures"];
  assert.equal(findMonthTab(tabs, "2026-08"), "Agost 2026");
  assert.equal(findMonthTab(tabs, "2026-07"), "JUL 26");

  // Un mes que no está no se adivina.
  assert.equal(findMonthTab(tabs, "2026-09"), null);
}

// ── Un mes del año equivocado no vale ────────────────────────────────────
// "Agost 2025" no puede servir para agosto de 2026 por mucho que comparta
// el nombre del mes.
{
  assert.equal(findMonthTab(["Agost 2025"], "2026-08"), null);
}

// ── Con ambigüedad, mejor fallar que acertar por suerte ──────────────────
{
  assert.equal(findMonthTab(["Octubre", "Octubre bis"], "2024-10"), null);
  // Uno solo sin año sí se acepta: no hay con qué confundirlo.
  assert.equal(findMonthTab(["Octubre", "Resum"], "2024-10"), "Octubre");
}

// ── La red de seguridad del día 1 ────────────────────────────────────────
// Si aún no existe la pestaña del mes nuevo, se sigue con la última: más
// vale la hoja de julio sin pedidos de hoy que la app muerta.
{
  const tabs = ["MAI 26", "JUNY 26", "JUL 26"];
  assert.equal(findLatestTabUpTo(tabs, "2026-08"), "JUL 26");
  assert.equal(findLatestTabUpTo(tabs, "2026-06"), "JUNY 26");

  // Nunca una posterior: leer agosto en junio enseñaría pedidos del futuro.
  assert.equal(findLatestTabUpTo(["AGO 26"], "2026-06"), null);
  // Y el orden dentro del documento da igual.
  assert.equal(findLatestTabUpTo(["JUL 26", "MAI 26", "JUNY 26"], "2026-08"), "JUL 26");
  assert.equal(findLatestTabUpTo(["Resum", "Factures"], "2026-08"), null);
}

console.log("✓ lib/sheet-schema.ts + lib/sheet-tab.ts — columnas y pestañas");
