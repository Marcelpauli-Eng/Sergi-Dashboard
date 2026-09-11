import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { isConfigError } from "@/lib/env";
import { isDemoMode, demoManifest } from "@/lib/demo";
import { env } from "@/lib/env";
import { comandasDelTransportista } from "@/lib/manifest";
import { readImportes, readSheet } from "@/lib/sheets";
import { resumirFull, type ResumFull } from "@/lib/informes";

/**
 * Las cuentas de varios fulls a la vez, para la comparativa.
 *
 * Existe en vez de pedir el manifiesto de cada mes por separado porque eso
 * eran DOS lecturas de Google por mes —la hoja y los importes— y traerse al
 * navegador todas las comandas de un año para sumarlas allí. Aquí los
 * importes se leen una sola vez para todos, y lo que viaja son unas cuantas
 * cifras por mes.
 *
 * Un full que no se deje leer no tumba la comparativa: sale en `errores` y
 * los demás se enseñan igual. Comparar once meses y perder uno es mejor que
 * no comparar nada.
 */

const schema = z.object({
  // Doce como mucho: son doce lecturas a Google y una petición que espera.
  fulls: z.array(z.string().min(1).max(120)).min(1).max(12),
});

export async function GET(request: NextRequest) {
  const driver = await getSession();
  if (!driver) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const crudo = request.nextUrl.searchParams.get("fulls") ?? "";
  const parsed = schema.safeParse({
    fulls: crudo.split(",").map((f) => f.trim()).filter(Boolean),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Indica entre 1 y 12 fulls en el parámetro `fulls`." },
      { status: 400 },
    );
  }
  const fulls = [...new Set(parsed.data.fulls)];

  if (isDemoMode()) {
    // En demo todas las pestañas devuelven lo mismo; se varía un poco para
    // que la comparativa se vea con algo distinto en cada mes.
    const base = demoManifest(env.timezone).today.stops;
    return NextResponse.json({
      mesos: fulls.map((full, i) =>
        resumirFull(
          full,
          base.slice(0, Math.max(1, base.length - (i % base.length))),
        ),
      ),
      errores: [],
    });
  }

  const mesos: ResumFull[] = [];
  const errores: { full: string; motiu: string }[] = [];

  try {
    // Una sola vez para todos los meses: la clave es el nº de comanda, así
    // que el mismo mapa sirve para cualquier full.
    const importes = await readImportes();

    for (const full of fulls) {
      try {
        const snapshot = await readSheet(full);
        const mias = comandasDelTransportista(snapshot.orders, driver.id);
        mesos.push(
          resumirFull(
            full,
            mias.map((order) => ({
              statusCategory: order.statusCategory,
              price: importes.get(order.id) ?? null,
              date: order.date,
            })),
          ),
        );
      } catch (error) {
        const motiu = error instanceof Error ? error.message : "Error desconegut";
        console.warn(`Informes: no se ha podido leer el full "${full}": ${motiu}`);
        errores.push({ full, motiu: motiu.slice(0, 200) });
      }
    }

    return NextResponse.json({ mesos, errores });
  } catch (error) {
    console.error("Error construyendo los informes:", error);
    if (isConfigError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { error: "No se han podido leer los fulls" },
      { status: 502 },
    );
  }
}
