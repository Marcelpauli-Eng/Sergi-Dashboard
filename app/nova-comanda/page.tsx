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

export default async function NovaComandaPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const driver = await getSession();
  if (!driver) redirect("/login");

  // La bossa desde la que se ha pulsado "+": en qué documento se crea.
  const { origen } = await searchParams;
  return <NovaComanda origen={typeof origen === "string" ? origen : ""} />;
}
