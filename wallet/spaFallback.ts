import fs from "node:fs";
import path from "node:path";

/**
 * Publish the Vite shell at /points/index.html.
 *
 * The wallet host is a Render static site. It serves a file when one exists,
 * and it does not read wallet/public/_redirects. A direct GET /points is
 * otherwise a plain-text Not Found, so the client route never loads.
 * Render treats /points as the directory index /points/index.html.
 */
export function publishPointsShell(distDir: string): void {
  const indexPath = path.join(distDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error(`SPA shell is missing at ${indexPath}`);
  }
  const pointsDir = path.join(distDir, "points");
  fs.mkdirSync(pointsDir, { recursive: true });
  fs.copyFileSync(indexPath, path.join(pointsDir, "index.html"));
}
