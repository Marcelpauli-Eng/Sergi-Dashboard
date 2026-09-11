import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { isConfigError } from "@/lib/env";
import { readClients, readEmissor, writeClients, writeEmissor } from "@/lib/sheets";
import {
  isDemoMode,
  demoClients,
  demoEmissor,
  guardarDemoClients,
  guardarDemoEmissor,
} from "@/lib/demo";

/**
 * Las dos partes de una factura: quién la emite y a quién.
 *
 * GET → el emisor y los clientes del documento privado, de sus pestañas
 *       "Emissor" y "Clients".
 * PUT → los guarda tal y como quedan.
 *
 * Juntos y no en dos rutas porque se piden juntos —la pantalla de ajustes
 * los edita a la vez— y así es un viaje y no dos.
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

const emissorSchema = z.object({
  nombre: z.string().min(1).max(200),
  nif: z.string().max(32),
  direccion: z.string().max(200),
  cp: z.string().max(16),
  poblacion: z.string().max(120),
  provincia: z.string().max(120),
  telefono: z.string().max(32),
});

const schema = z.object({
  emissor: emissorSchema,
  clients: z.array(clientSchema).min(1).max(100),
});

export async function GET() {
  const driver = await getSession();
  if (!driver) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  if (isDemoMode()) {
    return NextResponse.json({ emissor: demoEmissor(), clients: demoClients() });
  }

  try {
    // En paralelo: son dos pestañas del mismo documento y ninguna depende de
    // la otra, así que no hay por qué esperar a la primera para pedir la
    // segunda.
    const [emissor, clients] = await Promise.all([readEmissor(), readClients()]);
    return NextResponse.json({ emissor, clients });
  } catch (error) {
    console.error("Error leyendo las dades de facturació del Sheet:", error);
    if (isConfigError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { error: "No s'han pogut llegir les dades de facturació" },
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
    guardarDemoEmissor(parsed.data.emissor);
    guardarDemoClients(parsed.data.clients);
    return NextResponse.json(parsed.data);
  }

  try {
    // El emisor primero: si algo falla, lo que queda a medias es la lista de
    // clientes, que es la que se vuelve a mandar entera en el siguiente
    // intento. Al revés dejaría el emisor de la factura a medio cambiar.
    await writeEmissor(parsed.data.emissor);
    await writeClients(parsed.data.clients);
    return NextResponse.json(parsed.data);
  } catch (error) {
    console.error("Error escribiendo las dades de facturació en el Sheet:", error);
    if (isConfigError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { error: "No s'han pogut desar les dades de facturació" },
      { status: 502 },
    );
  }
}
