import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_RESCUE_LIMIT_PER_IP,
  DEFAULT_RESCUE_LIMIT_PER_WALLET,
  DEFAULT_RESCUE_LIMIT_WINDOW_MS,
  createRescueLimiter,
  parseRescueLimitConfig,
} from "../rescueLimit.mjs";

const USER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const IP = "203.0.113.9";

function limiter(overrides = {}) {
  let t = overrides.t ?? 1_700_000_000_000;
  const now = overrides.now || (() => t);
  const created = createRescueLimiter({
    config: {
      perWallet: 1,
      perIp: 3,
      windowMs: 4 * 60 * 60 * 1000,
      ...(overrides.config || {}),
    },
    dataDir: overrides.dataDir,
    filePath: overrides.filePath,
    now,
    log: overrides.log || (() => {}),
  });
  return {
    created,
    setTime(value) {
      t = value;
    },
    time: () => t,
  };
}

describe("rescue limit config", () => {
  it("uses defaults when env is unset or blank", () => {
    const config = parseRescueLimitConfig({});
    assert.equal(config.perWallet, DEFAULT_RESCUE_LIMIT_PER_WALLET);
    assert.equal(config.perWallet, 1);
    assert.equal(config.perIp, DEFAULT_RESCUE_LIMIT_PER_IP);
    assert.equal(config.perIp, 3);
    assert.equal(config.windowMs, DEFAULT_RESCUE_LIMIT_WINDOW_MS);
    assert.equal(config.windowMs, 4 * 60 * 60 * 1000);
    assert.deepEqual(parseRescueLimitConfig({ RESCUE_LIMIT_PER_WALLET: "  ", RESCUE_LIMIT_PER_IP: "" }), config);
  });

  it("honors overrides, hour windows, and per-limit disables", () => {
    const config = parseRescueLimitConfig({
      RESCUE_LIMIT_PER_WALLET: "2",
      RESCUE_LIMIT_PER_IP: "5",
      RESCUE_LIMIT_WINDOW_HOURS: "1",
    });
    assert.equal(config.perWallet, 2);
    assert.equal(config.perIp, 5);
    assert.equal(config.windowMs, 60 * 60 * 1000);

    const msWins = parseRescueLimitConfig({
      RESCUE_LIMIT_WINDOW_MS: "1500",
      RESCUE_LIMIT_WINDOW_HOURS: "9",
    });
    assert.equal(msWins.windowMs, 1500);

    const off = parseRescueLimitConfig({
      RESCUE_LIMIT_PER_WALLET: "0",
      RESCUE_LIMIT_PER_IP: "off",
    });
    assert.equal(off.perWallet, null);
    assert.equal(off.perIp, null);

    const words = parseRescueLimitConfig({
      RESCUE_LIMIT_PER_WALLET: "disabled",
      RESCUE_LIMIT_PER_IP: "false",
    });
    assert.equal(words.perWallet, null);
    assert.equal(words.perIp, null);
  });
});

describe("rescue limiter", () => {
  it("blocks the second wallet success inside the window and allows it after", async () => {
    const { created, setTime, time } = limiter();
    await created.ready;
    const first = await created.begin(USER, IP);
    assert.equal(first.ok, true);
    await first.finish(true);

    const blocked = await created.check(USER, IP);
    assert.equal(blocked.limited, true);
    assert.equal(blocked.code, "rate_limited_wallet");
    assert.match(blocked.message, /already got a rescue/);
    assert.match(blocked.message, new RegExp(blocked.retryAt));
    assert.equal(blocked.retryAfter, 4 * 60 * 60);

    setTime(time() + 4 * 60 * 60 * 1000 + 1);
    const again = await created.begin(USER.toUpperCase(), IP);
    assert.equal(again.ok, true);
    await again.finish(true);
  });

  it("enforces the IP backstop across wallets", async () => {
    const { created } = limiter({ config: { perWallet: 10, perIp: 2, windowMs: 1000 } });
    await created.ready;
    for (const user of [USER, OTHER]) {
      const gate = await created.begin(user, IP);
      assert.equal(gate.ok, true);
      await gate.finish(true);
    }
    const third = await created.begin("0x3333333333333333333333333333333333333333", IP);
    assert.equal(third.ok, false);
    assert.equal(third.decision.code, "rate_limited_ip");
    assert.match(third.decision.message, /this network/);

    const otherIp = await created.begin("0x3333333333333333333333333333333333333333", "198.51.100.8");
    assert.equal(otherIp.ok, true);
  });

  it("shares one IPv6 bucket inside a /64 and separates different prefixes", async () => {
    const { created } = limiter({ config: { perWallet: 10, perIp: 1, windowMs: 1000 } });
    await created.ready;
    const first = await created.begin(USER, "2001:db8:1:2::1");
    assert.equal(first.ok, true);
    await first.finish(true);

    const samePrefix = await created.begin(OTHER, "[2001:DB8:1:2:ffff::ffff%eth0]:443");
    assert.equal(samePrefix.ok, false);
    assert.equal(samePrefix.decision.code, "rate_limited_ip");

    const otherPrefix = await created.begin("0x3333333333333333333333333333333333333333", "2001:db8:1:3::1");
    assert.equal(otherPrefix.ok, true);
  });

  it("buckets IPv4-mapped IPv6 as the IPv4 address", async () => {
    const { created } = limiter({ config: { perWallet: 10, perIp: 1, windowMs: 1000 } });
    await created.ready;
    const mapped = await created.begin(USER, "::ffff:203.0.113.9");
    assert.equal(mapped.ok, true);
    await mapped.finish(true);

    const same = await created.begin(OTHER, "203.0.113.9");
    assert.equal(same.ok, false);
    assert.equal(same.decision.code, "rate_limited_ip");

    const other = await created.begin("0x3333333333333333333333333333333333333333", "::ffff:203.0.113.10");
    assert.equal(other.ok, true);
  });

  it("does not count a failed or in-flight rescue that is released", async () => {
    const { created } = limiter();
    await created.ready;
    const failed = await created.begin(USER, IP);
    await failed.finish(false);
    const open = await created.check(USER, IP);
    assert.equal(open.limited, false);

    const pending = await created.begin(USER, IP);
    assert.equal(pending.ok, true);
    const during = await created.check(USER, IP);
    assert.equal(during.limited, true);
    assert.equal(during.inProgress, true);
    assert.match(during.message, /already in progress/);
    assert.equal(during.retryAfter, 30);
    await pending.finish(false);

    const after = await created.begin(USER, IP);
    assert.equal(after.ok, true);
    await after.finish(true);
    const spent = await created.check(USER, IP);
    assert.equal(spent.limited, true);
    assert.equal(spent.inProgress, false);
  });

  it("serializes concurrent begins so only one slot is taken", async () => {
    const { created } = limiter();
    await created.ready;
    const [a, b] = await Promise.all([created.begin(USER, IP), created.begin(USER, IP)]);
    const oks = [a, b].filter((gate) => gate.ok);
    assert.equal(oks.length, 1);
    await oks[0].finish(false);
  });

  it("persists successes across a new limiter and ignores a corrupt file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rescue-limit-"));
    const { created } = limiter({ dataDir: dir });
    await created.ready;
    const gate = await created.begin(USER, IP);
    await gate.finish(true);

    const reloaded = createRescueLimiter({
      dataDir: dir,
      config: { perWallet: 1, perIp: 3, windowMs: 4 * 60 * 60 * 1000 },
      now: () => 1_700_000_000_000,
      log: () => {},
    });
    await reloaded.ready;
    const blocked = await reloaded.check(USER, IP);
    assert.equal(blocked.limited, true);

    const logs = [];
    await writeFile(join(dir, "rescue-limits.json"), "not-json", "utf8");
    const fresh = createRescueLimiter({
      dataDir: dir,
      config: { perWallet: 1, perIp: 3, windowMs: 1000 },
      now: () => 1_700_000_000_000,
      log: (msg) => logs.push(msg),
    });
    await fresh.ready;
    assert.equal((await fresh.check(USER, IP)).limited, false);
    assert.ok(logs.some((msg) => msg.includes("rescue_limit_load")));
  });

  it("does not record anything when both limits are disabled", async () => {
    const { created } = limiter({ config: { perWallet: null, perIp: null, windowMs: 1000 } });
    await created.ready;
    const a = await created.begin(USER, IP);
    const b = await created.begin(USER, IP);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    await a.finish(true);
    await b.finish(true);
    assert.equal((await created.check(USER, IP)).limited, false);
    assert.deepEqual(created.publicConfig(), {
      perWallet: null,
      perIp: null,
      windowMs: 1000,
      walletEnabled: false,
      ipEnabled: false,
    });
  });
});
