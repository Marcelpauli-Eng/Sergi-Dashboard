import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { writeDeliveries } from "@/lib/sheets";
import { isDemoMode, recordDemoDeliveries } from "@/lib/demo";

const recordSchema = z.object({
  clientId: z.string().uuid(),
  orderId: z.string().min(1),
  status: z.enum(["entregado", "incidencia"]),
  recordedAt: z.string().datetime(),
  note: z.string().max(500).nullable(),
});

const schema = z.object({
  records: z.array(recordSchema).min(1).max(100),
  /** Pestaña del Sheet donde escribir. Si no se pasa, usa la de env. */
  sheetTab: z.string().optional(),
});

/**
 * Registra entregas en el Google Sheet.
 *
 * Recibe un lote porque el transportista puede haber marcado varias paradas
 * sin cobertura y la app las envía todas juntas al recuperarla.
 *
 * Es idempotente por construcción: reenviar el mismo registro reescribe las
 * mismas celdas con los mismos valores, así que un reintento tras un timeout
 * nunca duplica nada.
 */
export async function POST(request: NextRequest) {
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

  // En demo se guardan en memoria en vez de en el Sheet, para que la
  // pantalla se comporte igual que en real (las paradas entregadas no
  // reaparecen al sincronizar).
  if (isDemoMode()) {
    recordDemoDeliveries(parsed.data.records);
    return NextResponse.json({
      applied: parsed.data.records.map((r) => r.orderId),
      notFound: [],
    });
  }

  try {
    const result = await writeDeliveries(parsed.data.records, parsed.data.sheetTab);

    if (result.notFound.length > 0) {
      console.warn(
        `Pedidos no encontrados en el Sheet al registrar entregas: ${result.notFound.join(", ")}`,
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error escribiendo entregas en el Sheet:", error);
    return NextResponse.json(
      { error: "No se ha podido escribir en el Google Sheet" },
      { status: 502 },
    );
  }
}
