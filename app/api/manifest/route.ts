import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { buildManifest } from "@/lib/manifest";
import { isDemoMode, demoManifest } from "@/lib/demo";
import { env } from "@/lib/env";

/**
 * Devuelve todo lo que el transportista necesita para la jornada.
 *
 * La app llama a este endpoint cuando hay cobertura y vuelca la respuesta en
 * IndexedDB. La pantalla nunca lee de aquí directamente.
 */
export async function GET() {
  const driver = await getSession();
  if (!driver) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // Datos de mentira, sin tocar Google. Permite ver y enseñar la interfaz
  // antes de tener nada configurado.
  if (isDemoMode()) {
    return NextResponse.json(demoManifest(env.timezone), {
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const manifest = await buildManifest(driver.id, driver.name);
    return NextResponse.json(manifest, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error construyendo el manifiesto:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se ha podido leer el Google Sheet",
      },
      { status: 500 },
    );
  }
}
