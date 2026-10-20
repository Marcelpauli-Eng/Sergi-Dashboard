import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import Dashboard from "@/components/dashboard";
import { today } from "@/lib/dates";
import { env } from "@/lib/env";
import { avisProva } from "@/lib/prova";

/**
 * Esta ruta se renderiza en cada petición porque depende de la cookie de
 * sesión. Sin cobertura no llega a ejecutarse: el service worker sirve la
 * última versión cacheada de esta misma pantalla, y el contenido lo pone
 * IndexedDB desde el cliente.
 */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const driver = await getSession();
  if (!driver) redirect("/login");

  // Un avís no pot tombar l'app: amb la zona horària mal posada, sense avís.
  let avis: string | null = null;
  try {
    avis = avisProva(process.env.FIN_PRUEBA, today(env.timezone));
  } catch {}

  return <Dashboard driverName={driver.name} avisProva={avis} />;
}
