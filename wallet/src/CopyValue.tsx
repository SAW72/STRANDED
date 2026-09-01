import { useState } from "react";
import { COPIED_LABEL, COPY_LABEL } from "./copy";

export function CopyValue({
  value,
  display,
  title,
}: {
  value: string;
  display: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className="copy-address">
      <span className="mono" title={title ?? value}>
        {display}
      </span>
      <button className="btn btn-compact" type="button" onClick={onCopy}>
        {copied ? COPIED_LABEL : COPY_LABEL}
      </button>
    </span>
  );
}
