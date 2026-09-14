import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { isConfigError } from "@/lib/env";
import { actualitzarComanda, crearComanda } from "@/lib/sheets";
import { actualitzarComandaDemo, crearComandaDemo, isDemoMode } from "@/lib/demo";

/**
 * Crear una comanda a mano.
 *
 * La hoja la llena la oficina, pero no siempre llega todo: un porte que sale
 * al momento, una recogida pactada por teléfono. Esto lo añade al full sin
 * tener que abrir el Google Sheet en el móvil.
 *
 * Solo el número es obligatorio —es la clave de todo lo demás— y el resto se
 * puede completar después desde la ficha de la comanda, con el PATCH de aquí
 * abajo.
 */


/**
 * La dirección elegida en el buscador de Google.
 *
 * Es opcional: se puede seguir escribiendo la dirección a mano. Cuando
 * viene, la comanda se guarda con el portal exacto y ya no hace falta
 * adivinar nada el día del reparto.
 */
const llocSchema = z.object({
  placeId: z.string().trim().min(1).max(300),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const schema = z.object({
  id: z.string().trim().min(1).max(64),
  customer: z.string().trim().max(200).optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(120).optional(),
  measures: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(500).optional(),
  lloc: llocSchema.optional(),
  /** Full donde crearla. Si no se pasa, el del mes en curso. */
  sheetTab: z.string().max(120).optional(),
  /**
   * Crear la comanda aunque ese número ya exista en el full: es otra parte
   * de la misma entrega. Lo manda la pantalla después de preguntarlo, no va
   * nunca de serie: un número repetido sin querer es un número mal tecleado.
   */
  afegirPart: z.boolean().optional(),
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

  const { sheetTab, lloc, ...dades } = parsed.data;

  if (isDemoMode()) {
    return crearComandaDemo(dades)
      ? NextResponse.json({ comanda: dades.id, sheetTab: "Demo" })
      : NextResponse.json(
          {
            error: `Ja hi ha una comanda amb el número "${dades.id}".`,
            repetida: true,
          },
          { status: 409 },
        );
  }

  try {
    const resultat = await crearComanda({ ...dades, driverId: driver.id }, sheetTab, lloc);
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
      /*
        El 409 no es un "no": la pantalla lo usa para preguntar si es otra
        parte de la misma comanda y reenviarlo con `afegirPart`. Por eso va
        con `repetida`, para que no tenga que mirar el texto del mensaje.
      */
      const repetida = error.message.includes("Ja hi ha");
      return NextResponse.json(
        { error: error.message, repetida: repetida || undefined },
        { status: repetida ? 409 : 500 },
      );
    }

    return NextResponse.json(
      { error: "No s'ha pogut crear la comanda al Google Sheet" },
      { status: 502 },
    );
  }
}

const editarSchema = z.object({
  id: z.string().trim().min(1).max(64),
  sheetTab: z.string().max(120).optional(),
  /*
    Cada campo, opcional por separado: se manda solo lo que se toca. Una
    cadena vacía SÍ se guarda —es borrar el dato— y por eso no vale con
    ignorar lo que venga vacío; lo que no se manda es lo que no se toca.
  */
  customer: z.string().trim().max(200).optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(120).optional(),
  measures: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(500).optional(),
  lloc: llocSchema.optional(),
});

/**
 * Corrige los datos de una comanda que ya está en la hoja.
 *
 * El número no se toca: es la clave con la que se guardan el importe y la
 * factura, así que cambiarlo dejaría el precio colgado de una comanda que ya
 * no existe. Para eso, se crea otra.
 */
export async function PATCH(request: Request) {
  const driver = await getSession();
  if (!driver) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const parsed = editarSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const [problema] = parsed.error.issues;
    return NextResponse.json(
      { error: `Petición inválida: ${problema.path.join(".") || "cuerpo"} — ${problema.message}` },
      { status: 400 },
    );
  }

  const { id, sheetTab, lloc, ...dades } = parsed.data;
  if (Object.keys(dades).length === 0) {
    return NextResponse.json({ error: "No hi ha res per canviar" }, { status: 400 });
  }

  if (isDemoMode()) {
    return actualitzarComandaDemo(id, dades)
      ? NextResponse.json({ comanda: id })
      : NextResponse.json({ error: "Comanda no encontrada" }, { status: 404 });
  }

  try {
    const trobada = await actualitzarComanda(id, dades, sheetTab, lloc);
    if (!trobada) {
      return NextResponse.json(
        { error: `La comanda ${id} ja no és al full` },
        { status: 404 },
      );
    }
    return NextResponse.json({ comanda: id });
  } catch (error) {
    console.error("Error actualizando la comanda:", error);
    if (isConfigError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { error: "No s'han pogut desar els canvis al Google Sheet" },
      { status: 502 },
    );
  }
}
