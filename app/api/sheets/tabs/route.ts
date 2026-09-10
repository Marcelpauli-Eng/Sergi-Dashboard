import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listSheetTabs, TAB_FACTURAS } from "@/lib/sheets";

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
    const allTabs = (await listSheetTabs()).filter((t) => t !== TAB_FACTURAS);
    // El registro de facturas no es un mes de repartos: no pinta nada en el
    // selector de full. Se ve sobre todo desde que la lista subió a doce.
    // Las últimas pestañas, que son los meses más recientes. Doce y no tres
    // porque Informes compara meses entre sí: con tres no hay comparativa
    // que valga. Sigue siendo un tope para que una hoja con años de historia
    // no llene el desplegable.
    const tabs = allTabs.slice(-12);
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
