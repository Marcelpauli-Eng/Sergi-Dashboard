/**
 * La factura del mes, a partir de los pedidos entregados.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ESTO ES UN BORRADOR, NO UNA FACTURA EMITIDA.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Sale sin número a propósito. Quien emite —con su numeración correlativa y
 * su registro de facturación— es FactuSOL; esto solo ahorra teclear a mano
 * los números de comanda y los importes de todo el mes. Si algún día la app
 * pasara a emitir de verdad, hay que resolver antes la numeración y lo que
 * exige la ley antifraude, que no es cosa de una tarde.
 *
 * El formato reproduce la plantilla de FactuSOL que ya usa la empresa, para
 * que pasarlo de aquí a allí sea copiar línea por línea sin traducir nada.
 */

/** Porcentaje de IVA repercutido. */
export const IVA = 21;
/** Porcentaje de IRPF retenido. */
export const IRPF = 1;

export interface DatosFacturacion {
  emisor: {
    nombre: string;
    direccion: string;
    cp: string;
    poblacion: string;
    provincia: string;
    nif: string;
    telefono: string;
  };
  cliente: {
    nombre: string;
    direccion: string;
    cp: string;
    poblacion: string;
    provincia: string;
    codigo: string;
    nif: string;
  };
  /** Código de artículo con el que se factura cada porte. */
  articulo: string;
  /**
   * Número con el que arranca la serie cuando todavía no hay ninguna factura
   * emitida desde la app. Tiene que seguir donde lo dejó FactuSOL: la última
   * del modelo era la 000029, así que aquí empieza la 30.
   */
  primerNumero: number;
}

const EMISOR = {
  nombre: "SERGIO MARCIAL ORTIZ",
  direccion: "GRANOLLERS 18",
  cp: "08458",
  poblacion: "SANT PERE DE VILAMAJOR",
  provincia: "BARCELONA",
  nif: "44993210N",
  telefono: "938451529",
} as const;

const CLIENTE = {
  nombre: "SAINT GOBAIN IDAPLAC SL",
  direccion: "C/ Albert Einstein, 25",
  cp: "08940",
  poblacion: "Cornellà del Llobregat",
  provincia: "Barcelona",
  codigo: "35",
  nif: "B62465141",
} as const;

/**
 * Valores de partida, tomados de la factura 1-000029.
 *
 * Son solo el punto de partida: se editan desde Ajustes y se guardan en el
 * móvil. Si el repositorio llega a ser público, conviene vaciar el NIF y el
 * domicilio de aquí y dejar que se rellenen desde la app.
 */
export const DATOS_POR_DEFECTO: DatosFacturacion = {
  emisor: { ...EMISOR },
  cliente: { ...CLIENTE },
  articulo: "112",
  primerNumero: 30,
};

/** El número tal y como se imprime: seis cifras con ceros delante. */
export function formatearNumero(numero: number): string {
  return String(numero).padStart(6, "0");
}

/** Cuántas líneas caben en el recuadro de una hoja antes de pasar a la siguiente. */
export const LINEAS_POR_PAGINA = 24;

export interface LineaFactura {
  /** Nº de comanda, tal cual está en la hoja. */
  comanda: string;
  /** Lo cobrado por esa entrega, sin IVA. */
  importe: number;
}

export interface TotalesFactura {
  base: number;
  iva: number;
  irpf: number;
  total: number;
}

/**
 * Redondeo a dos decimales, que es a lo que se factura.
 *
 * Pasa por notación exponencial en texto en vez de multiplicar por 100. El
 * atajo `Math.round(valor * 100) / 100` falla justo en los medios céntimos:
 * `2.155 * 100` da 215.49999999999997 en binario y redondea a 2,15 cuando
 * toca 2,16. Un céntimo de diferencia con FactuSOL en cada factura.
 */
function céntimos(valor: number): number {
  return Number(`${Math.round(Number(`${valor}e2`))}e-2`);
}

/**
 * Base, impuestos y total.
 *
 * Cada importe se redondea por separado antes de sumar, que es como lo hace
 * FactuSOL: si se redondeara solo al final, el total podría salir un céntimo
 * distinto del que imprime el programa y descuadrar la comparación.
 */
export function calcularTotales(lineas: LineaFactura[]): TotalesFactura {
  const base = céntimos(lineas.reduce((suma, l) => suma + l.importe, 0));
  const iva = céntimos((base * IVA) / 100);
  const irpf = céntimos((base * IRPF) / 100);
  return { base, iva, irpf, total: céntimos(base + iva - irpf) };
}

/**
 * Importe con coma decimal y miles con punto, como en la factura modelo.
 *
 * A mano y no con `toLocaleString("es-ES")` porque el español, según CLDR, no
 * agrupa los números de cuatro cifras: daría "1234,50" donde FactuSOL imprime
 * "1.234,50". Con una factura de mes se pasa de mil con facilidad.
 */
/**
 * Convierte lo que se teclea en un campo de importe a un número.
 *
 * Devuelve `null` con el campo vacío —que es "sin importe", un valor válido—
 * y `undefined` si lo escrito no es un número. No es lo mismo: lo primero se
 * guarda y lo segundo se rechaza.
 *
 * El punto es el problema. En español separa los miles ("1.234,50") pero
 * mucha gente lo teclea como separador decimal ("12.50"), y confundirlos
 * multiplica el importe por cien. La regla:
 *
 * - Si hay coma, manda la coma: los puntos son miles.
 * - Si no hay coma pero los puntos separan grupos de tres cifras, son miles.
 * - Si no, el punto es el separador decimal.
 */
export function parseImporte(cru: string): number | null | undefined {
  const texto = cru.trim().replace(/\s/g, "");
  if (texto === "") return null;
  if (!/^\d[\d.,]*$/.test(texto)) return undefined;

  let normalizado: string;
  if (texto.includes(",")) {
    // Más de una coma no es un número, es un dedazo.
    if (texto.indexOf(",") !== texto.lastIndexOf(",")) return undefined;
    normalizado = texto.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(texto)) {
    normalizado = texto.replace(/\./g, "");
  } else {
    if (texto.indexOf(".") !== texto.lastIndexOf(".")) return undefined;
    normalizado = texto;
  }

  const valor = Number(normalizado);
  if (!Number.isFinite(valor) || valor < 0) return undefined;
  // Los importes son euros con céntimos: más decimales no significan nada y
  // acaban en una factura que no cuadra por un céntimo.
  return Math.round(valor * 100) / 100;
}

export function euros(valor: number): string {
  const negativo = valor < 0;
  const [entero, decimales] = Math.abs(valor).toFixed(2).split(".");
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}${conMiles},${decimales}`;
}

/** Fecha en dd/mm/aaaa. */
export function fechaCorta(iso: string): string {
  const [año, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${año}`;
}

/** Reparte las líneas en hojas. Siempre devuelve al menos una. */
export function paginar(lineas: LineaFactura[]): LineaFactura[][] {
  if (lineas.length === 0) return [[]];
  const paginas: LineaFactura[][] = [];
  for (let i = 0; i < lineas.length; i += LINEAS_POR_PAGINA) {
    paginas.push(lineas.slice(i, i + LINEAS_POR_PAGINA));
  }
  return paginas;
}
