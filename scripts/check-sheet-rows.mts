/**
 * Comprobación de cómo se leen las filas de la hoja.
 *
 *   npm run check:rows
 *
 * La regla es una y no tiene excepciones: cada fila de la hoja es una
 * entrega. Una comanda grande no cabe en un viaje, así que el transportista
 * va varias veces y la oficina apunta cada viaje en su fila con el mismo
 * número. Cada viaje tiene su día, su hora y lo que se cobra por hacerlo.
 *
 * Antes no era así y por eso está esto: las filas repetidas sin dirección se
 * juntaban en una parada sola, y las demás no salían por ningún lado —la
 * oficina las veía en su hoja y el transportista no, así que ni se repartían
 * ni se cobraban—.
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

// Una fila que solo trae las medidas también es una entrega. Es lo que más
// escribe la oficina —lo que no cabe en un viaje, apuntado debajo— y antes se
// juntaba con la primera: la parada salía una vez y los otros viajes no
// salían por ningún lado.
{
  const { orders } = construirComandes([
    CABECERA,
    fila("C1", "CLIENT", "Carrer Gran 1", "1 caixa"),
    fila("C1", "", "", "2 caixes"),
    fila("C1", "", "", "3 caixes"),
  ]);

  assert.equal(orders.length, 3, "tres files, tres entregues");
  assert.deepEqual(
    orders.map((o) => o.id),
    ["C1", "C1#2", "C1#3"],
  );
  // Cada una con lo suyo: las medidas de su fila, no las de todas juntas.
  assert.deepEqual(
    orders.map((o) => o.measures),
    ["1 caixa", "2 caixes", "3 caixes"],
  );
  // Y cada una se escribe en SU fila: marcar una entregada no toca las otras.
  assert.deepEqual(
    orders.map((o) => o.rowNumbers),
    [[2], [3], [4]],
  );
}

// Una parte creada desde la app: solo el número, porque la dirección llega
// después. Sale igual.
{
  const { orders } = construirComandes([
    CABECERA,
    fila("748", "CASA A", "Carrer Gran 1", "1 caixa"),
    fila("748"),
  ]);

  assert.equal(orders.length, 2, "la part creada des de l'app ha de sortir");
  assert.equal(orders[1].id, "748#2");
  assert.equal(orders[1].codi, "748");
  assert.equal(orders[1].address, "", "encara no té adreça, i entra igual");
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

// ── Coordenadas cacheadas: valen mientras la dirección sea la misma ──────
//
// Las coordenadas mandan sobre el texto al navegar. Si alguien corrige el
// portal y se quedan las viejas, el transportista va al sitio de antes sin
// que nada lo avise, así que al leer se comparan con la dirección de la que
// salieron y se tiran cuando ya no coinciden.
{
  const CAP = ["Nº Comanda", "Client", "Adreça", "Població", "_lat", "_lng", "_geo"];
  const geo = (adreca: string, poble: string, lat: string, lng: string, geoAdreca: string) =>
    ["748", "CASA", adreca, poble, lat, lng, geoAdreca];

  // La misma dirección: las coordenadas se quedan.
  {
    const { orders } = construirComandes([
      CAP,
      geo("Carrer Cabrerés, 2", "08500 Vic", "41.93", "2.25", "Carrer Cabrerés, 2, 08500 Vic"),
    ]);
    assert.equal(orders[0].lat, 41.93);
    assert.equal(orders[0].lng, 2.25);
  }

  // Escrita de otra forma —acentos, mayúsculas, espacios— sigue siendo la
  // misma: volver a geocodificar por eso es pagar por acabar en el mismo
  // sitio.
  {
    const { orders } = construirComandes([
      CAP,
      geo("CARRER CABRERES, 2", "08500 VIC", "41.93", "2.25", "Carrer Cabrerés, 2, 08500 Vic"),
    ]);
    assert.equal(orders[0].lat, 41.93, "un acento no mueve el portal");
  }

  // Cambia el número del portal: caducadas.
  {
    const { orders } = construirComandes([
      CAP,
      geo("Carrer Cabrerés, 8", "08500 Vic", "41.93", "2.25", "Carrer Cabrerés, 2, 08500 Vic"),
    ]);
    assert.equal(orders[0].lat, null, "la dirección ha cambiado: las coordenadas no valen");
    assert.equal(orders[0].lng, null);
  }

  // Cambia solo la población, que es la mitad que desambigua el pueblo.
  {
    const { orders } = construirComandes([
      CAP,
      geo("Carrer Cabrerés, 2", "08240 Manresa", "41.93", "2.25", "Carrer Cabrerés, 2, 08500 Vic"),
    ]);
    assert.equal(orders[0].lat, null, "otro pueblo es otro sitio");
  }

  // Filas de antes de la columna: sin dirección apuntada, sus coordenadas se
  // respetan. Nadie ha tocado nada y no hay con qué comparar.
  {
    const { orders } = construirComandes([
      ["Nº Comanda", "Client", "Adreça", "Població", "_lat", "_lng"],
      ["748", "CASA", "Carrer Cabrerés, 2", "08500 Vic", "41.93", "2.25"],
    ]);
    assert.equal(orders[0].lat, 41.93);
    assert.equal(orders[0].geoAddress, null);
  }

  // La dirección apuntada sin coordenadas es "ya se preguntó y Google no la
  // conoce": queda a la vista para que no se vuelva a preguntar.
  {
    const { orders } = construirComandes([
      CAP,
      geo("Carrer Inventat, 99", "08500 Vic", "", "", "Carrer Inventat, 99, 08500 Vic"),
    ]);
    assert.equal(orders[0].lat, null);
    assert.equal(orders[0].geoAddress, "Carrer Inventat, 99, 08500 Vic");
  }
}

console.log("✓ lib/sheet-rows.ts — cada fila del full és una entrega");
