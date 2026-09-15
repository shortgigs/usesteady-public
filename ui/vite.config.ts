import { defineConfig } from "vite";
import react             from "@vitejs/plugin-react";
import tailwindcss       from "@tailwindcss/vite";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],

  // In production builds (npm publish, Vercel) forcefully clear VITE_ADMIN
  // so .env.local cannot leak the admin surface into the published dist.
  // Local dev keeps whatever .env.local says.
  ...(mode === "production" ? {
    define: { "import.meta.env.VITE_ADMIN": JSON.stringify("0") },
  } : {}),

  server: {
    port: 5374,
    proxy: {
      "/api": {
        target:       "http://localhost:3001",
        changeOrigin: true,
        // timeout: 0 keeps long-lived SSE connections (GET .../events) alive
        // through the Vite dev-proxy without the connection being dropped
        // due to the default socket idle timeout. POST calls complete in
        // well under 1s so this change has no effect on them.
        timeout: 0,
      },
    },
  },
}));
