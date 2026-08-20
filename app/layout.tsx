import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reparto",
  description: "Pedidos y ruta del día",
  appleWebApp: {
    // Hace que en iOS se abra a pantalla completa al añadirla a inicio.
    capable: true,
    title: "Reparto",
    // OJO: `black-translucent` NO es "transparente de verdad" — es un tinte
    // negro fijo, se vea lo que se vea debajo. Por eso se veía siempre negra
    // pasase lo que pasase en la app.
    //
    // `default` sí seguía el color real: desde iOS 13 pinta la barra con el
    // `theme-color` de abajo (que ya tiene una entrada para claro y otra
    // para oscuro) y elige solo el contraste de los iconos. Sigue el modo
    // claro/oscuro del SISTEMA; no puede seguir el interruptor manual de
    // Ajustos, porque esa barra la pinta iOS al abrir la app, no la página.
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  // Un color por esquema: si no, la barra del navegador se queda blanca
  // con la app en oscuro.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  width: "device-width",
  initialScale: 1,
  // Se permite el zoom: hay direcciones con letra pequeña y gente que la
  // necesita. Bloquearlo por estética es un problema de accesibilidad.
  maximumScale: 5,
  // Necesario para que `env(safe-area-inset-*)` funcione en iPhone.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-svh overflow-x-hidden">{children}</body>
    </html>
  );
}
