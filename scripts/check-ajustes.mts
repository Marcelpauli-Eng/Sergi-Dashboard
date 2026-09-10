/**
 * Comprobación de los ajustes de facturación guardados en el móvil.
 *
 *   npm run check:ajustes
 *
 * Lo que se comprueba es la migración: los datos se guardan en el propio
 * dispositivo, así que una versión nueva se encuentra con lo que escribió
 * una vieja. Si la lectura no lo entiende, el transportista abre la app un
 * día y se encuentra los datos de su cliente en blanco — y lo peor es que no
 * se nota hasta que imprime una factura.
 */

import assert from "node:assert/strict";

const CLAVE = "reparto:datos-facturacio";

/** Un localStorage de mentira, que es lo único que le falta a Node. */
const almacen = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => almacen.get(k) ?? null,
    setItem: (k: string, v: string) => void almacen.set(k, v),
  },
};

const { leerDatosFacturacion, guardarDatosFacturacion } = await import(
  "../lib/ajustes-factura.ts"
);
const { DATOS_POR_DEFECTO } = await import("../lib/factura.ts");

// ── Sin nada guardado, los valores de partida ────────────────────────────
{
  almacen.clear();
  const datos = leerDatosFacturacion();
  assert.equal(datos.clientes.length, 1);
  assert.equal(datos.emisor.nombre, DATOS_POR_DEFECTO.emisor.nombre);
  assert.equal(datos.primerNumero, DATOS_POR_DEFECTO.primerNumero);
}

// ── Lo guardado por la versión de UN SOLO cliente ────────────────────────
// Guardaba `cliente` en singular. Tiene que convertirse en una lista de uno
// sin que nadie vuelva a teclear nada.
{
  almacen.clear();
  almacen.set(
    CLAVE,
    JSON.stringify({
      emisor: { ...DATOS_POR_DEFECTO.emisor, nombre: "MI NOMBRE" },
      cliente: {
        nombre: "CLIENTE DE ANTES",
        direccion: "C/ Vieja 1",
        cp: "08001",
        poblacion: "Barcelona",
        provincia: "Barcelona",
        codigo: "35",
        nif: "B00000000",
      },
      articulo: "112",
      primerNumero: 45,
    }),
  );

  const datos = leerDatosFacturacion();
  assert.equal(datos.clientes.length, 1, "el cliente de antes se ha perdido");
  assert.equal(datos.clientes[0].nombre, "CLIENTE DE ANTES");
  assert.equal(datos.clientes[0].codigo, "35");
  assert.equal(datos.emisor.nombre, "MI NOMBRE");
  assert.equal(datos.primerNumero, 45);
}

// ── Lo guardado con varios clientes se lee tal cual ──────────────────────
{
  almacen.clear();
  guardarDatosFacturacion({
    ...DATOS_POR_DEFECTO,
    clientes: [
      { ...DATOS_POR_DEFECTO.clientes[0], nombre: "UNO", codigo: "35" },
      { ...DATOS_POR_DEFECTO.clientes[0], nombre: "DOS", codigo: "77" },
    ],
  });
  const datos = leerDatosFacturacion();
  assert.equal(datos.clientes.length, 2);
  assert.deepEqual(datos.clientes.map((c) => c.nombre), ["UNO", "DOS"]);
}

// ── Un campo nuevo no puede vaciar lo que ya había ───────────────────────
// Se fusiona por bloques con los valores de partida a propósito.
{
  almacen.clear();
  almacen.set(CLAVE, JSON.stringify({ emisor: { nombre: "SOLO EL NOMBRE" } }));
  const datos = leerDatosFacturacion();
  assert.equal(datos.emisor.nombre, "SOLO EL NOMBRE");
  assert.equal(datos.emisor.nif, DATOS_POR_DEFECTO.emisor.nif, "el resto del emisor se ha perdido");
  assert.equal(datos.clientes.length, 1);
  assert.equal(datos.articulo, DATOS_POR_DEFECTO.articulo);
}

// ── Y un JSON roto no puede dejar la pantalla muerta ─────────────────────
{
  almacen.clear();
  almacen.set(CLAVE, "{esto no es json");
  const datos = leerDatosFacturacion();
  assert.equal(datos.clientes.length, 1);
  assert.equal(datos.emisor.nombre, DATOS_POR_DEFECTO.emisor.nombre);
}

console.log("✓ lib/ajustes-factura.ts — los datos guardados sobreviven a la actualización");
