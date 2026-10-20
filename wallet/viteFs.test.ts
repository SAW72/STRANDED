import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "./vite.config";

const walletRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const sharedDir = path.resolve(walletRoot, "../shared");
const parentDir = path.resolve(walletRoot, "..");

function allowList(): string[] {
  const allow = config.server?.fs?.allow;
  expect(Array.isArray(allow)).toBe(true);
  return allow ?? [];
}

describe("client env prefix", () => {
  it("exposes only VITE_ variables", () => {
    const prefix = config.envPrefix;
    const list = Array.isArray(prefix) ? prefix : prefix ? [prefix] : [];
    expect(list).toEqual(["VITE_"]);
  });
});

describe("dev server file access", () => {
  it("allows only the wallet root and the shared folder", () => {
    const allow = allowList();
    expect(allow.length).toBeGreaterThan(0);
    for (const entry of allow) {
      const resolved = path.resolve(walletRoot, entry);
      const insideWallet = resolved === walletRoot || resolved.startsWith(walletRoot + path.sep);
      const insideShared = resolved === sharedDir || resolved.startsWith(sharedDir + path.sep);
      expect(entry).not.toBe("..");
      expect(resolved).not.toBe(parentDir);
      expect(insideWallet || insideShared).toBe(true);
    }
  });
});
