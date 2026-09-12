import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { isConfigError } from "@/lib/env";
import { crearComanda } from "@/lib/sheets";
import { crearComandaDemo, isDemoMode } from "@/lib/demo";

/**
 * Crear una comanda a mano.
 *
 * La hoja la llena la oficina, pero no siempre llega todo: un porte que sale
 * al momento, una recogida pactada por teléfono. Esto lo añade al full sin
 * tener que abrir el Google Sheet en el móvil.
 *
 * Solo el número es obligatorio —es la clave de todo lo demás— y el resto se
 * puede completar después desde la ficha de la comanda.
 */

const schema = z.object({
  id: z.string().trim().min(1).max(64),
  customer: z.string().trim().max(200).optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(120).optional(),
  measures: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(500).optional(),
  /** Full donde crearla. Si no se pasa, el del mes en curso. */
  sheetTab: z.string().max(120).optional(),
});

export async function POST(request: Request) {
  const driver = await getSession();
  if (!driver) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const [problema] = parsed.error.issues;
    const donde = problema.path.join(".") || "cuerpo";
    return NextResponse.json(
      { error: `Petición inválida: ${donde} — ${problema.message}` },
      { status: 400 },
    );
  }

  const { sheetTab, ...dades } = parsed.data;

  if (isDemoMode()) {
    return crearComandaDemo(dades)
      ? NextResponse.json({ comanda: dades.id, sheetTab: "Demo" })
      : NextResponse.json(
          { error: `Ja hi ha una comanda amb el número "${dades.id}".` },
          { status: 409 },
        );
  }

  try {
    const resultat = await crearComanda({ ...dades, driverId: driver.id }, sheetTab);
    console.warn(`Comanda ${dades.id} creada por ${driver.id} en ${resultat.sheetTab}`);
    return NextResponse.json({ comanda: dades.id, sheetTab: resultat.sheetTab });
  } catch (error) {
    console.error("Error creando la comanda:", error);

    /*
      El número repetido no es un fallo del servidor: es algo que el
      transportista puede arreglar cambiando el número, así que se contesta
      con el mensaje tal cual y un 409, no con un 500 mudo.
    */
    if (isConfigError(error)) {
      const repetida = error.message.includes("Ja hi ha");
      return NextResponse.json({ error: error.message }, { status: repetida ? 409 : 500 });
    }

    return NextResponse.json(
      { error: "No s'ha pogut crear la comanda al Google Sheet" },
      { status: 502 },
    );
  }
}
