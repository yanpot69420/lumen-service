import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";
import { publicCloudEnv } from "./scripts/public-cloud-env";

// Port 3000: rentang 5041-5440 & 5549-5748 diblokir Windows di mesin dev ini.
export default defineConfig(({ mode }) => {
  const cloud = publicCloudEnv(loadEnv(mode, process.cwd(), ["VITE_", "NEXT_PUBLIC_", "SUPABASE_"]));
  return {
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(cloud.url),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(cloud.key),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Lumen Service",
        short_name: "Lumen",
        description:
          "Sistem operasional konter servis HP & jual beli HP second",
        start_url: "/app",
        scope: "/",
        display: "standalone",
        background_color: "#f5f5f5",
        theme_color: "#171717",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: "/index.html",
      },
    }),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { port: 3000, strictPort: true },
  preview: { port: 3001, strictPort: true },
  };
});
