import {
  A4_ALTO,
  A4_ANCHO,
  FILETE,
  type Elemento,
} from "./factura-hoja.ts";

/**
 * Un PDF a partir de la maqueta de la factura.
 *
 * Se escribe a mano, sin librería. Suena a más de lo que es porque la hoja
 * ya está descrita en PUNTOS —la unidad del PDF— y solo tiene dos clases de
 * cosa: rectángulos rellenos y textos colocados. Traer una librería de PDF
 * para eso son cientos de kilobytes en una app que tiene que arrancar sin
 * cobertura, y esto son doscientas líneas que no cambian nunca.
 *
 * Lo que NO hace: incrustar tipografías. Usa Helvetica, que todo lector de
 * PDF tiene por obligación. La factura impresa desde el navegador sale en
 * Calibri, como FactuSOL; la exportada sale en Helvetica. Cambia la letra,
 * no la maqueta ni un número. Para el papel que se entrega a Hacienda sigue
 * estando el botón de imprimir.
 *
 * Referencia: PDF 1.7 (ISO 32000-1), §7.5 estructura y §9 texto.
 */

/** El PDF cuenta la Y desde abajo; la maqueta, desde arriba. */
function aY(top: number): number {
  return A4_ALTO - top;
}

/**
 * Dónde cae la línea base de un texto.
 *
 * En pantalla el texto se coloca por el borde superior de una caja de alto
 * igual al cuerpo (`line-height: 1`). En el PDF se coloca por la línea base.
 * La distancia entre las dos es el ascendente de la letra, que en Helvetica
 * es 0,718 del cuerpo; el 0,1112 de más es el mismo desfase con el que la
 * pantalla está calibrada contra el PDF original de FactuSOL.
 */
function base(top: number, cuerpo: number): number {
  return aY(top + 0.1112 * cuerpo + 0.718 * cuerpo);
}

/**
 * Cuánto mide un texto, en puntos.
 *
 * Lo mide el propio navegador con Helvetica, que es la misma tipografía que
 * lleva el PDF: sale exacto sin tener que traerse la tabla de anchos de
 * Adobe. Si no hay canvas (renderizado en servidor, o un navegador que lo
 * bloquee) se cae a una estimación, que solo afecta a lo que va alineado a
 * la derecha y por poco.
 */
function ancho(valor: string, cuerpo: number, negrita: boolean): number {
  const contexto = medidor();
  if (!contexto) return valor.length * cuerpo * 0.5;
  contexto.font = `${negrita ? "bold " : ""}${cuerpo}px Helvetica, Arial, sans-serif`;
  return contexto.measureText(valor).width;
}

let contextoMedida: CanvasRenderingContext2D | null | undefined;

function medidor(): CanvasRenderingContext2D | null {
  if (contextoMedida !== undefined) return contextoMedida;
  try {
    contextoMedida = document.createElement("canvas").getContext("2d");
  } catch {
    contextoMedida = null;
  }
  return contextoMedida;
}

/** `#RRGGBB` a los tres números de 0 a 1 que quiere el PDF. */
function color(hex: string): [number, number, number] {
  const limpio = hex.replace("#", "");
  const completo =
    limpio.length === 3
      ? limpio.split("").map((c) => c + c).join("")
      : limpio.padEnd(6, "0");
  return [0, 2, 4].map((i) => parseInt(completo.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function n(valor: number): string {
  // Tres decimales sobran para una hoja de 595 pt de ancho, y quitar los
  // ceros de la cola hace el archivo bastante más pequeño.
  return Number(valor.toFixed(3)).toString();
}

/**
 * Escapa un texto para una cadena literal de PDF.
 *
 * Los caracteres fuera de Latin-1 no existen en WinAnsiEncoding: se cambian
 * por su equivalente sin acento antes que dejar un cuadrado negro en medio
 * de un nombre.
 */
function cadena(valor: string): string {
  const latin1 = [...valor]
    .map((c) => {
      if (c.charCodeAt(0) <= 0xff) return c;
      const sinAcento = c.normalize("NFD").replace(/[̀-ͯ]/g, "");
      return sinAcento.charCodeAt(0) <= 0xff ? sinAcento : "?";
    })
    .join("");
  return latin1.replace(/[\\()]/g, (c) => `\\${c}`);
}

/** El flujo de dibujo de una hoja. */
function contenido(elementos: Elemento[]): string {
  const partes: string[] = [];

  for (const el of elementos) {
    if (el.tipo === "caja") {
      const y = aY(el.top + el.alto);
      if (el.fondo) {
        const [r, g, b] = color(el.fondo);
        partes.push(
          `${n(r)} ${n(g)} ${n(b)} rg`,
          `${n(el.left)} ${n(y)} ${n(el.ancho)} ${n(el.alto)} re f`,
        );
      }
      if (el.borde) {
        const [r, g, b] = color(el.borde);
        // El borde de CSS se pinta hacia dentro; el trazo del PDF va centrado
        // sobre la línea. Media anchura de filete hacia dentro lo cuadra.
        const m = FILETE / 2;
        partes.push(
          `${n(r)} ${n(g)} ${n(b)} RG`,
          `${n(FILETE)} w`,
          `${n(el.left + m)} ${n(y + m)} ${n(el.ancho - FILETE)} ${n(el.alto - FILETE)} re S`,
        );
      }
      continue;
    }

    const negrita = Boolean(el.negrita);
    let x = el.left;
    if (el.ancho !== undefined && el.alinear && el.alinear !== "left") {
      const w = ancho(el.valor, el.cuerpo, negrita);
      x += el.alinear === "right" ? el.ancho - w : (el.ancho - w) / 2;
    }
    const [r, g, b] = color(el.color ?? "#000000");
    partes.push(
      "BT",
      `/${negrita ? "FB" : "FR"} ${n(el.cuerpo)} Tf`,
      `${n(r)} ${n(g)} ${n(b)} rg`,
      `1 0 0 1 ${n(x)} ${n(base(el.top, el.cuerpo))} Tm`,
      `(${cadena(el.valor)}) Tj`,
      "ET",
    );
  }

  return partes.join("\n");
}

/**
 * Arma el archivo PDF.
 *
 * Un objeto por hoja de contenido más el catálogo, el árbol de páginas, las
 * páginas y las dos tipografías. La tabla `xref` del final lleva el byte
 * exacto donde empieza cada objeto, así que se va midiendo sobre la marcha.
 */
export function construirPdf(hojas: Elemento[][]): Blob {
  const objetos: string[] = [];
  /** Devuelve el número del objeto recién añadido (empiezan en 1). */
  const añadir = (cuerpo: string): number => {
    objetos.push(cuerpo);
    return objetos.length;
  };

  const fuenteNormal = añadir(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const fuenteNegrita = añadir(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );

  // El árbol de páginas tiene que citar a sus hijos, y los hijos al padre:
  // se reserva su número antes de crearlos y se rellena al final.
  const numPaginas = objetos.length + 1;
  objetos.push(""); // hueco del árbol de páginas

  const idsPagina: number[] = [];
  for (const hoja of hojas) {
    const flujo = contenido(hoja);
    const idFlujo = añadir(
      `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`,
    );
    idsPagina.push(
      añadir(
        `<< /Type /Page /Parent ${numPaginas} 0 R ` +
          `/MediaBox [0 0 ${n(A4_ANCHO)} ${n(A4_ALTO)}] ` +
          `/Resources << /Font << /FR ${fuenteNormal} 0 R /FB ${fuenteNegrita} 0 R >> >> ` +
          `/Contents ${idFlujo} 0 R >>`,
      ),
    );
  }

  objetos[numPaginas - 1] =
    `<< /Type /Pages /Count ${idsPagina.length} ` +
    `/Kids [${idsPagina.map((id) => `${id} 0 R`).join(" ")}] >>`;

  const catalogo = añadir(`<< /Type /Catalog /Pages ${numPaginas} 0 R >>`);

  let pdf = "%PDF-1.7\n";
  const posiciones: number[] = [];
  for (const [i, cuerpo] of objetos.entries()) {
    posiciones.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${cuerpo}\nendobj\n`;
  }

  const inicioXref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const posicion of posiciones) {
    pdf += `${String(posicion).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objetos.length + 1} /Root ${catalogo} 0 R >>\n` +
    `startxref\n${inicioXref}\n%%EOF\n`;

  // Latin-1 y no UTF-8: las posiciones de la tabla `xref` están contadas en
  // caracteres, y con UTF-8 una letra acentuada ocuparía dos bytes y las
  // descuadraría todas.
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: "application/pdf" });
}

/** Baja el PDF con el nombre que se le pase. */
export function descargarPdf(hojas: Elemento[][], nombre: string): void {
  const url = URL.createObjectURL(construirPdf(hojas));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre.endsWith(".pdf") ? nombre : `${nombre}.pdf`;
  enlace.click();
  URL.revokeObjectURL(url);
}
