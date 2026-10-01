import { createRelayerApp } from "../app.mjs";
import { createKillSwitch } from "../killSwitch.mjs";

export async function withServer(deps, fn) {
  const killSwitch = deps.killSwitch || createKillSwitch();
  let quoteCalls = 0;
  let rescueCalls = 0;
  const buildQuote = deps.buildQuote || (async () => ({ quoteId: "q-live", nonce: "1" }));
  const submitRescue =
    deps.submitRescue || (async () => ({ ok: true, txHash: `0x${"ab".repeat(32)}` }));
  const {
    buildQuote: _buildQuote,
    submitRescue: _submitRescue,
    killSwitch: _killSwitch,
    ...rest
  } = deps;
  const server = createRelayerApp({
    liveStatus: async () => ({ ok: true, live: true, chainId: 421614, stubRpc: false }),
    allowedOrigins: ["http://localhost:5173"],
    ...rest,
    killSwitch,
    buildQuote: async (body) => {
      quoteCalls += 1;
      return buildQuote(body);
    },
    submitRescue: async (body) => {
      rescueCalls += 1;
      return submitRescue(body);
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await fn({
      port,
      killSwitch,
      quoteCalls: () => quoteCalls,
      rescueCalls: () => rescueCalls,
      url: `http://127.0.0.1:${port}`,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

export async function req(url, path, init = {}) {
  const res = await fetch(`${url}${path}`, init);
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return { status: res.status, body, headers: res.headers, text };
}
