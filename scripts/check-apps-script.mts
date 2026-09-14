/**
 * Comprobación del script que vive dentro del Google Sheet.
 *
 *   npm run check:apps-script
 *
 * Por qué hace falta: el Apps Script no puede importar nada del repositorio
 * —vive dentro del documento—, así que hay trozos copiados de `lib/`. Dos
 * copias de lo mismo se separan solas: se toca una, la otra se queda atrás,
 * y nadie lo ve hasta que la oficina pega un enlace y la fila se va a la
 * otra punta del mundo.
 *
 * Esto lee los `.gs` de verdad, los ejecuta, y les pasa los mismos casos que
 * a la versión de la app. Si alguien toca una sin la otra, falla aquí.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  adrecaSenseCoordenades as adrecaApp,
  esEnllacCurt as curtApp,
  puntDe as puntApp,
} from "../lib/coordenades.ts";

const arrel = join(dirname(fileURLToPath(import.meta.url)), "..");

/*
  Los `.gs` son JavaScript de toda la vida: se leen y se ejecutan tal cual,
  sin nada de Apps Script alrededor. Las funciones que se prueban aquí no
  tocan la hoja —solo leen texto y devuelven números—, que es justo por lo
  que están en su propio archivo.
*/
const codi = readFileSync(join(arrel, "apps-script/Coordenades.gs"), "utf8");
const carregar = new Function(
  `${codi}\nreturn { puntDe, esEnllacCurt, adrecaSenseCoordenades };`,
) as () => {
  puntDe: (text: string) => { lat: number; lng: number } | null;
  esEnllacCurt: (text: string) => boolean;
  adrecaSenseCoordenades: (text: string) => string;
};

const gs = carregar();

/**
 * Los casos, los mismos para las dos.
 *
 * Los que llevan "full real" están copiados de la columna de direcciones de
 * "Copia de Transports Winkaplast", que es donde se vio que la oficina ya
 * pegaba coordenadas a mano sin tener dónde ponerlas.
 */
const CASOS = [
  "41.5719, 1.7834",
  "Cami Llibertat, 6 Coordenadas de Google Maps 41.57193321297131,1.7834358885399193",
  'Restaurant la Cassoleta Poligono, 10 parcela, 11 Coordenadas Google Maps (41°10\'37.2"N 1°00\'43.9"E)',
  "https://www.google.com/maps/place/Carrer+Cabreres,+2/@41.9280000,2.2500000,17z/data=!3m1!4b1!4m6!3m5!1s0x12a5:0xabc!8m2!3d41.9301234!4d2.2545678",
  "https://www.google.com/maps/@41.57,1.78,17z",
  "https://maps.google.com/?q=41.3874,2.1686",
  "https://maps.app.goo.gl/aBcDeF",
  // Y lo que NO es un punto, que es lo que más importa que coincida.
  "Poligono 3 parcela 146 camí a la venta Nova",
  "Carrer Sicilia, 173 2º 1ª",
  "Av. Catalunya, 20 - 9D",
  "150 x 80 x 220 cm",
  "Carrer de Miquel Palomares, 10",
  "120.5, 200.7",
  "0.0, 0.0",
  "",
];

for (const cas of CASOS) {
  const resum = cas.length > 48 ? `${cas.slice(0, 45)}…` : cas || "(buit)";

  assert.deepEqual(
    gs.puntDe(cas),
    puntApp(cas),
    `el punt no coincideix entre el .gs i lib/coordenades.ts: ${resum}`,
  );
  assert.equal(
    gs.esEnllacCurt(cas),
    curtApp(cas),
    `l'enllaç curt no coincideix: ${resum}`,
  );
  assert.equal(
    gs.adrecaSenseCoordenades(cas),
    adrecaApp(cas),
    `l'adreça neta no coincideix: ${resum}`,
  );
}

/* ── Y que el .gs hace lo que tiene que hacer, no solo lo mismo ──────────── */

const delSitio = gs.puntDe(CASOS[3])!;
assert.ok(
  Math.abs(delSitio.lat - 41.9301234) < 0.0002,
  "d'un enllaç s'ha d'agafar el punt del LLOC, no on estava centrat el mapa",
);
assert.equal(
  gs.puntDe("Poligono 3 parcela 146 camí a la venta Nova"),
  null,
  "una adreça normal no pot semblar un punt",
);

/* ── Y que el panel no tenga la sintaxis rota ────────────────────────────── */
/*
  El HTML del panel no lo compila nadie: si le falta una llave, Apps Script
  no dice nada y el panel sale EN BLANCO, sin error, sin pista. Esto lo lee,
  saca el javascript de dentro y comprueba que al menos se puede parsear.
*/
{
  const html = readFileSync(join(arrel, "apps-script/Barra.html"), "utf8");
  const dins = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(dins, "el panell ha de portar el seu <script>");

  assert.doesNotThrow(
    () => new Function(dins![1]),
    "el javascript del panell no es pot ni parsejar: sortiria en blanc",
  );

  // Y que estén las piezas que el .gs llama por su nombre.
  for (const funcio of ["filaActual", "buscarAdreces", "desarAdreca", "desarPunt"]) {
    assert.ok(
      dins![1].includes("." + funcio + "("),
      `el panell ha de cridar ${funcio}, que és al .gs`,
    );
  }
}

console.log(
  `✓ apps-script/Coordenades.gs — ${CASOS.length} casos, igual que lib/coordenades.ts`,
);
