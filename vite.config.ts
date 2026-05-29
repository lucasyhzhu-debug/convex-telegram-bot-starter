import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Minimal Vite config for the admin app. The Convex backend is deployed
// separately; the app reads its URL at runtime from VITE_CONVEX_URL.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
