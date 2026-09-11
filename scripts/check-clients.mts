/**
 * Que los clientes vayan y vuelvan del documento sin perder nada.
 *
 *   npm run check:clients
 *
 * Lo que se comprueba aquí es lo que no se ve hasta que sale mal en una
 * factura: un código postal que pierde el cero de delante, un cliente en
 * blanco colándose en el desplegable, o el orden cambiado —que decide a
 * quién se le factura por defecto—.
 */

import assert from "node:assert/strict";
import {
  CABECERA_CLIENTS,
  TAB_CLIENTS,
  clientAFila,
  filaAClient,
  parseClients,
} from "../lib/clients.ts";
import type { ClienteFacturacion } from "../lib/factura.ts";

const CLIENT: ClienteFacturacion = {
  codigo: "35",
  nombre: "SAINT GOBAIN IDAPLAC SL",
  nif: "B62465141",
  direccion: "C/ Albert Einstein, 25",
  cp: "08940",
  poblacion: "Cornellà del Llobregat",
  provincia: "Barcelona",
};

// ── La pestaña y su cabecera ──────────────────────────────────────────────
assert.equal(TAB_CLIENTS, "Clients");
assert.deepEqual(CABECERA_CLIENTS, [
  "Codi",
  "Nom",
  "NIF",
  "Adreça",
  "CP",
  "Població",
  "Província",
]);

// ── Ida y vuelta: lo que entra es lo que sale ─────────────────────────────
{
  const fila = clientAFila(CLIENT);
  assert.equal(fila.length, CABECERA_CLIENTS.length, "la fila no cuadra con la cabecera");

  // Google devuelve el valor sin el apóstrofo, que es solo la marca de
  // "esto es texto". Se quita para leer como leerá la app.
  const comReturnaGoogle = fila.map((v) => v.replace(/^'/, ""));
  assert.deepEqual(filaAClient(comReturnaGoogle), CLIENT, "el cliente no vuelve igual");
}

// ── Todo va como texto ────────────────────────────────────────────────────
{
  const fila = clientAFila(CLIENT);
  for (const [i, valor] of fila.entries()) {
    assert.ok(
      valor.startsWith("'"),
      `la columna "${CABECERA_CLIENTS[i]}" va sin apóstrofo: Sheets se la interpretará`,
    );
  }
  // El caso concreto por el que existe la regla.
  const cp = fila[CABECERA_CLIENTS.indexOf("CP")];
  assert.equal(cp, "'08940", "el CP perdería el cero de delante");
}

// ── Un campo vacío se queda vacío, no con un apóstrofo suelto ─────────────
{
  const fila = clientAFila({ ...CLIENT, nif: "" });
  assert.equal(fila[CABECERA_CLIENTS.indexOf("NIF")], "");
}

// ── Una fila sin nombre no es un cliente ──────────────────────────────────
{
  assert.equal(filaAClient(["35", "", "B1", "", "", "", ""]), null);
  assert.equal(filaAClient([]), null);
}

// ── La lista conserva el orden: el primero es el de por defecto ───────────
{
  const clients = parseClients([
    ["35", "SAINT GOBAIN", "B1", "", "08940", "", ""],
    ["", "", "", "", "", "", ""],
    ["12", "ALTRE CLIENT", "B2", "", "08001", "", ""],
  ]);
  assert.equal(clients.length, 2, "una fila a medias se ha colado en la lista");
  assert.deepEqual(
    clients.map((c) => c.nombre),
    ["SAINT GOBAIN", "ALTRE CLIENT"],
    "el orden ha cambiado: cambiaría a quién se factura por defecto",
  );
}

// ── Números que llegan como números ───────────────────────────────────────
{
  // Si alguien escribe la fila a mano, el código y el CP pueden volver como
  // número. Tienen que leerse igual.
  const client = filaAClient([35, "UN CLIENT", 0, "", 8940, "", ""]);
  assert.equal(client?.codigo, "35");
  assert.equal(client?.cp, "8940");
}

console.log("✓ lib/clients.ts — els clients van i tornen del document sense perdre res");
