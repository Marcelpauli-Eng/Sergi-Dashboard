import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { emitirFactura, readFacturas } from "@/lib/sheets";
import { isDemoMode, demoFacturas, emitirFacturaDemo } from "@/lib/demo";

/**
 * Facturas emitidas.
 *
 * GET  → las que ya están registradas en la pestaña "Factures" del Sheet.
 * POST → emite una nueva: le asigna el siguiente número de la serie y la
 *        registra.
 *
 * El número lo pone el servidor, nunca el móvil: es lo único que garantiza
 * que la serie no tenga saltos ni repetidos. Por eso emitir necesita
 * cobertura, mientras que el resto de la app funciona sin ella.
 */

const lineaSchema = z.object({
  comanda: z.string().min(1).max(64),
  importe: z.number().min(0).max(1_000_000),
});

const schema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodo: z.string().max(120),
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
    return NextResponse.json(
      { error: "No se han podido leer las facturas" },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const driver = await getSession();
  if (!driver) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Petición inválida", detail: parsed.error.issues },
      { status: 400 },
    );
  }

  if (isDemoMode()) {
    return NextResponse.json({ factura: emitirFacturaDemo(parsed.data) });
  }

  try {
    const factura = await emitirFactura(parsed.data);
    return NextResponse.json({ factura });
  } catch (error) {
    console.error("Error emitiendo la factura:", error);
    return NextResponse.json(
      { error: "No se ha podido registrar la factura en el Google Sheet" },
      { status: 502 },
    );
  }
}
