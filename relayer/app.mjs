import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { clientIp } from "./clientIp.mjs";
import { INVALID_JSON_MESSAGE, RELAYER_PAUSED_MESSAGE, fail, toPublicError } from "./httpError.mjs";
import { RELAYER_PAUSED } from "./killSwitch.mjs";
import { parseQuoteBody, parseRescueUser } from "./quoteRequest.mjs";
import { errorFromLimit } from "./rescueLimit.mjs";

function secretsEqual(provided, expected) {
  const a = Buffer.from(String(provided || ""), "utf8");
  const b = Buffer.from(String(expected || ""), "utf8");
  if (!expected || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function adminAuthorized(req, adminSecret) {
  if (!adminSecret) return false;
  const header = req.headers["x-admin-secret"] || "";
  const auth = String(req.headers.authorization || "");
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return secretsEqual(header, adminSecret) || secretsEqual(bearer, adminSecret);
}

export function createCors(allowedOrigins) {
  const allowed = new Set(
    (Array.isArray(allowedOrigins) ? allowedOrigins : String(allowedOrigins || "").split(","))
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean),
  );
  return function corsHeaders(req) {
    const origin = req.headers.origin;
    const headers = {
      "access-control-allow-headers": "content-type,x-admin-secret,authorization",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      vary: "Origin",
    };
    const normalized = origin ? origin.replace(/\/$/, "") : "";
    if (normalized && allowed.has(normalized)) {
      headers["access-control-allow-origin"] = origin;
    }
    return headers;
  };
}

export function json(res, req, status, body, corsHeaders, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders(req),
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        reject(fail(400, "invalid_json", INVALID_JSON_MESSAGE));
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(fail(400, "invalid_json", INVALID_JSON_MESSAGE));
          return;
        }
        resolve(parsed);
      } catch {
        reject(fail(400, "invalid_json", INVALID_JSON_MESSAGE));
      }
    });
    req.on("error", () => {
      reject(fail(400, "invalid_json", INVALID_JSON_MESSAGE));
    });
  });
}

function sendPublic(res, req, err, corsHeaders) {
  const pub = toPublicError(err);
  if (pub.status >= 500 && !(err && err.error)) {
    console.error("relayer_error", err instanceof Error ? err.name : "error");
  }
  json(res, req, pub.status, pub.body, corsHeaders, pub.headers);
}

function requestIp(req, trustedProxyHops) {
  return clientIp(req, { trustedProxyHops });
}

/**
 * HTTP control plane. Quote/rescue implementations are injected so unit tests
 * can refuse without live RPC.
 *
 * Rescue limits, when provided, are checked after input validation and before
 * quote RPC or rescue simulation/broadcast. Only a successful rescue consumes
 * a slot. 429 responses use the same CORS headers as the rest of the API.
 *
 * @param {object} deps
 * @param {{ isPaused: Function, pause: Function, unpause: Function }} deps.killSwitch
 * @param {string} [deps.adminSecret]
 * @param {string[] | string} [deps.allowedOrigins]
 * @param {() => Promise<object>} deps.liveStatus
 * @param {(body: object) => Promise<object>} deps.buildQuote
 * @param {(body: object) => Promise<object>} deps.submitRescue
 * @param {ReturnType<import("./rescueLimit.mjs").createRescueLimiter>} [deps.rescueLimiter]
 * @param {number} [deps.chainId]
 * @param {number} [deps.trustedProxyHops]
 */
export function createRelayerApp(deps) {
  const killSwitch = deps.killSwitch;
  const adminSecret = String(deps.adminSecret || "");
  const corsHeaders = deps.corsHeaders || createCors(deps.allowedOrigins || []);
  const liveStatus = deps.liveStatus;
  const buildQuote = deps.buildQuote;
  const submitRescue = deps.submitRescue;
  const limiter = deps.rescueLimiter || null;
  const defaultChainId = Number(deps.chainId ?? 421614);
  const trustedProxyHops = Number.isInteger(deps.trustedProxyHops) ? deps.trustedProxyHops : 1;

  function refuseIfPaused(res, req) {
    if (!killSwitch.isPaused()) return false;
    json(res, req, 503, { ok: false, error: RELAYER_PAUSED, message: RELAYER_PAUSED_MESSAGE }, corsHeaders);
    return true;
  }

  async function healthBody() {
    const live = await liveStatus();
    const body = { ...live, paused: killSwitch.isPaused() };
    if (limiter) {
      body.rescueLimits = { ...limiter.publicConfig(), trustedProxyHops };
    }
    return body;
  }

  return http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders(req));
        res.end();
        return;
      }
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (
        req.method === "GET" &&
        (path === "/" ||
          path === "/health" ||
          path === "/v1/health" ||
          path === "/quotes" ||
          path === "/v1/quotes")
      ) {
        json(res, req, 200, await healthBody(), corsHeaders);
        return;
      }

      if (req.method === "POST" && (path === "/v1/admin/pause" || path === "/v1/admin/unpause")) {
        if (!adminSecret) {
          json(res, req, 404, { ok: false, error: "not_found" }, corsHeaders);
          return;
        }
        if (!adminAuthorized(req, adminSecret)) {
          json(res, req, 401, { ok: false, error: "unauthorized" }, corsHeaders);
          return;
        }
        if (path.endsWith("/pause")) killSwitch.pause();
        else killSwitch.unpause();
        json(res, req, 200, { ok: true, paused: killSwitch.isPaused() }, corsHeaders);
        return;
      }

      if (req.method === "POST" && (path === "/quotes" || path === "/v1/quotes")) {
        if (refuseIfPaused(res, req)) return;
        try {
          const body = await readBody(req);
          const parsed = parseQuoteBody(body, { defaultChainId });
          if (limiter) {
            const decision = await limiter.check(parsed.user, requestIp(req, trustedProxyHops));
            const limited = errorFromLimit(decision);
            if (limited) throw limited;
          }
          json(res, req, 200, await buildQuote(body), corsHeaders);
        } catch (err) {
          sendPublic(res, req, err, corsHeaders);
        }
        return;
      }

      if (req.method === "POST" && path === "/v1/rescues") {
        if (refuseIfPaused(res, req)) return;
        let gate = null;
        try {
          const body = await readBody(req);
          const user = parseRescueUser(body);
          if (limiter) {
            gate = await limiter.begin(user, requestIp(req, trustedProxyHops));
            if (!gate.ok) throw errorFromLimit(gate.decision);
          }
          const result = await submitRescue(body);
          const succeeded = Boolean(result && result.ok !== false && result.txHash);
          if (gate) await gate.finish(succeeded);
          json(res, req, 200, result, corsHeaders);
        } catch (err) {
          if (gate && gate.ok) {
            try {
              await gate.finish(false);
            } catch {
              /* the response still reports the original error */
            }
          }
          sendPublic(res, req, err, corsHeaders);
        }
        return;
      }

      json(res, req, 404, { ok: false, error: "not_found" }, corsHeaders);
    } catch (err) {
      sendPublic(res, req, err, corsHeaders);
    }
  });
}
