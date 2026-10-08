import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: API proxied to the FastAPI backend (PM2, port 9281). Prod: nginx serves dist/ + proxies /api.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:9281", changeOrigin: true } },
  },
});
