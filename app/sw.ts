import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

/**
 * Service worker.
 *
 * Su único cometido es que la app **arranque** sin cobertura: el HTML, el
 * JavaScript y los estilos salen de la caché. Los datos no pasan por aquí,
 * viven en IndexedDB (ver lib/db.ts) — y para que eso sea verdad hay que
 * quitarle a `defaultCache` la regla que cachea `/api/`.
 *
 * Este archivo lo compila @serwist/next a public/sw.js durante el build.
 */

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // La lista de ficheros a precachear la inyecta el build.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // La versión nueva entra en cuanto está lista. En una app de trabajo
  // interesa más que el transportista tenga siempre lo último que respetar
  // pestañas abiertas de ayer.
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    /*
      Las respuestas de la API no se cachean NUNCA.

      `defaultCache` trae una regla que guarda cualquier GET de `/api/` hasta
      24 horas y la sirve en cuanto la red tarda más de diez segundos. Con
      cobertura mala eso devolvía un manifiesto de ayer que además se
      guardaba en IndexedDB encima del bueno: un importe corregido volvía
      solo al valor viejo. Sin cobertura no hace falta: lo descargado ya vive
      en IndexedDB (ver lib/db.ts), que es de donde lee la pantalla.
    */
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
