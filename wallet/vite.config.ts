import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const configDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  // RELAYER_BASE_URL is a public Relayer origin, not a secret.
  envPrefix: ["VITE_", "RELAYER_"],
  server: {
    host: "0.0.0.0",
    port: 5173,
    fs: {
      // The dev server binds 0.0.0.0. Allow this package and the shared module only.
      allow: [path.resolve(configDir, "../shared"), configDir],
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});
