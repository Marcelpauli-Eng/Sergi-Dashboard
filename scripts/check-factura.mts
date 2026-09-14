/**
 * Comprobación de los números de la factura.
 *
 *   npm run check:factura
 *
 * Es un camino de dinero: un céntimo de más o de menos hace que la factura
 * no cuadre con la que emite FactuSOL. Estas cuentas están tomadas de la
 * factura 1-000029, que es el modelo, más los casos de redondeo que fallaban
 * al multiplicar por 100 en binario.
 */

import assert from "node:assert/strict";
import {
  DATOS_POR_DEFECTO,
  calcularTotales,
  clientePara,
  etiquetaComanda,
  euros,
  formatearNumero,
  paginar,
  parseImporte,
  parseImportesFactura,
  LINEAS_POR_PAGINA,
} from "../lib/factura.ts";

const linea = (comanda: string, importe: number) => ({ comanda, importe });

// ── La factura modelo: 2 portes a 80 y 3 a 70 ────────────────────────────
{
  const totales = calcularTotales([
    linea("800194292", 80),
    linea("800194319", 80),
    linea("800195257", 70),
    linea("850013654", 70),
    linea("850013658", 70),
  ]);
  assert.equal(totales.base, 370, "base de la 1-000029");
  assert.equal(totales.iva, 77.7, "IVA de la 1-000029");
  assert.equal(totales.irpf, 3.7, "IRPF de la 1-000029");
  assert.equal(totales.total, 444, "total de la 1-000029");
}

// ── Medio céntimo: donde fallaba el redondeo binario ─────────────────────
{
  // 215,50 × 1% = 2,155 → 2,16. Con `Math.round(x * 100) / 100` salía 2,15.
  const totales = calcularTotales([linea("A", 80), linea("B", 70.5), linea("C", 65)]);
  assert.equal(totales.base, 215.5);
  assert.equal(totales.iva, 45.26, "215,50 × 21% = 45,255 → 45,26");
  assert.equal(totales.irpf, 2.16, "215,50 × 1% = 2,155 → 2,16");
  assert.equal(totales.total, 258.6, "215,50 + 45,26 − 2,16");
}

// ── Sin líneas: todo a cero, y no revienta ───────────────────────────────
{
  const totales = calcularTotales([]);
  assert.deepEqual(totales, { base: 0, iva: 0, irpf: 0, total: 0 });
}

// ── Los céntimos sueltos no se van acumulando ────────────────────────────
{
  const totales = calcularTotales(Array.from({ length: 3 }, (_, i) => linea(`X${i}`, 0.1)));
  assert.equal(totales.base, 0.3, "0,1 + 0,1 + 0,1 = 0,30 y no 0,30000000000000004");
}

// ── Formato español ──────────────────────────────────────────────────────
assert.equal(euros(1234.5), "1.234,50", "es-ES no agrupa 4 cifras; FactuSOL sí");
assert.equal(euros(999.5), "999,50");
assert.equal(euros(1234567.89), "1.234.567,89");
assert.equal(euros(0), "0,00");

// ── Paginación ───────────────────────────────────────────────────────────
{
  assert.equal(paginar([]).length, 1, "sin líneas, una hoja igualmente");
  const muchas = Array.from({ length: LINEAS_POR_PAGINA + 1 }, (_, i) => linea(`P${i}`, 10));
  const hojas = paginar(muchas);
  assert.equal(hojas.length, 2, "una línea de más ya son dos hojas");
  assert.equal(hojas[0].length, LINEAS_POR_PAGINA);
  assert.equal(hojas[1].length, 1);
  assert.equal(
    hojas.flat().length,
    muchas.length,
    "ninguna línea se pierde al paginar: sería facturar de menos",
  );
}

console.log("\x1b[32m✓\x1b[0m Los números de la factura cuadran");

// ── Lo que se teclea en un campo de importe ──────────────────────────────
// El punto es la trampa: en español separa los miles, pero mucha gente lo
// teclea como coma decimal. Confundirlos multiplica el importe por cien y la
// factura sale mal sin que nadie vea nada raro por el camino.
{
  // Vacío es "sin importe", que es válido y no es lo mismo que un error.
  assert.equal(parseImporte(""), null);
  assert.equal(parseImporte("   "), null);

  // Coma decimal, que es como se escribe aquí.
  assert.equal(parseImporte("12,50"), 12.5);
  assert.equal(parseImporte("0,05"), 0.05);

  // Punto decimal: quien lo teclea quiere 12,50 €, no 1.250 €.
  assert.equal(parseImporte("12.50"), 12.5);

  // Con coma, los puntos son miles. Es el ida y vuelta de `euros()`.
  assert.equal(parseImporte("1.234,50"), 1234.5);
  assert.equal(parseImporte(euros(1234.5)), 1234.5);
  assert.equal(parseImporte(euros(80)), 80);

  // Sin coma, grupos de tres cifras también son miles.
  assert.equal(parseImporte("1.234"), 1234);
  assert.equal(parseImporte("12.345.678"), 12345678);

  // Enteros y espacios sueltos.
  assert.equal(parseImporte("80"), 80);
  assert.equal(parseImporte(" 80 "), 80);

  // Se redondea a céntimos: más decimales no significan nada en una factura.
  assert.equal(parseImporte("12,509"), 12.51);

  // Y lo que no es un número se rechaza, que no es lo mismo que valer cero.
  for (const basura of ["abc", "12,5,5", "12.5.5", "-3", "1,2,3", "€10", "12abc"]) {
    assert.equal(parseImporte(basura), undefined, `"${basura}" tendría que rechazarse`);
  }
}

// ── El número de la serie ────────────────────────────────────────────────
// Seis cifras con ceros delante, como lo imprime FactuSOL.
{
  assert.equal(formatearNumero(30), "000030");
  assert.equal(formatearNumero(1), "000001");
  assert.equal(formatearNumero(123456), "123456");
}

// ── A quién se le factura cada comanda ───────────────────────────────────
{
  const dos = {
    ...DATOS_POR_DEFECTO,
    clientes: [
      { ...DATOS_POR_DEFECTO.clientes[0], nombre: "PRIMERO", codigo: "35" },
      { ...DATOS_POR_DEFECTO.clientes[0], nombre: "SEGUNDO", codigo: "77" },
    ],
  };

  // Sin código va al primero: es el caso de hoy, con la columna del full
  // vacía en todas las comandas.
  assert.equal(clientePara(dos, null).nombre, "PRIMERO");
  assert.equal(clientePara(dos, "").nombre, "PRIMERO");

  assert.equal(clientePara(dos, "77").nombre, "SEGUNDO");
  // La celda la rellena una persona: espacios y mayúsculas no pueden mandar
  // la factura al cliente equivocado.
  assert.equal(clientePara(dos, " 77 ").nombre, "SEGUNDO");

  // Un código que no está tampoco puede dejar la factura sin cliente.
  assert.equal(clientePara(dos, "99").nombre, "PRIMERO");
}


// ── Los importes de una factura ya emitida ───────────────────────────────
// Van todos en UNA celda de la hoja, y cada uno lleva su coma decimal. Con
// ", " de separador, partir por comas daba el doble de trozos y cada línea
// cogía el del vecino: la factura 30 de la hoja real —"1000,00, 1,00,
// 2000,00, 100,00, 3000,00, 1,00…"— se reimprimía como 1000, 0, 1, 0, 2000.
{
  const legado = "1000,00, 1,00, 2000,00, 100,00, 3000,00";
  assert.deepEqual(
    parseImportesFactura(legado),
    [1000, 1, 2000, 100, 3000],
    "una factura ya emitida se reimprime con otros importes",
  );

  // El formato nuevo, con punto y coma.
  assert.deepEqual(parseImportesFactura("80,00; 70,50; 1.234,50"), [80, 70.5, 1234.5]);

  // Una sola línea, y ninguna.
  assert.deepEqual(parseImportesFactura("80,00"), [80]);
  assert.deepEqual(parseImportesFactura(""), []);

  // Y lo que escribe la app se vuelve a leer igual, que es lo único que
  // tiene que cumplirse siempre.
  const importes = [1000, 1, 2000.5, 100, 3000, 0.05];
  const celda = importes.map((i) => i.toFixed(2).replace(".", ",")).join("; ");
  assert.deepEqual(parseImportesFactura(celda), importes, "la ida y vuelta no cuadra");
}

// Una comanda partida en varios viajes: cada parte va a su línea y se lee
// de dónde sale. Tres líneas "748" con importes distintos no las entiende
// nadie; "748 (1/3)" sí.
{
  assert.equal(etiquetaComanda({ codi: "748", part: 1, parts: 3 }), "748 (1/3)");
  assert.equal(etiquetaComanda({ codi: "748", part: 3, parts: 3 }), "748 (3/3)");
  // La comanda entera se queda como estaba: sin paréntesis que explicar.
  assert.equal(etiquetaComanda({ codi: "749", part: 1, parts: 1 }), "749");
}

console.log("✓ lib/factura.ts — totales, páginas, importes y clientes");
