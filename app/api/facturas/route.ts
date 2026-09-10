import { NextResponse } from "next/server";
import { z } from "zod";
import { isConfigError } from "@/lib/env";
import { getSession } from "@/lib/session";
import { actualizarEstadoFactura, emitirFactura, readFacturas } from "@/lib/sheets";
import {
  isDemoMode,
  demoFacturas,
  emitirFacturaDemo,
  actualizarEstadoFacturaDemo,
} from "@/lib/demo";

/**
 * Facturas emitidas.
 *
 * GET   → las que ya están registradas en la pestaña "Factures" del
 *         documento de facturas (ver GOOGLE_SHEET_ID_FACTURAS: es otro
 *         archivo, el de repartos lo ve la empresa entero).
 * POST  → emite una nueva: le asigna el siguiente número de la serie y la
 *         registra.
 * PATCH → mueve el estado del cobro de una que ya está emitida.
 *
 * El número lo pone el servidor, nunca el móvil: es lo único que garantiza
 * que la serie no tenga saltos ni repetidos. Por eso emitir necesita
 * cobertura, mientras que el resto de la app funciona sin ella.
 */

/**
 * Qué se le contesta al transportista cuando falla el Sheet.
 *
 * Si lo que falta es GOOGLE_SHEET_ID_FACTURAS, el mensaje concreto: es la
 * única pieza de la puesta en marcha que solo se nota al facturar, y un
 * "no se ha podido" genérico deja a quien instala la app buscando a ciegas.
 * No revela ningún secreto, solo qué falta por configurar.
 */
function fallo(error: unknown, mensaje: string): NextResponse {
  if (isConfigError(error)) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ error: mensaje }, { status: 502 });
}

const lineaSchema = z.object({
  comanda: z.string().min(1).max(64),
  importe: z.number().min(0).max(1_000_000),
});

const schema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodo: z.string().max(120),
  /** Código del cliente al que se emite. Vacío mientras solo haya uno. */
  client: z.string().max(64).optional().default(""),
  lineas: z.array(lineaSchema).min(1).max(500),
  base: z.number().min(0),
  iva: z.number().min(0),
  irpf: z.number().min(0),
  total: z.number().min(0),
  primerNumero: z.number().int().min(1).max(9_999_999),
});

export async function GET() {
  const driver = await getSession();
  if (!driver) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  if (isDemoMode()) {
    return NextResponse.json({ facturas: demoFacturas() });
  }

  try {
    return NextResponse.json({ facturas: await readFacturas() });
  } catch (error) {
    console.error("Error leyendo las facturas del Sheet:", error);
    return fallo(error, "No se han podido leer las facturas");
  }
}

export async function POST(request: Request) {
  const driver = await getSession();
  if (!driver) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    // Con el campo delante. "Petición inválida" a secas deja al transportista
    // mirando una pantalla que no dice nada y a quien lo mantiene leyendo
    // logs; el nombre del campo suele ser el arreglo entero.
    const [problema] = parsed.error.issues;
    return NextResponse.json(
      {
        error: `Petición inválida: ${problema.path.join(".") || "cuerpo"} — ${problema.message}`,
        detail: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  if (isDemoMode()) {
    return NextResponse.json({
      factura: emitirFacturaDemo({ ...parsed.data, estat: "emesa" }),
    });
  }

  try {
    const factura = await emitirFactura(parsed.data);
    return NextResponse.json({ factura });
  } catch (error) {
    console.error("Error emitiendo la factura:", error);
    return fallo(error, "No se ha podido registrar la factura en el Google Sheet");
  }
}

const estadoSchema = z.object({
  numero: z.number().int().min(1).max(9_999_999),
  estat: z.enum(["emesa", "enviada", "cobrada"]),
});

/**
 * Mueve una factura por los estados del cobro.
 *
 * Es lo único de una factura emitida que se puede cambiar. Las líneas, los
 * importes y el número no: una factura emitida no cambia, y menos desde un
 * móvil.
 */
export async function PATCH(request: Request) {
  const driver = await getSession();
  if (!driver) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const parsed = estadoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Petición inválida", detail: parsed.error.issues },
      { status: 400 },
    );
  }

  if (isDemoMode()) {
    const factura = actualizarEstadoFacturaDemo(parsed.data.numero, parsed.data.estat);
    return factura
      ? NextResponse.json({ factura })
      : NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  }

  try {
    const factura = await actualizarEstadoFactura(parsed.data.numero, parsed.data.estat);
    if (!factura) {
      return NextResponse.json(
        { error: "Esa factura no está en la hoja" },
        { status: 404 },
      );
    }
    return NextResponse.json({ factura });
  } catch (error) {
    console.error("Error actualizando el estado de la factura:", error);
    return fallo(error, "No se ha podido actualizar el estado en el Google Sheet");
  }
}
