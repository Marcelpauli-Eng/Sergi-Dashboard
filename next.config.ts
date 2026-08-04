import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // En desarrollo el service worker estorba más que ayuda: cachearía
  // versiones antiguas del bundle en cada recarga.
  disable: process.env.NODE_ENV === "development",
  // Cachea también las navegaciones con next/link, para que moverse por la
  // app sin cobertura funcione igual que con ella.
  cacheOnNavigation: true,
});

const nextConfig: NextConfig = {};

export default withSerwist(nextConfig);
