import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listSheetTabs } from "@/lib/sheets";

/**
 * Devuelve la lista de pestañas (hojas) del Google Sheet.
 * El transportista la necesita para elegir de cuál cargar los pedidos.
 */
export async function GET() {
  const driver = await getSession();
  if (!driver) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const allTabs = await listSheetTabs();
    // Solo mostramos las 3 últimas pestañas (las más recientes)
    const tabs = allTabs.slice(-3);
    return NextResponse.json({ tabs }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error listando pestañas del Sheet:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se han podido leer las pestañas del Google Sheet",
      },
      { status: 500 },
    );
  }
}
