/**
 * El registro privado de importes: qué se lee y qué se escribe.
 *
 * Los importes de cada porte NO van en la hoja de repartos. Esa la comparte
 * la empresa —es su hoja de pedidos— y lo que cobra el transportista por
 * cada entrega no es asunto suyo. Viven en la pestaña "Imports" del mismo
 * documento que las facturas, que solo se comparte con la cuenta de
 * servicio.
 *
 * Aquí está la decisión —qué fila se actualiza y cuál se añade— sin nada de
 * red, para poder comprobarla sin Google: ver `scripts/check-importes.mts`.
 * El transporte está en `lib/sheets.ts`.
 *
 * La clave es el número de comanda, que es único e inmutable. Por eso los
 * importes pueden vivir en otro documento sin depender de números de fila
 * que la oficina mueve cuando quiere.
 */

import { parseImporte } from "./factura.ts";
import { text } from "./sheet-cells.ts";

export const TAB_IMPORTS = "Imports";

export const CABECERA_IMPORTS = ["Comanda", "Import", "Full", "Actualitzat"];

/** Un importe a guardar. `null` borra el que hubiera. */
export interface ImporteEntrada {
  orderId: string;
  price: number | null;
  /** El full del que salió, solo para poder leer la pestaña a ojo. */
  sheetTab: string | null;
}

/** Número con coma decimal, como el resto de importes de la hoja. */
function importeSheet(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
}

/**
 * Un importe leído de una celda.
 *
 * NO vale `parseNumber`: esa se usa también para las coordenadas, donde un
 * "2.156" es 2,156 grados y no 2.156. En dinero pasa al revés — quien
 * escribe "1.234,50" en la hoja quiere mil doscientos treinta y cuatro con
 * cincuenta— así que el punto se interpreta distinto según qué se esté
 * leyendo, y por eso son dos funciones.
 *
 * Una celda que ya viene como número se coge tal cual: Google la devuelve
 * sin formatear y no hay nada que interpretar.
 */
export function parseImporteCelda(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (raw === null || raw === undefined) return null;
  // `parseImporte` distingue "vacío" (null) de "no es un número"
  // (undefined); para una celda las dos cosas son lo mismo: no hay importe.
  return parseImporte(String(raw)) ?? null;
}

/**
 * El importe de cada comanda a partir de las filas de la pestaña.
 *
 * Una fila sin importe se ignora en vez de guardarse como cero: "sin
 * importe" y "cero euros" no son lo mismo a la hora de facturar.
 */
export function parseImportes(filas: unknown[][]): Map<string, number> {
  const importes = new Map<string, number>();
  for (const fila of filas) {
    const comanda = text(fila[0]);
    if (comanda === "") continue;
    const importe = parseImporteCelda(fila[1]);
    if (importe === null) continue;
    importes.set(comanda, importe);
  }
  return importes;
}

export interface PlanImportes {
  /** Filas que ya existen: número de fila en la hoja y contenido nuevo. */
  actualizar: { fila: number; valores: string[] }[];
  /** Filas que no existían y hay que añadir al final. */
  nuevas: string[][];
}

/**
 * Qué escribir para guardar un lote de importes.
 *
 * `comandasExistentes` son los números de comanda de la columna A, en orden
 * y empezando por la fila 2 (la 1 es la cabecera).
 *
 * Actualizar en vez de añadir importa: dos filas para la misma comanda
 * dejarían el importe bueno a suerte de cuál se lea primero, y de ahí sale
 * una factura mal.
 */
export function planImportes(
  entradas: ImporteEntrada[],
  comandasExistentes: string[],
  ahora: string,
): PlanImportes {
  const filaDe = new Map<string, number>();
  comandasExistentes.forEach((comanda, i) => {
    const limpio = text(comanda);
    // +2: la fila 1 es la cabecera y la lista empieza en la 2. Si por lo que
    // sea hubiera dos filas de la misma comanda, manda la primera.
    if (limpio !== "" && !filaDe.has(limpio)) filaDe.set(limpio, i + 2);
  });

  const plan: PlanImportes = { actualizar: [], nuevas: [] };
  /** Dónde ha quedado cada comanda que este mismo lote acaba de añadir. */
  const añadidas = new Map<string, number>();

  for (const entrada of entradas) {
    const valores = [
      entrada.orderId,
      entrada.price === null ? "" : importeSheet(entrada.price),
      entrada.sheetTab ?? "",
      ahora,
    ];

    const existente = filaDe.get(entrada.orderId);
    if (existente !== undefined) {
      plan.actualizar.push({ fila: existente, valores });
      continue;
    }

    // La misma comanda dos veces en el mismo lote: la segunda pisa a la
    // primera en vez de añadir una fila más.
    const reciente = añadidas.get(entrada.orderId);
    if (reciente !== undefined) {
      plan.nuevas[reciente] = valores;
      continue;
    }

    añadidas.set(entrada.orderId, plan.nuevas.length);
    plan.nuevas.push(valores);
  }

  return plan;
}
