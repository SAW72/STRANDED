import { useState } from "react";
import { COPIED_LABEL, COPY_LABEL } from "./copy";
import { shortenAddress } from "./lib/format";

export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className="copy-address">
      <span className="mono" title={address}>
        {shortenAddress(address)}
      </span>
      <button className="btn btn-compact" type="button" onClick={onCopy}>
        {copied ? COPIED_LABEL : COPY_LABEL}
      </button>
    </span>
  );
}
