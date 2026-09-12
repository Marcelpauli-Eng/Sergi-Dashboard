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
    // `theme-color` de abajo y elige solo el contraste de los iconos.
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
  // El fondo (`--background`), que es lo que queda debajo de la barra de
  // estado desde que la cabecera dejó de llevar degradado. Uno solo: la app
  // es siempre clara, así que no hay una versión oscura que seguir.
  themeColor: "#ffffff",
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
      <body className="min-h-svh overflow-x-hidden">
        {/*
          En desarrollo, fuera cualquier service worker que quede registrado.

          `next.config.ts` desactiva el service worker en desarrollo, pero eso
          solo impide registrar uno nuevo: el que quedara de haber ejecutado
          alguna vez `npm run build && npm run start` en este mismo puerto
          sigue vivo y sigue interceptando las peticiones, incluidas las de
          `/api/`. Da fallos que no se reproducen y que no están en el código
          que estás mirando — una petición que llega al servidor sin cuerpo,
          una respuesta de ayer servida como si fuera de ahora.

          En producción no se toca nada: ahí el service worker es justo lo que
          hace que la app arranque sin cobertura.
        */}
        {process.env.NODE_ENV === "development" && (
          <Script id="sw-fuera-en-dev" strategy="afterInteractive">
            {'(function(){if(!("serviceWorker"in navigator))return;navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();console.warn("[dev] Service worker desregistrado: "+r.scope+". Recarga para que deje de interceptar.")})}).catch(function(){})})()'}
          </Script>
        )}
        <Splash />
        {children}
      </body>
    </html>
  );
}
