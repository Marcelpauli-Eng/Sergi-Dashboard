import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reparto",
  description: "Pedidos y ruta del día",
  appleWebApp: {
    // Hace que en iOS se abra a pantalla completa al añadirla a inicio.
    capable: true,
    title: "Reparto",
    // `default`/`black` pintan una barra opaca y fija que iOS controla él
    // solo: no sabe nada de nuestro `data-theme`, así que se queda del
    // mismo color pase lo que pase en la app (el bug reportado). Con
    // `black-translucent` la barra pasa a ser transparente y se ve el
    // fondo real de la cabecera (`.material`, con `env(safe-area-inset-top)`
    // ya reservado para el reloj/batería), que sí seguirá el tema.
    statusBarStyle: "black-translucent",
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
        {children}
      </body>
    </html>
  );
}
