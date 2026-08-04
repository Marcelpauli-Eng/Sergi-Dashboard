import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

/**
 * Service worker.
 *
 * Su único cometido es que la app **arranque** sin cobertura: el HTML, el
 * JavaScript y los estilos salen de la caché. Los datos no pasan por aquí,
 * viven en IndexedDB (ver lib/db.ts).
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
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
