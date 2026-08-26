/**
 * Comprobación del escritor de PDF.
 *
 *   npm run check:pdf
 *
 * Un PDF mal armado no da un error: da un archivo que un lector abre en
 * blanco o directamente rechaza, y eso no se ve hasta que alguien intenta
 * mandar la factura. Lo que se comprueba aquí es lo que rompe el archivo:
 * que la tabla `xref` apunte al byte exacto donde empieza cada objeto, que
 * el catálogo y el árbol de páginas se citen bien, y que el texto acabe
 * escapado dentro de las cadenas.
 *
 * Deja además el PDF en /tmp/factura-prueba.pdf para poder mirarlo.
 *
 * Aquí no hay canvas, así que los anchos de texto salen de la estimación de
 * reserva: la maqueta es la buena, pero lo alineado a la derecha queda un
 * poco corrido. En el navegador lo mide de verdad.
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { construirPdf } from "../lib/pdf.ts";
import { componerHoja } from "../lib/factura-hoja.ts";
import { DATOS_POR_DEFECTO, calcularTotales, paginar } from "../lib/factura.ts";

const lineas = [
  { comanda: "800194292", importe: 80 },
  { comanda: "800194301", importe: 70 },
  // Con paréntesis y acentos: es lo que rompe una cadena de PDF mal escapada.
  { comanda: "800194(3)02", importe: 65.5 },
];

const totales = calcularTotales(lineas);
const paginas = paginar(lineas);
const hojas = paginas.map((lineasPagina, i) =>
  componerHoja({
    datos: DATOS_POR_DEFECTO,
    cliente: DATOS_POR_DEFECTO.clientes[0],
    numero: "000030",
    lineas: lineasPagina,
    pagina: i + 1,
    paginas: paginas.length,
    fecha: "26/08/2026",
    totales: i === paginas.length - 1 ? totales : null,
  }),
);

const blob = construirPdf(hojas);
const texto = Buffer.from(await blob.arrayBuffer()).toString("latin1");

// ── Es un PDF ────────────────────────────────────────────────────────────
assert.equal(blob.type, "application/pdf");
assert.ok(texto.startsWith("%PDF-1.7\n"), "le falta la cabecera");
assert.ok(texto.endsWith("%%EOF\n"), "le falta el final");

// ── La tabla xref apunta a donde tiene que apuntar ───────────────────────
{
  const inicio = Number(texto.match(/startxref\n(\d+)\n%%EOF\n$/)![1]);
  assert.ok(texto.slice(inicio).startsWith("xref\n"), "startxref no cae en la tabla");

  const filas = texto
    .slice(inicio)
    .split("\n")
    .filter((f) => /^\d{10} \d{5} [nf] $/.test(f));
  // La primera entrada es la del objeto 0, que siempre es libre.
  assert.equal(filas[0].slice(-2, -1), "f");

  for (const [i, fila] of filas.slice(1).entries()) {
    const posicion = Number(fila.slice(0, 10));
    assert.ok(
      texto.slice(posicion).startsWith(`${i + 1} 0 obj`),
      `la xref del objeto ${i + 1} apunta al byte ${posicion}, y allí no empieza`,
    );
  }

  const declarados = Number(texto.match(/xref\n0 (\d+)\n/)![1]);
  assert.equal(declarados, filas.length, "el tamaño declarado no cuadra con las filas");
  assert.equal(
    declarados,
    Number(texto.match(/\/Size (\d+)/)![1]),
    "el /Size del trailer no cuadra con la xref",
  );
}

// ── El catálogo y las páginas se citan bien ──────────────────────────────
{
  const raiz = Number(texto.match(/\/Root (\d+) 0 R/)![1]);
  const catalogo = texto.match(new RegExp(`${raiz} 0 obj\\n(.*)\\nendobj`))![1];
  assert.ok(catalogo.includes("/Type /Catalog"), "la raíz no es un catálogo");

  const arbol = Number(catalogo.match(/\/Pages (\d+) 0 R/)![1]);
  const paginas = texto.match(new RegExp(`${arbol} 0 obj\\n(.*)\\nendobj`))![1];
  assert.ok(paginas.includes("/Type /Pages"));
  assert.equal(Number(paginas.match(/\/Count (\d+)/)![1]), hojas.length);
  assert.equal((paginas.match(/\d+ 0 R/g) ?? []).length, hojas.length);

  // Cada página cita a su padre y trae las dos tipografías.
  for (const pagina of texto.match(/<< \/Type \/Page [^>]*?\/Contents \d+ 0 R >>/g) ?? []) {
    assert.ok(pagina.includes(`/Parent ${arbol} 0 R`));
    assert.ok(pagina.includes("/FR ") && pagina.includes("/FB "));
  }
}

// ── El largo declarado de cada flujo es el real ──────────────────────────
for (const flujo of texto.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) {
  assert.equal(
    flujo[2].length,
    Number(flujo[1]),
    "el /Length de un flujo no coincide con lo que mide",
  );
}

// ── El texto va escapado ─────────────────────────────────────────────────
{
  // El paréntesis del número de comanda tiene que salir con su barra
  // delante; sin escapar, cierra la cadena y el resto de la hoja se pierde.
  assert.ok(
    texto.includes(String.raw`(Pedido numero 800194\(3\)02) Tj`),
    "los paréntesis del texto no se han escapado",
  );
  // Y los acentos, en Latin-1, no en UTF-8: si no, la xref se descuadra.
  assert.ok(texto.includes("(ART\xCDCULO) Tj"), "los acentos no están en Latin-1");
}

// ── Ni un byte por encima de 0xFF ────────────────────────────────────────
{
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(bytes.length, texto.length, "el archivo tiene bytes multibyte");
}

writeFileSync("/tmp/factura-prueba.pdf", Buffer.from(await blob.arrayBuffer()));
console.log(`✓ lib/pdf.ts — ${hojas.length} full, ${blob.size} bytes → /tmp/factura-prueba.pdf`);
