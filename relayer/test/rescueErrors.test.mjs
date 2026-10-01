import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContractFunctionRevertedError } from "viem";
import {
  PATH_MISMATCH_MESSAGE,
  ROUTER_NOT_ALLOWED_MESSAGE,
  SIMULATION_FAILED_MESSAGE,
  fail,
  simulationFailure,
  toPublicError,
} from "../httpError.mjs";
import { req, withServer } from "./harness.mjs";

const USER = "0x1111111111111111111111111111111111111111";
const ORIGIN = "http://localhost:5173";
const RAW_VIEM =
  'ContractFunctionRevertedError: The contract function "rescueWithPermit" reverted. 0x1111111111111111111111111111111111111111';

function postRescue(url) {
  return req(url, "/v1/rescues", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
    },
    body: JSON.stringify({ order: { user: USER } }),
  });
}

describe("plain rescue error messages", () => {
  it("returns a fixed message for path_mismatch and router_not_allowed", async () => {
    const path = toPublicError(fail(400, "path_mismatch", PATH_MISMATCH_MESSAGE));
    assert.equal(path.status, 400);
    assert.equal(path.body.error, "path_mismatch");
    assert.equal(path.body.message, PATH_MISMATCH_MESSAGE);
    assert.equal(path.body.message, "This rescue quote doesn't match the request. Please get a new quote and try again.");

    const route = toPublicError(fail(400, "router_not_allowed", ROUTER_NOT_ALLOWED_MESSAGE));
    assert.equal(route.status, 400);
    assert.equal(route.body.error, "router_not_allowed");
    assert.equal(route.body.message, ROUTER_NOT_ALLOWED_MESSAGE);
    assert.equal(route.body.message.includes("router"), false);
    assert.equal(route.body.message.includes("0x"), false);

    await withServer(
      {
        submitRescue: async () => {
          throw fail(400, "path_mismatch", PATH_MISMATCH_MESSAGE);
        },
      },
      async ({ url }) => {
        const res = await postRescue(url);
        assert.equal(res.status, 400);
        assert.equal(res.body.error, "path_mismatch");
        assert.equal(res.body.message, "This rescue quote doesn't match the request. Please get a new quote and try again.");
      },
    );

    await withServer(
      {
        submitRescue: async () => {
          throw fail(400, "router_not_allowed", ROUTER_NOT_ALLOWED_MESSAGE);
        },
      },
      async ({ url }) => {
        const res = await postRescue(url);
        assert.equal(res.status, 400);
        assert.equal(res.body.error, "router_not_allowed");
        assert.equal(res.body.message, "This rescue route isn't available. Please get a new quote and try again.");
      },
    );
  });

  it("keeps simulation_failed's message fixed when the cause is raw viem text", async () => {
    const viemErr = new ContractFunctionRevertedError({
      abi: [],
      functionName: "rescueWithPermit",
      message: RAW_VIEM,
    });
    viemErr.shortMessage = `${RAW_VIEM}\n    at writeContract`;
    viemErr.errorName = "";
    if (viemErr.data && typeof viemErr.data === "object") viemErr.data.errorName = "";

    const mapped = simulationFailure(viemErr);
    const pub = toPublicError(mapped);
    assert.equal(pub.status, 502);
    assert.equal(pub.body.error, "simulation_failed");
    assert.equal(pub.body.message, SIMULATION_FAILED_MESSAGE);
    assert.equal(
      pub.body.message,
      "This rescue wouldn't go through right now. Please get a new quote and try again.",
    );
    assert.equal(pub.body.message.includes("ContractFunctionRevertedError"), false);
    assert.equal(pub.body.message.includes("0x1111111111111111111111111111111111111111"), false);
    assert.equal(pub.body.message.toLowerCase().includes("stack"), false);
    assert.equal(JSON.stringify(pub.body.message).includes(RAW_VIEM), false);

    const withUrl = simulationFailure({
      name: "ContractFunctionRevertedError",
      shortMessage: `${RAW_VIEM} https://rpc.example/SECRETKEY`,
      message: `${RAW_VIEM}\n    at writeContract`,
    });
    const hidden = toPublicError(withUrl);
    assert.equal(hidden.body.message, SIMULATION_FAILED_MESSAGE);
    assert.equal(hidden.body.message.includes("SECRETKEY"), false);
    assert.equal(hidden.body.message.includes("https://"), false);

    await withServer(
      {
        submitRescue: async () => {
          throw simulationFailure(viemErr);
        },
      },
      async ({ url }) => {
        const res = await postRescue(url);
        assert.equal(res.status, 502);
        assert.equal(res.body.error, "simulation_failed");
        assert.equal(res.body.message, SIMULATION_FAILED_MESSAGE);
        assert.equal(String(res.body.message).includes("ContractFunctionRevertedError"), false);
        assert.equal(String(res.body.message).includes("0x1111111111111111111111111111111111111111"), false);
      },
    );
  });
});
