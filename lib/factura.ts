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

// En blanco a propósito: cada instalación pone los suyos en Ajustes, y se
// guardan en las pestañas "Emissor" y "Clients" de su documento de facturas.
// Aquí no van los datos fiscales de nadie: el código es el mismo para todos.
const EMISOR = {
  nombre: "",
  direccion: "",
  cp: "",
  poblacion: "",
  provincia: "",
  nif: "",
  telefono: "",
} as const;

const CLIENTE = {
  nombre: "",
  direccion: "",
  cp: "",
  poblacion: "",
  provincia: "",
  codigo: "",
  nif: "",
} as const;

/**
 * Valores de partida de una instalación nueva: emisor y cliente en blanco,
 * para rellenar desde Ajustes.
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

/* ── Lo que ya está facturado ───────────────────────────────────────────── */

/**
 * ¿En qué factura emitida del mismo mes está ya esta comanda?
 *
 * Devuelve un buscador, que contesta con el número de la factura o `null`.
 * Las facturas no guardan el id del pedido, solo lo que se imprime: la
 * etiqueta de la comanda ("748" o "748 (1/3)", ver `etiquetaComanda`), el
 * documento de donde sale (`grup`) y la pestaña del mes (`periodo`). Así que
 * la comanda se reconoce por esas tres cosas.
 *
 * - El mes cuenta: los números de comanda se repiten de un mes a otro.
 * - El documento cuenta siempre: cada bossa numera por su cuenta, y la "12"
 *   del full principal no es la "12" de la bossa de un cliente.
 * - Una línea SIN documento es del full principal (`nomPrincipal`). Solo se
 *   guarda `grup` cuando hay más de un documento, así que una factura sin él
 *   es de cuando el principal era el único. Tratarla como "de cualquier
 *   bossa" escondía comandas de las bosses de cliente que no estaban
 *   facturadas en ningún sitio.
 *
 * Al borrar una factura sus líneas dejan de estar aquí, y las comandas
 * vuelven a salir en el generador solas.
 */
export function comandesFacturades(
  facturas: readonly {
    numero: number;
    periodo: string;
    lineas: readonly { comanda: string; grup?: string }[];
  }[],
  periodo: string,
  nomPrincipal: string,
): (comanda: string, grup?: string) => number | null {
  const mes = periodo.trim();
  const principal = nomPrincipal.trim();
  const clau = (comanda: string, grup?: string) =>
    `${(grup ?? "").trim() || principal}\u0000${comanda.trim()}`;

  const on = new Map<string, number>();
  for (const f of facturas) {
    if (f.periodo.trim() !== mes) continue;
    for (const l of f.lineas) on.set(clau(l.comanda, l.grup), f.numero);
  }
  return (comanda, grup) => on.get(clau(comanda, grup)) ?? null;
}

/**
 * Se ha intentado emitir una factura con comandas que ya están en otra.
 *
 * Lo lanza el servidor justo antes de registrarla: la pantalla ya las
 * esconde, pero con dos móviles, o con el listado sin cargar, la única
 * comprobación que vale es la que se hace contra la hoja.
 */
export class ComandesJaFacturadesError extends Error {
  readonly comandes: string[];

  constructor(comandes: string[]) {
    super(
      comandes.length === 1
        ? `La comanda ${comandes[0]} ja està en una altra factura d'aquest mes.`
        : `Les comandes ${comandes.join(", ")} ja estan en una altra factura d'aquest mes.`,
    );
    this.comandes = comandes;
    this.name = "ComandesJaFacturadesError";
  }
}

/**
 * Lanza `ComandesJaFacturadesError` si alguna línea ya está facturada.
 *
 * Sin `nomPrincipal` (un móvil con la versión anterior de la app) no se
 * puede saber de qué bossa es una línea sin documento, y solo se comparan
 * las que lo llevan: mejor dejar pasar una que bloquear una factura buena.
 */
export function comprovarNoFacturades(
  emeses: Parameters<typeof comandesFacturades>[0],
  nova: {
    periodo: string;
    lineas: readonly { comanda: string; grup?: string }[];
    nomPrincipal?: string;
  },
): void {
  const principal = nova.nomPrincipal?.trim() ?? "";
  const facturada = comandesFacturades(
    principal
      ? emeses
      : emeses.map((f) => ({ ...f, lineas: f.lineas.filter((l) => l.grup?.trim()) })),
    nova.periodo,
    // Sin nombre, una clave que no puede coincidir con ningún documento.
    principal || "\u0000",
  );
  const repetides = nova.lineas
    .filter((l) => (principal || l.grup?.trim()) && facturada(l.comanda, l.grup) !== null)
    .map((l) => l.comanda);
  if (repetides.length > 0) throw new ComandesJaFacturadesError(repetides);
}
