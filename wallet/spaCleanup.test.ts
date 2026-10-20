// Behaviour check: spaFallback.test.ts must remove the temp dirs it creates.
// A private TMPDIR makes a leaked directory visible. SPA_CLEANUP_CHILD stops the child from running this file.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const walletRoot = path.dirname(fileURLToPath(import.meta.url));

it.skipIf(process.env.SPA_CLEANUP_CHILD === "1")("spaFallback.test.ts removes every temp dir it creates", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spa-cleanup-"));
  try {
    const vitest = path.join(walletRoot, "node_modules", "vitest", "vitest.mjs");
    const child = spawnSync(process.execPath, [vitest, "run", "spaFallback.test.ts"], {
      cwd: walletRoot,
      env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp, SPA_CLEANUP_CHILD: "1" },
      encoding: "utf8",
    });
    expect(child.status, child.stdout + child.stderr).toBe(0);
    expect(fs.readdirSync(tmp)).toEqual([]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}, 60_000);
