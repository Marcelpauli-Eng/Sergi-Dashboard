import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyCredentials, createSession } from "@/lib/session";
import { isConfigError } from "@/lib/env";

const schema = z.object({
  driverId: z.string().min(1).max(64),
  pin: z.string().min(1).max(64),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
  }

  try {
    const driver = verifyCredentials(parsed.data.driverId, parsed.data.pin);
    if (!driver) {
      // Mensaje genérico a propósito: no revelamos si el fallo fue el código
      // o el PIN.
      return NextResponse.json(
        { error: "Código o PIN incorrectos" },
        { status: 401 },
      );
    }

    await createSession(driver);
    return NextResponse.json({ driver });
  } catch (error) {
    console.error("Error en el login:", error);

    // Si el problema es una variable de entorno sin poner, decirlo ahorra
    // una hora de depuración a ciegas. No revela ningún secreto, solo qué
    // falta por configurar.
    if (isConfigError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      { error: "Error del servidor. Revisa los logs." },
      { status: 500 },
    );
  }
}
