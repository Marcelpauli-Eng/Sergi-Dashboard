import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { writeDeliveries } from "@/lib/sheets";
import { isDemoMode, recordDemoDeliveries } from "@/lib/demo";
import { isConfigError } from "@/lib/env";
import { DELIVERY_STATUSES } from "@/lib/types";

const recordSchema = z.object({
  clientId: z.string().uuid(),
  orderId: z.string().min(1),
  type: z.enum(["status", "date", "price"]).optional().default("status"),
  status: z.enum(DELIVERY_STATUSES).optional(),
  date: z.string().optional().nullable(),
  recordedAt: z.string().datetime(),
  note: z.string().max(500).nullable().optional(),
  /** Importe cobrado, sin IVA. Tope alto pero finito: evita que un dedazo
   *  meta un número absurdo en la hoja. */
  price: z.number().min(0).max(1_000_000).nullable().optional(),
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

  const cuerpo = await request.json().catch(() => null);
  const parsed = schema.safeParse(cuerpo);
  if (!parsed.success) {
    // Con el campo delante. "Petición inválida" a secas deja al transportista
    // mirando una pantalla que no dice nada y a quien lo mantiene leyendo
    // logs; el nombre del campo suele ser el arreglo entero.
    const [problema] = parsed.error.issues;
    const donde = problema.path.join(".") || "cuerpo";

    /*
      Y lo que llegó de verdad, en el log del servidor.

      Sin esto, un "records — Invalid input" no se puede depurar: dice que el
      array entero está mal, pero no si llegó vacío, si no llegó, o si llegó
      otra cosa. Y cuando pasa suele ser algo de en medio —un service worker
      viejo de una build de producción que sigue interceptando /api/— que no
      se reproduce a voluntad. Aquí no hay secretos: son comandas, notas e
      importes. Se corta por si la cola era larga.
    */
    const visto =
      cuerpo === null ? "(el cuerpo no era JSON)" : JSON.stringify(cuerpo).slice(0, 1000);
    console.warn(
      `Petición inválida a /api/deliveries en "${donde}": ${problema.message}\n` +
        `  Recibido: ${visto}`,
    );

    return NextResponse.json(
      {
        error: `Petición inválida: ${donde} — ${problema.message}`,
        detail: parsed.error.issues,
      },
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

    // Falta una variable de entorno —típicamente el documento de facturas,
    // que es donde van los importes—. Decirlo ahorra buscar a ciegas por qué
    // la cola no sube. El estado de la entrega SÍ se ha escrito: se escribe
    // antes que el importe, y reintentar reescribe las mismas celdas.
    if (isConfigError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      { error: "No se ha podido escribir en el Google Sheet" },
      { status: 502 },
    );
  }
}
