/**
 * Comprobación de cómo se leen las filas de la hoja.
 *
 *   npm run check:rows
 *
 * Aquí está lo que la oficina escribe de verdad: comandas de varios bultos
 * repartidas en varias filas, filas sin dirección y —lo que motivó esto—
 * una comanda PARTIDA EN DOS ENTREGAS. Una parte se lleva hoy y la otra
 * cuando llegue, y la oficina apunta cada parte en su fila con el mismo
 * número. Ese caso se descartaba al leer: la oficina veía las dos partes en
 * su hoja y el transportista solo una, así que la segunda ni se repartía ni
 * se cobraba.
 */

import assert from "node:assert/strict";
import { construirComandes } from "../lib/sheet-rows.ts";

const CABECERA = ["Nº Comanda", "Client", "Adreça", "Població", "Mides", "_part"];
const fila = (id: string, client = "", adreca = "", mides = "", part = "") => [
  id,
  client,
  adreca,
  adreca === "" ? "" : "Barcelona",
  mides,
  part,
];

// Una comanda partida en dos entregas: salen las dos.
{
  const { orders, skipped } = construirComandes([
    CABECERA,
    fila("748", "CASA A", "Carrer Gran 1"),
    fila("748", "CASA B", "Avinguda Nova 2"),
    fila("749", "ALTRA", "Carrer Tercer 3"),
  ]);

  assert.equal(orders.length, 3, "las dos partes del 748 tienen que estar");
  assert.equal(skipped.length, 0, "ninguna se descarta");

  const setenta = orders.filter((o) => o.codi === "748");
  assert.equal(setenta.length, 2);
  // El número que se enseña y se factura es el de la hoja: para el cliente
  // es una sola comanda, y las dos partes llevan el mismo.
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
  // Cada una sabe qué parte es y cuántas hay: "part 1 de 2", "part 2 de 2".
  assert.deepEqual(
    setenta.map((o) => `${o.part}/${o.parts}`),
    ["1/2", "2/2"],
  );
  // Una comanda entera no va partida y no dice nada.
  assert.equal(orders.find((o) => o.codi === "749")?.parts, 1);
  assert.equal(orders.find((o) => o.codi === "749")?.part, 1);
  assert.equal(orders.find((o) => o.codi === "749")?.id, "749");
}

// Partida en tres: la tercera también entra, con su clave.
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
  // También la primera dice que son tres, aunque cuando se leyó no se sabía.
  assert.deepEqual(
    orders.map((o) => `${o.part}/${o.parts}`),
    ["1/3", "2/3", "3/3"],
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

// Y en una comanda partida, cada bulto va a SU parte: a la última escrita,
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

// Una parte creada desde la app: solo el número, porque la dirección llega
// después. Sin la marca `_part` se leería como un bulto de la primera y no
// saldría nunca a la bossa, que es lo que pasaba.
{
  const { orders } = construirComandes([
    CABECERA,
    fila("748", "CASA A", "Carrer Gran 1", "1 caixa"),
    fila("748", "", "", "", "2"),
  ]);

  assert.equal(orders.length, 2, "la part creada des de l'app ha de sortir");
  assert.equal(orders[1].id, "748#2");
  assert.equal(orders[1].codi, "748");
  assert.equal(orders[1].address, "", "encara no té adreça, i entra igual");
  assert.equal(orders[0].bultos, 1, "no s'ha comptat com un bulto de la primera");
}

// Y sin marca tampoco se pierde: una fila repetida que no dice ni medidas ni
// cliente no es un bulto —un bulto existe para decir QUÉ paquete es—, así que
// es otra parte. Es el caso de las creadas antes de que hubiera marca.
{
  const { orders } = construirComandes([
    CABECERA,
    fila("748", "CASA A", "Carrer Gran 1", "1 caixa"),
    fila("748"),
  ]);

  assert.equal(orders.length, 2);
  assert.equal(orders[1].id, "748#2");
  assert.equal(orders[0].bultos, 1);
}

// Lo que sí es un bulto lo sigue siendo: trae medidas y nada más.
{
  const { orders } = construirComandes([
    CABECERA,
    fila("748", "CASA A", "Carrer Gran 1", "1 caixa"),
    fila("748", "", "", "2 caixes"),
  ]);

  assert.equal(orders.length, 1, "això és un paquet més, no una altra entrega");
  assert.equal(orders[0].bultos, 2);
}

console.log("✓ lib/sheet-rows.ts — bultos, filas sueltas y comandas partides");
