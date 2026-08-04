import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
  themeColor: "#fbfbfc",
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
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      style={{ colorScheme: "light" }}
    >
      <body className="relative min-h-svh overflow-x-hidden">
        {/*
          Halos suaves de fondo (decorativos, no interactivos). Degradados
          radiales en vez de círculos con `blur`: el filtro de desenfoque
          obliga al móvil a repintar una capa enorme en cada scroll.
        */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(60rem_40rem_at_30%_-10%,rgba(59,130,246,0.07),transparent_60%),radial-gradient(50rem_35rem_at_100%_110%,rgba(139,92,246,0.07),transparent_60%)]"
        />
        {children}
      </body>
    </html>
  );
}
