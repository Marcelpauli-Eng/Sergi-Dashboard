import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { env } from "@/lib/env";
import { isDemoMode } from "@/lib/demo";
import { comprobarConfiguracion } from "@/lib/diagnostic";

/**
 * El estado de la configuración, visto desde el servidor que está corriendo.
 *
 * Existe porque `npm run check` solo sirve en el ordenador de quien lo
 * ejecuta, y esta app se usa desplegada. Un fallo de configuración en
 * producción —una variable que no se copió a Vercel, un documento compartido
 * con la cuenta equivocada— solo se veía como un error suelto en la pantalla
 * que tocaras, y de ahí a adivinar.
 *
 * No devuelve ningún secreto: ni claves, ni PINs, ni los IDs enteros de los
 * documentos. Del ID solo los últimos seis caracteres, que es lo que se
 * compara de un vistazo con la URL que tienes abierta.
 *
 * Además de un transportista con sesión, lo puede leer el panel de
 * operaciones (sistema-programas) con `Authorization: Bearer <PANEL_CLAVE>`.
 * Esa clave solo abre esta ruta: no da acceso a pedidos ni a facturas.
 */
export async function GET(request: Request) {
  if (!esElPanel(request) && !(await getSession())) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  if (isDemoMode()) {
    return NextResponse.json({
      generadoEn: new Date().toISOString(),
      comprobaciones: [
        {
          id: "demo",
          titulo: "Modo demo",
          estado: "aviso",
          detalle: "Los datos son inventados y no se toca ningún Google Sheet.",
        },
      ],
    });
  }

  return NextResponse.json({
    generadoEn: new Date().toISOString(),
    comprobaciones: await comprobarConfiguracion(env.timezone),
  });
}

/** La petición trae la clave del panel. Sin PANEL_CLAVE definida, nunca. */
function esElPanel(request: Request): boolean {
  const clave = process.env.PANEL_CLAVE ?? "";
  if (clave.length < 32) return false;
  const recibida = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const a = Buffer.from(recibida);
  const b = Buffer.from(clave);
  return a.length === b.length && timingSafeEqual(a, b);
}
