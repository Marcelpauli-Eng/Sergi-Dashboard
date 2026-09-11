import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { isConfigError } from "@/lib/env";
import { readClients, writeClients } from "@/lib/sheets";
import { isDemoMode, demoClients, guardarDemoClients } from "@/lib/demo";

/**
 * A quién se le factura.
 *
 * GET → los clientes de la pestaña "Clients" del documento privado.
 * PUT → guarda la lista entera tal y como queda.
 *
 * En el documento y no en el móvil porque es un dato de la empresa, no del
 * teléfono: cambiar de móvil no puede perder el NIF del cliente, y dos
 * dispositivos no pueden estar facturando a direcciones distintas. El móvil
 * guarda una copia para poder componer la factura sin cobertura, pero la
 * buena es esta.
 */

const clientSchema = z.object({
  // El código es la clave con la que la hoja de repartos dice a quién se
  // factura cada comanda (columna "Client facturació"), así que puede estar
  // vacío mientras solo haya un cliente, pero no ser cualquier cosa.
  codigo: z.string().max(64),
  nombre: z.string().min(1).max(200),
  nif: z.string().max(32),
  direccion: z.string().max(200),
  cp: z.string().max(16),
  poblacion: z.string().max(120),
  provincia: z.string().max(120),
});

const schema = z.object({
  clients: z.array(clientSchema).min(1).max(100),
});

export async function GET() {
  const driver = await getSession();
  if (!driver) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  if (isDemoMode()) {
    return NextResponse.json({ clients: demoClients() });
  }

  try {
    return NextResponse.json({ clients: await readClients() });
  } catch (error) {
    console.error("Error leyendo los clientes del Sheet:", error);
    if (isConfigError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { error: "No s'han pogut llegir els clients" },
      { status: 502 },
    );
  }
}

export async function PUT(request: Request) {
  const driver = await getSession();
  if (!driver) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
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
    guardarDemoClients(parsed.data.clients);
    return NextResponse.json({ clients: parsed.data.clients });
  }

  try {
    await writeClients(parsed.data.clients);
    return NextResponse.json({ clients: parsed.data.clients });
  } catch (error) {
    console.error("Error escribiendo los clientes en el Sheet:", error);
    if (isConfigError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { error: "No s'han pogut desar els clients" },
      { status: 502 },
    );
  }
}
