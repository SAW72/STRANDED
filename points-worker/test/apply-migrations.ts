import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach } from "vitest";
import { resetLeaderboardCache } from "../src/index";
import { resetWalletReadLimit } from "../src/readLimit";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(() => {
  resetWalletReadLimit();
  resetLeaderboardCache();
});
