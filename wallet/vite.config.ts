import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // RELAYER_BASE_URL is a public Relayer origin, not a secret.
  envPrefix: ["VITE_", "RELAYER_"],
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});
