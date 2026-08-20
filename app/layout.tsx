import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import Splash from "@/components/splash";

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
    // `default` sí sigue el color real: desde iOS 13 pinta la barra con el
    // `theme-color` de abajo (que tiene una entrada para claro y otra para
    // oscuro) y elige solo el contraste de los iconos. Sigue el modo
    // claro/oscuro del SISTEMA; no puede seguir el interruptor manual de
    // Ajustes, porque esa barra la pinta iOS al abrir la app, no la página.
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  // Un color por esquema: si no, la barra del navegador se queda blanca
  // con la app en oscuro.
  //
  // Son el tramo de arriba del degradado de la cabecera (`--warm-from`), que
  // es justo lo que queda debajo de la barra de estado. Si aquí hubiera otro
  // color se vería una franja distinta pegada al reloj.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5e7d4" },
    { media: "(prefers-color-scheme: dark)", color: "#2a1f16" },
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
    <html
      lang="es"
      className="h-full antialiased"
      // El script de abajo añade `data-theme` antes de que React hidrate,
      // así que el HTML del servidor y el del cliente difieren a propósito
      // en ese único atributo. Sin esto React lo marca como error.
      suppressHydrationWarning
    >
      <body className="min-h-svh overflow-x-hidden">
        {/*
          Aplica el tema guardado (Ajustes → Clar/Fosc) antes del primer
          pintado. Sin esto, con el móvil en oscuro y "Clar" forzado, se
          vería un parpadeo oscuro→claro al cargar.
        */}
        <Script id="theme-init" strategy="beforeInteractive">
          {'(function(){try{var t=localStorage.getItem("themePreference");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()'}
        </Script>
        <Splash />
        {children}
      </body>
    </html>
  );
}
