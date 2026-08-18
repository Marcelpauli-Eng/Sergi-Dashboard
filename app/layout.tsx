import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reparto",
  description: "Pedidos y ruta del día",
  appleWebApp: {
    // Hace que en iOS se abra a pantalla completa al añadirla a inicio.
    capable: true,
    title: "Reparto",
    // `default` deja la hora y la batería en negro sobre la barra
    // translúcida en claro, y el sistema las pasa a blanco en oscuro.
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
