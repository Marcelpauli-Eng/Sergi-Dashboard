import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { isConfigError } from "@/lib/env";
import { esborrarComanda, restaurarComanda } from "@/lib/sheets";
import { isDemoMode } from "@/lib/demo";

/**
 * Borrar una comanda del full, y deshacerlo.
 *
 * POST la borra y contesta con su fila tal y como estaba; PUT con esa misma
 * fila la vuelve a escribir. El móvil la guarda el medio minuto que dura el
 * aviso de Desfer: pasado ese rato, lo borrado se queda borrado.
 */

const esborrarSchema = z.object({
  id: z.string().trim().min(1).max(64),
  /** El full en el que está. Sin él, el del mes en curso. */
  sheetTab: z.string().max(120).optional(),
});

const restaurarSchema = z.object({
  id: z.string().trim().min(1).max(64),
  full: z.string().min(1).max(120),
  fila: z
    .array(z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]))
    .min(1)
    .max(200),
});

function invalida(error: z.ZodError) {
  const [problema] = error.issues;
  return NextResponse.json(
    { error: `Petición inválida: ${problema.path.join(".") || "cuerpo"} — ${problema.message}` },
    { status: 400 },
  );
}

function fallada(error: unknown, text: string) {
  console.error(`${text}:`, error);
  return NextResponse.json(
    { error: isConfigError(error) ? error.message : text },
    { status: isConfigError(error) ? 400 : 502 },
  );
}

export async function POST(request: Request) {
  const driver = await getSession();
  if (!driver) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const parsed = esborrarSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalida(parsed.error);
  if (isDemoMode()) {
    return NextResponse.json({ error: "No disponible en mode demo" }, { status: 400 });
  }

  try {
    const esborrada = await esborrarComanda(parsed.data.id, parsed.data.sheetTab);
    if (!esborrada) {
      return NextResponse.json({ error: "Aquesta comanda ja no és al full" }, { status: 404 });
    }
    console.warn(`Comanda ${parsed.data.id} esborrada per ${driver.id} del full "${esborrada.full}"`);
    return NextResponse.json(esborrada);
  } catch (error) {
    return fallada(error, "No s'ha pogut esborrar la comanda");
  }
}

export async function PUT(request: Request) {
  const driver = await getSession();
  if (!driver) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const parsed = restaurarSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalida(parsed.error);
  if (isDemoMode()) {
    return NextResponse.json({ error: "No disponible en mode demo" }, { status: 400 });
  }

  try {
    await restaurarComanda(parsed.data.id, parsed.data.full, parsed.data.fila);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fallada(error, "No s'ha pogut tornar a posar la comanda");
  }
}
