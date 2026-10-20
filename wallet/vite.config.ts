import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { publishPointsShell } from "./spaFallback";

const configDir = path.dirname(fileURLToPath(import.meta.url));

export function pointsShellPlugin(): Plugin {
  let outDir: string | null = null;
  return {
    name: "stranded-points-shell",
    apply: "build",
    configResolved(resolved) {
      outDir = path.resolve(resolved.root, resolved.build.outDir);
    },
    closeBundle() {
      if (!outDir) {
        throw new Error("Vite build.outDir was not resolved");
      }
      publishPointsShell(outDir);
    },
  };
}

export default defineConfig({
  plugins: [react(), pointsShellPlugin()],
  // Only VITE_ is exposed to the client. A RELAYER_ prefix would inline every
  // RELAYER_* value from the build environment, including RELAYER_PRIVATE_KEY.
  envPrefix: ["VITE_"],
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
