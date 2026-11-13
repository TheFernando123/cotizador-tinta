import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "mask-icon.svg"],
      manifest: {
        name: "Cotizador de Tinta",
        short_name: "Cotizador",
        description:
          "Calculadora dinámica de costos de impresión por cobertura de píxeles",
        theme_color: "#1e1e1e",
        background_color: "#1e1e1e",
        display: "standalone", // Esto oculta la barra de Chrome para que parezca app nativa
        icons: [
          {
            src: "icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ],
});
