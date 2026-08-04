import type { MetadataRoute } from "next";

/**
 * Manifiesto de la PWA. Es lo que convierte la web en un icono en la
 * pantalla de inicio y hace que se abra sin barra de navegador.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Reparto",
    short_name: "Reparto",
    description: "Pedidos y ruta del día",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f1f5f9",
    theme_color: "#1d4ed8",
    lang: "es",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
