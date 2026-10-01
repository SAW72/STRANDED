import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientIp, normalizeIp, parseTrustedProxyHops } from "../clientIp.mjs";

function req({ headers = {}, remoteAddress = "" } = {}) {
  return { headers, socket: { remoteAddress } };
}

describe("client IP behind Render", () => {
  it("prefers a single CF-Connecting-IP over a spoofed X-Forwarded-For", () => {
    const ip = clientIp(
      req({
        headers: {
          "cf-connecting-ip": "203.0.113.9",
          "x-forwarded-for": "1.2.3.4, 203.0.113.9, 104.22.17.40",
        },
      }),
      { trustedProxyHops: 1 },
    );
    assert.equal(ip, "203.0.113.9");
  });

  it("uses True-Client-IP when CF-Connecting-IP is absent", () => {
    const ip = clientIp(
      req({
        headers: {
          "true-client-ip": "203.0.113.10",
          "x-forwarded-for": "8.8.8.8",
        },
      }),
    );
    assert.equal(ip, "203.0.113.10");
  });

  it("ignores a multi-value CF-Connecting-IP and walks X-Forwarded-For from the right", () => {
    const ip = clientIp(
      req({
        headers: {
          "cf-connecting-ip": "1.1.1.1, 203.0.113.9",
          "x-forwarded-for": "8.8.8.8, 203.0.113.50, 104.22.17.40",
        },
      }),
      { trustedProxyHops: 1 },
    );
    assert.equal(ip, "203.0.113.50");
  });

  it("skips the trusted right-hand proxy hop and ignores a spoofed leftmost entry", () => {
    const honest = clientIp(
      req({ headers: { "x-forwarded-for": "203.0.113.50, 104.22.17.40" } }),
      { trustedProxyHops: 1 },
    );
    const spoofed = clientIp(
      req({ headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.50, 104.22.17.40" } }),
      { trustedProxyHops: 1 },
    );
    assert.equal(honest, "203.0.113.50");
    assert.equal(spoofed, "203.0.113.50");
  });

  it("uses the rightmost hop when no platform suffix was appended", () => {
    const ip = clientIp(
      req({ headers: { "x-forwarded-for": "8.8.8.8, 198.51.100.20" } }),
      { trustedProxyHops: 0 },
    );
    assert.equal(ip, "198.51.100.20");
    const single = clientIp(req({ headers: { "x-forwarded-for": "198.51.100.21" } }), {
      trustedProxyHops: 1,
    });
    assert.equal(single, "198.51.100.21");
  });

  it("falls back to the socket address and normalizes IPv4-mapped IPv6", () => {
    assert.equal(clientIp(req({ remoteAddress: "::ffff:127.0.0.1" })), "127.0.0.1");
    assert.equal(normalizeIp("::ffff:203.0.113.8"), "203.0.113.8");
    assert.equal(normalizeIp("not-an-ip"), "");
  });

  it("defaults trusted proxy hops to 1", () => {
    assert.equal(parseTrustedProxyHops(undefined), 1);
    assert.equal(parseTrustedProxyHops(""), 1);
    assert.equal(parseTrustedProxyHops("0"), 0);
    assert.equal(parseTrustedProxyHops("2"), 2);
    assert.equal(parseTrustedProxyHops("nope"), 1);
  });
});
