import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientIp, ipBucketKey, normalizeIp, parseTrustedProxyHops } from "../clientIp.mjs";

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

  it("ignores a spoofed True-Client-IP header", () => {
    const ip = clientIp(
      req({
        headers: {
          "true-client-ip": "203.0.113.10",
          "x-forwarded-for": "8.8.8.8",
        },
      }),
    );
    assert.equal(ip, "8.8.8.8");
    assert.notEqual(ip, "203.0.113.10");

    const onlySpoof = clientIp(
      req({
        headers: { "true-client-ip": "1.2.3.4" },
        remoteAddress: "198.51.100.20",
      }),
    );
    assert.equal(onlySpoof, "198.51.100.20");
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
    assert.equal(normalizeIp("::FFFF:cb00:7108"), "203.0.113.8");
    assert.equal(normalizeIp("not-an-ip"), "");
  });

  it("normalizes IPv6 and buckets by /64", () => {
    const expanded = "2001:0db8:0001:0002:0000:0000:0000:0001";
    assert.equal(normalizeIp("2001:DB8:1:2::1"), expanded);
    assert.equal(normalizeIp("[2001:db8:1:2::1]:443"), expanded);
    assert.equal(normalizeIp("2001:db8:1:2::1%eth0"), expanded);
    assert.equal(normalizeIp("[2001:db8:1:2::1%eth0]:443"), expanded);

    const same = ipBucketKey("2001:db8:1:2::1");
    assert.equal(same, "2001:0db8:0001:0002:0000:0000:0000:0000");
    assert.equal(ipBucketKey("2001:DB8:1:2:ffff:ffff:ffff:ffff"), same);
    assert.equal(ipBucketKey("[2001:db8:1:2::abcd]:8443"), same);
    assert.notEqual(ipBucketKey("2001:db8:1:3::1"), same);

    assert.equal(ipBucketKey("203.0.113.9"), "203.0.113.9");
    assert.equal(ipBucketKey("203.0.113.9:443"), "203.0.113.9");
    assert.notEqual(ipBucketKey("203.0.113.9"), ipBucketKey("203.0.113.10"));
    assert.equal(ipBucketKey("::ffff:203.0.113.9"), "203.0.113.9");
    assert.notEqual(ipBucketKey("::ffff:203.0.113.9"), ipBucketKey("::ffff:203.0.113.10"));
  });

  it("defaults trusted proxy hops to 1", () => {
    assert.equal(parseTrustedProxyHops(undefined), 1);
    assert.equal(parseTrustedProxyHops(""), 1);
    assert.equal(parseTrustedProxyHops("0"), 0);
    assert.equal(parseTrustedProxyHops("2"), 2);
    assert.equal(parseTrustedProxyHops("nope"), 1);
  });
});
