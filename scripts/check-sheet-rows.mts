/**
 * Comprobación de cómo se leen las filas de la hoja.
 *
 *   npm run check:rows
 *
 * Aquí está lo que la oficina escribe de verdad: comandas de varios bultos
 * repartidas en varias filas, filas sin dirección y —lo que motivó esto—
 * el mismo número de comanda usado dos veces para dos entregas distintas.
 * Ese caso se descartaba al leer: la oficina veía las dos en su hoja y el
 * transportista solo una, así que la segunda ni se repartía ni se cobraba.
 */

import assert from "node:assert/strict";
import { construirComandes } from "../lib/sheet-rows.ts";

const CABECERA = ["Nº Comanda", "Client", "Adreça", "Població", "Mides"];
const fila = (id: string, client = "", adreca = "", mides = "") => [
  id,
  client,
  adreca,
  adreca === "" ? "" : "Barcelona",
  mides,
];

// Dos entregas distintas con el mismo número: salen las dos.
{
  const { orders, skipped } = construirComandes([
    CABECERA,
    fila("748", "CASA A", "Carrer Gran 1"),
    fila("748", "CASA B", "Avinguda Nova 2"),
    fila("749", "ALTRA", "Carrer Tercer 3"),
  ]);

  assert.equal(orders.length, 3, "las dos comandas 748 tienen que estar");
  assert.equal(skipped.length, 0, "ninguna se descarta");

  const setenta = orders.filter((o) => o.codi === "748");
  assert.equal(setenta.length, 2);
  // El número que se enseña y se factura es el de la hoja, el mismo en las dos.
  assert.deepEqual(
    setenta.map((o) => o.codi),
    ["748", "748"],
  );
  // La clave con la que trabaja la app NO: si fuera la misma, marcar una
  // entregada marcaría la otra y las dos compartirían importe.
  assert.deepEqual(
    setenta.map((o) => o.id),
    ["748", "748#2"],
  );
  assert.deepEqual(
    setenta.map((o) => o.customer),
    ["CASA A", "CASA B"],
  );
  // Las dos avisan de que el número está repetido.
  assert.deepEqual(
    setenta.map((o) => o.duplicats),
    [2, 2],
  );
  // Y la que no lo está, no avisa de nada.
  assert.equal(orders.find((o) => o.codi === "749")?.duplicats, 1);
  assert.equal(orders.find((o) => o.codi === "749")?.id, "749");
}

// Tres veces el mismo número: la tercera también entra, con su clave.
{
  const { orders } = construirComandes([
    CABECERA,
    fila("748", "A", "Carrer 1"),
    fila("748", "B", "Carrer 2"),
    fila("748", "C", "Carrer 3"),
  ]);

  assert.deepEqual(
    orders.map((o) => o.id),
    ["748", "748#2", "748#3"],
  );
  assert.deepEqual(
    orders.map((o) => o.duplicats),
    [3, 3, 3],
  );
}

// Los bultos siguen siendo bultos: fila sin dirección = un paquete más.
{
  const { orders } = construirComandes([
    CABECERA,
    fila("C1", "CLIENT", "Carrer Gran 1", "1 caixa"),
    fila("C1", "", "", "2 caixes"),
    fila("C1", "", "", "3 caixes"),
  ]);

  assert.equal(orders.length, 1, "un solo sitio al que ir");
  assert.equal(orders[0].bultos, 3);
  assert.equal(orders[0].measures, "1 caixa · 2 caixes · 3 caixes");
  assert.deepEqual(orders[0].rowNumbers, [2, 3, 4]);
}

// Y con un número repetido, cada bulto va a SU entrega: a la última escrita,
// que es detrás de la cual lo apunta la oficina.
{
  const { orders } = construirComandes([
    CABECERA,
    fila("748", "CASA A", "Carrer Gran 1", "1 caixa"),
    fila("748", "", "", "bulto de A"),
    fila("748", "CASA B", "Avinguda Nova 2", "1 caixa"),
    fila("748", "", "", "bulto de B"),
  ]);

  assert.equal(orders.length, 2);
  assert.equal(orders[0].bultos, 2);
  assert.equal(orders[0].measures, "1 caixa · bulto de A");
  assert.equal(orders[1].bultos, 2);
  assert.equal(orders[1].measures, "1 caixa · bulto de B");
}

// Una fila sin número de comanda sigue fuera, y diciendo dónde está.
{
  const { orders, skipped } = construirComandes([
    CABECERA,
    fila("", "SENSE NÚMERO", "Carrer Gran 1"),
    fila("750", "BONA", "Carrer Segon 2"),
  ]);

  assert.equal(orders.length, 1);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].rowNumber, 2);
}

console.log("✓ lib/sheet-rows.ts — bultos, filas sueltas y números repetidos");
