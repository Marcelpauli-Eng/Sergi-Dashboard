import "server-only";
import { JWT } from "google-auth-library";
import { env } from "./env";

/**
 * Cliente JWT del service account, a nivel de módulo para que el token
 * cacheado se reaproveche entre peticiones dentro de la misma instancia
 * del servidor. Sin esto pediríamos un token nuevo a Google en cada request.
 */
let cached: JWT | null = null;

function client(): JWT {
  if (!cached) {
    cached = new JWT({
      email: env.google.serviceAccountEmail,
      key: env.google.privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  return cached;
}

export async function googleAccessToken(): Promise<string> {
  const { token } = await client().getAccessToken();
  if (!token) {
    throw new Error(
      "Google no devolvió un token de acceso. Revisa GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_PRIVATE_KEY.",
    );
  }
  return token;
}
