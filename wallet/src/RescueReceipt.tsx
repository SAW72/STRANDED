import type { ReactNode } from "react";
import {
  AMOUNT_SWAP_HELPER,
  AMOUNT_SWAP_LABEL,
  ANOTHER_RESCUE_LABEL,
  FEE_HELPER,
  FEE_LABEL,
  GAS_RECEIVED_HELPER,
  GAS_RECEIVED_LABEL,
  RECEIPT_SUBTITLE,
  RECEIPT_TITLE,
  REMAINDER_HELPER,
  REMAINDER_LABEL,
  TX_HASH_HELPER,
  TX_HASH_LABEL,
} from "./copy";
import { CopyValue } from "./CopyValue";
import { formatNativeOut, formatTokenAmountWithSymbol } from "./lib/format";
import type { RescueReceiptView } from "./lib/receipt";

function Row({ label, value, help }: { label: string; value: ReactNode; help: string }) {
  return (
    <div className="review-row">
      <div className="review-label">{label}</div>
      <div className="review-value">{value}</div>
      <p className="review-help">{help}</p>
    </div>
  );
}

export function RescueReceipt({
  receipt,
  onDone,
}: {
  receipt: RescueReceiptView;
  onDone?: () => void;
}) {
  const { tokenDecimals: decimals, tokenSymbol: symbol, chainId } = receipt;
  const txDisplay = receipt.txHash ?? (receipt.stubRpc ? "Not broadcast (sample Relayer)" : "Pending hash");

  return (
    <section className="card" data-testid="rescue-receipt" aria-live="polite">
      <h2>{RECEIPT_TITLE}</h2>
      <p className="subtitle">{RECEIPT_SUBTITLE}</p>
      <div className="banner banner-ok" role="status">
        {RECEIPT_TITLE}
      </div>
      <div className="review-list">
        <Row
          label={TX_HASH_LABEL}
          value={
            receipt.txHash ? (
              <CopyValue value={receipt.txHash} display={receipt.txHash} title={receipt.txHash} />
            ) : (
              <span className="mono">{txDisplay}</span>
            )
          }
          help={TX_HASH_HELPER}
        />
        <Row
          label={AMOUNT_SWAP_LABEL}
          value={formatTokenAmountWithSymbol(receipt.amountSwap, decimals, symbol)}
          help={AMOUNT_SWAP_HELPER}
        />
        <Row
          label={GAS_RECEIVED_LABEL}
          value={formatNativeOut(receipt.gasReceived, chainId)}
          help={GAS_RECEIVED_HELPER}
        />
        <Row
          label={FEE_LABEL}
          value={formatTokenAmountWithSymbol(receipt.feeAmount, decimals, symbol)}
          help={FEE_HELPER}
        />
        <Row
          label={REMAINDER_LABEL}
          value={formatTokenAmountWithSymbol(receipt.amountRemainder, decimals, symbol)}
          help={REMAINDER_HELPER}
        />
      </div>
      {onDone ? (
        <div className="row">
          <button className="btn btn-primary" type="button" onClick={onDone}>
            {ANOTHER_RESCUE_LABEL}
          </button>
        </div>
      ) : null}
    </section>
  );
}
