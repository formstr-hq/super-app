import path from "path";

import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Dev-server config for serving the app over Yggdrasil (or any LAN) with HTTPS.
 *
 * Why HTTPS: browsers only expose `crypto.subtle` and `crypto.randomUUID()` on a
 * SECURE context (https or localhost). Over a plain-http mesh address those are
 * undefined, breaking the app. A self-signed cert (via basic-ssl) makes it a
 * secure context once you accept the browser warning.
 *
 * Run: pnpm --filter @formstr/app exec vite --config vite.ygg.config.ts \
 *        --host <your-ygg-addr> --port 5173
 */
export default defineConfig({
  plugins: [react(), basicSsl()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    // Allow the app to be reached by IP/hostname (Vite otherwise host-checks).
    allowedHosts: true,
  },
});
