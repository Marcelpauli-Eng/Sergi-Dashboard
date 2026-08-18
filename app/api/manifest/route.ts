import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { buildManifest } from "@/lib/manifest";
import { isDemoMode, demoManifest } from "@/lib/demo";
import { env } from "@/lib/env";

/**
 * Devuelve todo lo que el transportista necesita para la jornada.
 *
 * La app llama a este endpoint cuando hay cobertura y vuelca la respuesta en
 * IndexedDB. La pantalla nunca lee de aquí directamente.
 *
 * Acepta un parámetro `tab` en el query string para especificar qué pestaña
 * del Google Sheet leer. Si no se pasa, usa la pestaña por defecto de env.
 */
export async function GET(request: NextRequest) {
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

  const sheetTab = request.nextUrl.searchParams.get("tab") || undefined;

  try {
    const manifest = await buildManifest(driver.id, driver.name, sheetTab);
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
