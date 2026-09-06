import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AMOUNT_SWAP_LABEL,
  FEE_LABEL,
  GAS_RECEIVED_LABEL,
  RECEIPT_TITLE,
  REMAINDER_LABEL,
  TX_HASH_LABEL,
} from "../copy";
import { RescueReceipt } from "../RescueReceipt";
import { sampleFixtureQuote } from "./fixture";
import { formatNativeOut, formatTokenAmountWithSymbol } from "./format";
import { buildOrder } from "./order";
import { RECEIPT_FIELDS, receiptFromSubmit } from "./receipt";
import { submitRescue, type RescueSubmitResult } from "./rescues";

const TX = `0x${"ab".repeat(32)}` as const;

describe("receiptFromSubmit", () => {
  it("maps a successful /v1/rescues txHash plus quote amounts onto the receipt", async () => {
    const quote = sampleFixtureQuote();
    const withOut = { ...quote, amountOut: 10n ** 14n };
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ ok: true, txHash: TX, stubRpc: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const result = await submitRescue(
      "http://relayer.test",
      {
        chainId: 84532,
        order: buildOrder({ quote }),
        orderSignature: (`0x${"11".repeat(65)}`) as `0x${string}`,
        permitV: 28,
        permitR: (`0x${"11".repeat(32)}`) as `0x${string}`,
        permitS: (`0x${"22".repeat(32)}`) as `0x${string}`,
      },
      fetchImpl,
    );

    const receipt = receiptFromSubmit(withOut, result);
    expect(result.ok).toBe(true);
    expect(receipt).not.toBeNull();
    expect(receipt?.txHash).toBe(TX);
    expect(receipt?.amountSwap).toBe(quote.amountSwap);
    expect(receipt?.gasReceived).toBe(10n ** 14n);
    expect(receipt?.feeAmount).toBe(quote.feeAmount);
    expect(receipt?.amountRemainder).toBe(quote.amountRemainder);
    for (const field of RECEIPT_FIELDS) {
      expect(receipt?.[field]).not.toBeUndefined();
    }
  });

  it("does not build a receipt from a failed Relayer response", () => {
    const quote = sampleFixtureQuote();
    const failed: RescueSubmitResult = { ok: false, reason: "HTTP 502" };
    expect(receiptFromSubmit(quote, failed)).toBeNull();
  });

  it("uses min native out when the quote has no amountOut", () => {
    const quote = sampleFixtureQuote();
    const receipt = receiptFromSubmit(quote, { ok: true, txHash: TX, stubRpc: false });
    expect(receipt?.gasReceived).toBe(quote.minAmountOut);
  });
});

describe("RescueReceipt screen", () => {
  it("renders tx hash, amount swapped, gas received, fee, and remainder without throwing", () => {
    const quote = sampleFixtureQuote();
    const receipt = receiptFromSubmit(
      { ...quote, amountOut: 10n ** 14n },
      { ok: true, txHash: TX, stubRpc: false },
    );
    expect(receipt).not.toBeNull();

    const html = renderToStaticMarkup(createElement(RescueReceipt, { receipt: receipt! }));

    expect(html).toContain('data-testid="rescue-receipt"');
    expect(html).toContain(RECEIPT_TITLE);
    expect(html).toContain(TX_HASH_LABEL);
    expect(html).toContain(TX);
    expect(html).toContain(AMOUNT_SWAP_LABEL);
    expect(html).toContain(formatTokenAmountWithSymbol(quote.amountSwap, quote.tokenDecimals, quote.tokenSymbol));
    expect(html).toContain(GAS_RECEIVED_LABEL);
    expect(html).toContain(formatNativeOut(10n ** 14n, quote.chainId));
    expect(html).toContain(FEE_LABEL);
    expect(html).toContain(formatTokenAmountWithSymbol(quote.feeAmount, quote.tokenDecimals, quote.tokenSymbol));
    expect(html).toContain(REMAINDER_LABEL);
    expect(html).toContain(
      formatTokenAmountWithSymbol(quote.amountRemainder, quote.tokenDecimals, quote.tokenSymbol),
    );
    expect(html.toLowerCase()).not.toContain("couldn’t load rescue details");
    expect(html.toLowerCase()).not.toContain("couldn't load rescue details");
  });
});
