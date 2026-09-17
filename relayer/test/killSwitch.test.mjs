import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createKillSwitch, parseEnvFlag, RELAYER_PAUSED } from "../killSwitch.mjs";

describe("kill switch", () => {
  it("parses env flags", () => {
    assert.equal(parseEnvFlag("1"), true);
    assert.equal(parseEnvFlag("true"), true);
    assert.equal(parseEnvFlag("ON"), true);
    assert.equal(parseEnvFlag("0"), false);
    assert.equal(parseEnvFlag(""), false);
    assert.equal(parseEnvFlag(undefined), false);
  });

  it("pauses and unpauses in memory", () => {
    const ks = createKillSwitch({ initial: true });
    assert.equal(ks.isPaused(), true);
    ks.unpause();
    assert.equal(ks.isPaused(), false);
    ks.pause();
    assert.equal(ks.isPaused(), true);
    assert.equal(RELAYER_PAUSED, "relayer_paused");
  });
});
