import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [remix()],
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
