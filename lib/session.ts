import "server-only";
import { timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "./env";
import type { Driver } from "./types";

const COOKIE_NAME = "sd_session";

/**
 * Un año. La sesión es deliberadamente muy larga: el transportista tiene que
 * poder abrir la app un lunes a las 6 de la mañana en un polígono sin
 * cobertura y entrar directo. Una sesión que caduca es una pantalla de login
 * que no se puede pasar sin internet, y eso deja a alguien tirado.
 */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Se resuelve en la primera petición, no al importar el módulo. */
let secretBytes: Uint8Array | null = null;
function secret(): Uint8Array {
  secretBytes ??= new TextEncoder().encode(env.sessionSecret);
  return secretBytes;
}

/** Comparación en tiempo constante, para no filtrar el PIN por temporización. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Valida las credenciales. Devuelve el transportista si el PIN es correcto.
 *
 * Se comprueban todos los transportistas aunque el código no exista, para
 * que el tiempo de respuesta no revele qué códigos están dados de alta.
 */
export function verifyCredentials(driverId: string, pin: string): Driver | null {
  const normalized = driverId.trim().toLowerCase();
  let matched: Driver | null = null;

  for (const driver of env.drivers) {
    const idOk = safeEqual(driver.id, normalized);
    const pinOk = safeEqual(driver.pin, pin.trim());
    if (idOk && pinOk) matched = { id: driver.id, name: driver.name };
  }

  return matched;
}

export async function createSession(driver: Driver): Promise<void> {
  const token = await new SignJWT({ name: driver.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(driver.id)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function getSession(): Promise<Driver | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return { id: payload.sub, name: String(payload.name ?? payload.sub) };
  } catch {
    // Token caducado o manipulado: se trata como sesión inexistente.
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
