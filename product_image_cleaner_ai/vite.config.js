import { vitePlugin as remix } from "@remix-run/dev";
import { vercelPreset } from "@vercel/remix/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [remix({ presets: process.env.VERCEL ? [vercelPreset()] : [] })],
  build: { target: "es2022" },
  server: {
    port: Number(process.env.PORT || 3000),
    allowedHosts: [
      ".trycloudflare.com",
      ".myshopify.com",
      "admin.shopify.com",
      "localhost",
    ],
    hmr: {
      protocol: "ws",
      host: "localhost",
      port: 64999,
      clientPort: 64999,
    },
  },
});
