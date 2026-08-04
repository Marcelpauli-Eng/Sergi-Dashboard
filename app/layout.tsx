import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reparto",
  description: "Pedidos y ruta del día",
  appleWebApp: {
    // Hace que en iOS se abra a pantalla completa al añadirla a inicio.
    capable: true,
    title: "Reparto",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1d4ed8",
  width: "device-width",
  initialScale: 1,
  // Se permite el zoom: hay direcciones con letra pequeña y gente que la
  // necesita. Bloquearlo por estética es un problema de accesibilidad.
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
