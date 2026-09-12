import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import NovaComanda from "@/components/nova-comanda";

/**
 * Crear una comanda a mano, en su propia pantalla.
 *
 * Como el resto de rutas con sesión, se renderiza en cada petición: depende
 * de la cookie. Sin cobertura no llega a ejecutarse, así que crear una
 * comanda necesita internet —la fila se escribe en la hoja de la oficina, y
 * eso no se puede encolar como una entrega: el número podría chocar con otro
 * que hubieran puesto mientras tanto.
 */
export const dynamic = "force-dynamic";

export default async function NovaComandaPage() {
  const driver = await getSession();
  if (!driver) redirect("/login");

  return <NovaComanda />;
}
