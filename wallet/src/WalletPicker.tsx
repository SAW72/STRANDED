import { useEffect, useId, useRef } from "react";
import {
  BROWSER_WALLET_LABEL,
  CANCEL_LABEL,
  CONNECTING_LABEL,
  TRY_AGAIN_LABEL,
  NO_WALLET_FOUND,
  PICK_WALLET_HELP,
  PICK_WALLET_TITLE,
} from "./copy";
import { isGenericInjectedConnector } from "./lib/connectors";

export type PickerConnector = {
  id: string;
  name: string;
  icon?: string | undefined;
};

export function walletDisplayName(connector: PickerConnector): string {
  if (isGenericInjectedConnector(connector)) return BROWSER_WALLET_LABEL;
  return connector.name;
}

export function WalletPicker<T extends PickerConnector>({
  open,
  connectors,
  pendingId,
  busy = false,
  error,
  onPick,
  onClose,
  onRetry,
}: {
  open: boolean;
  connectors: readonly T[];
  pendingId?: string;
  busy?: boolean;
  error?: string | null;
  onPick: (connector: T) => void;
  onClose: () => void;
  onRetry?: () => void;
}) {
  const titleId = useId();
  const helpId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="wallet-picker-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="wallet-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={helpId}
        data-testid="wallet-picker"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>{PICK_WALLET_TITLE}</h2>
        <p id={helpId} className="muted">
          {PICK_WALLET_HELP}
        </p>
        {connectors.length === 0 ? (
          <p className="danger">{NO_WALLET_FOUND}</p>
        ) : (
          <ul className="wallet-picker-list">
            {connectors.map((connector) => {
              const connecting = pendingId === connector.id;
              return (
                <li key={connector.id}>
                  <button
                    className="btn wallet-picker-item"
                    type="button"
                    data-testid={`wallet-option-${connector.id}`}
                    disabled={busy || Boolean(pendingId)}
                    aria-busy={connecting || undefined}
                    onClick={() => onPick(connector)}
                  >
                    {connector.icon ? (
                      <img src={connector.icon} alt="" width={28} height={28} />
                    ) : (
                      <span className="wallet-picker-glyph" aria-hidden="true">
                        {walletDisplayName(connector).slice(0, 1)}
                      </span>
                    )}
                    <span>{walletDisplayName(connector)}</span>
                    {connecting ? <span className="muted">{CONNECTING_LABEL}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error ? <p className="danger">{error}</p> : null}
        <div className="row">
          {error && onRetry ? (
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => {
                onRetry();
              }}
            >
              {TRY_AGAIN_LABEL}
            </button>
          ) : null}
          <button className="btn" type="button" onClick={onClose}>
            {CANCEL_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
}
