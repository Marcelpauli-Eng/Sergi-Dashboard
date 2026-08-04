import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyCredentials, createSession } from "@/lib/session";

const schema = z.object({
  driverId: z.string().min(1).max(64),
  pin: z.string().min(1).max(64),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
  }

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
}
