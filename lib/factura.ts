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

export interface ClienteFacturacion {
  nombre: string;
  direccion: string;
  cp: string;
  poblacion: string;
  provincia: string;
  /**
   * Código de cliente. Es la clave: es lo que se escribe en la columna
   * "Client facturació" de la hoja para decir a quién se le factura cada
   * comanda. Con un solo cliente da igual lo que ponga.
   */
  codigo: string;
  nif: string;
}

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
  /**
   * A quién se le factura. Una lista y no un solo cliente: se empezó con
   * uno, pero facturar a dos empresas distintas no puede obligar a editar
   * los ajustes entre una factura y la siguiente.
   *
   * El primero es el de por defecto: es al que van las comandas que no
   * digan lo contrario, que hoy son todas.
   */
  clientes: ClienteFacturacion[];
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
  clientes: [{ ...CLIENTE }],
  articulo: "112",
  primerNumero: 30,
};

/**
 * El cliente al que le toca una comanda.
 *
 * Una comanda sin cliente asignado —que hoy son todas, porque la columna del
 * Sheet es opcional— va al primero de la lista. Así añadir clientes no
 * cambia nada de lo que ya funcionaba.
 */
export function clientePara(
  datos: DatosFacturacion,
  codigo: string | null,
): ClienteFacturacion {
  if (!codigo) return datos.clientes[0];
  const encontrado = datos.clientes.find(
    (c) => c.codigo.trim().toLowerCase() === codigo.trim().toLowerCase(),
  );
  return encontrado ?? datos.clientes[0];
}

/** El número tal y como se imprime: seis cifras con ceros delante. */
export function formatearNumero(numero: number): string {
  return String(numero).padStart(6, "0");
}

/** Cuántas líneas caben en el recuadro de una hoja antes de pasar a la siguiente. */
export const LINEAS_POR_PAGINA = 24;

/**
 * Cómo se nombra una comanda en la factura.
 *
 * Una comanda partida en varios viajes son varias entregas, y cada una va a
 * su línea con lo que se cobró por hacerla. Si las tres dijeran solo "748",
 * el cliente vería tres líneas idénticas con importes distintos y la
 * pregunta sería inevitable. Con "748 (1/3)" se lee de un vistazo que es la
 * misma comanda repartida en tres veces.
 *
 * La comanda entera se queda como estaba: "748", sin paréntesis ni nada.
 */
export function etiquetaComanda(comanda: {
  codi: string;
  part: number;
  parts: number;
}): string {
  if (comanda.parts <= 1) return comanda.codi;
  return `${comanda.codi} (${comanda.part}/${comanda.parts})`;
}

export interface LineaFactura {
  /**
   * Nº de comanda tal cual está en la hoja, y con qué parte es cuando la
   * comanda va partida en varios viajes: "748" o "748 (1/3)". Ver
   * `etiquetaComanda`.
   */
  comanda: string;
  /** Lo cobrado por esa entrega, sin IVA. */
  importe: number;
  /**
   * El nombre del documento de donde sale, cuando hay más de uno.
   *
   * Las comandas de las dos bosses van a la misma factura, agrupadas, y
   * cada grupo con su nombre delante: son dos numeraciones distintas y sin
   * el título no se sabe de cuál es cada "748". Vacío con un solo
   * documento, y entonces la factura es la de siempre.
   */
  grup?: string;
}

/**
 * ¿Empieza aquí un grupo? Es donde la hoja pinta el título del documento.
 *
 * También arriba de cada hoja nueva (`anterior` es `undefined`), para que
 * una hoja que empieza a medio grupo diga de cuál es.
 */
export function obreGrup(linea: LineaFactura, anterior?: LineaFactura): boolean {
  return Boolean(linea.grup) && linea.grup !== anterior?.grup;
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

/**
 * Reparte las líneas en hojas. Siempre devuelve al menos una.
 *
 * El título de cada grupo ocupa una fila del recuadro, así que cuenta: sin
 * esto, una hoja llena con dos grupos se salía por abajo. Y va siempre con
 * su primera línea —un título solo al pie de una hoja no dice nada—.
 */
export function paginar(lineas: LineaFactura[]): LineaFactura[][] {
  const paginas: LineaFactura[][] = [];
  let pagina: LineaFactura[] = [];
  let filas = 0;
  for (const linea of lineas) {
    const coste = () => (obreGrup(linea, pagina.at(-1)) ? 2 : 1);
    if (filas + coste() > LINEAS_POR_PAGINA) {
      paginas.push(pagina);
      pagina = [];
      filas = 0;
    }
    filas += coste();
    pagina.push(linea);
  }
  paginas.push(pagina);
  return paginas;
}

/**
 * Los importes de una factura ya emitida, que se guardan todos en UNA celda.
 *
 * Iban separados por ", " y con la coma decimal dentro —"1000,00, 1,00,
 * 2000,00"—, así que partir por comas daba el doble de trozos y cada línea
 * se quedaba con el de al lado: la factura 30 reimpresa enseñaba 1000, 0, 1,
 * 0, 2000… y no sumaba su propio total, que vive en otra casilla y sí estaba
 * bien.
 *
 * Desde ahora el separador es ";", pero aquí se leen las dos formas: una
 * factura emitida no se reescribe nunca, así que las que ya están en la hoja
 * hay que saber leerlas tal y como se guardaron.
 */
export function parseImportesFactura(cru: string): number[] {
  const partes = cru.includes(";")
    ? cru.split(";")
    : // Sin punto y coma, los trozos hay que reconocerlos por su forma: un
      // número, con sus miles si los lleva, y su coma decimal.
      (cru.match(/\d[\d.]*(?:,\d+)?/g) ?? []);

  return partes.map((parte) => parseImporte(parte) ?? 0);
}
