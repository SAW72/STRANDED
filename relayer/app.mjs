import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { RELAYER_PAUSED } from "./killSwitch.mjs";

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

export function json(res, req, status, body, corsHeaders) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders(req),
  });
  res.end(JSON.stringify(body));
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("invalid_json"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

/**
 * HTTP control plane. Quote/rescue implementations are injected so unit tests
 * can refuse without live RPC.
 *
 * @param {object} deps
 * @param {{ isPaused: Function, pause: Function, unpause: Function }} deps.killSwitch
 * @param {string} [deps.adminSecret]
 * @param {string[] | string} [deps.allowedOrigins]
 * @param {() => Promise<object>} deps.liveStatus
 * @param {(body: object) => Promise<object>} deps.buildQuote
 * @param {(body: object) => Promise<object>} deps.submitRescue
 */
export function createRelayerApp(deps) {
  const killSwitch = deps.killSwitch;
  const adminSecret = String(deps.adminSecret || "");
  const corsHeaders = deps.corsHeaders || createCors(deps.allowedOrigins || []);
  const liveStatus = deps.liveStatus;
  const buildQuote = deps.buildQuote;
  const submitRescue = deps.submitRescue;

  function refuseIfPaused(res, req) {
    if (!killSwitch.isPaused()) return false;
    json(res, req, 503, { ok: false, error: RELAYER_PAUSED }, corsHeaders);
    return true;
  }

  async function healthBody() {
    const live = await liveStatus();
    return { ...live, paused: killSwitch.isPaused() };
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
        const body = await readBody(req);
        try {
          json(res, req, 200, await buildQuote(body), corsHeaders);
        } catch (err) {
          const error =
            err.error || (err.message === "insufficient_balance" ? "insufficient_balance" : "request_failed");
          json(res, req, err.status || 500, { ok: false, error }, corsHeaders);
        }
        return;
      }

      if (req.method === "POST" && path === "/v1/rescues") {
        if (refuseIfPaused(res, req)) return;
        const body = await readBody(req);
        try {
          json(res, req, 200, await submitRescue(body), corsHeaders);
        } catch (err) {
          json(
            res,
            req,
            err.status || 500,
            {
              ok: false,
              error: err.error || "request_failed",
              revert: err.revert,
            },
            corsHeaders,
          );
        }
        return;
      }

      json(res, req, 404, { ok: false, error: "not_found" }, corsHeaders);
    } catch (err) {
      console.error("relayer_error", err instanceof Error ? err.message : "internal");
      json(res, req, 500, { ok: false, error: "request_failed" }, corsHeaders);
    }
  });
}
