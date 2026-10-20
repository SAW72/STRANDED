// @vitest-environment jsdom
import { act } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { CANCEL_LABEL, PICK_WALLET_TITLE } from "./copy";
import { WalletPicker } from "./WalletPicker";

describe("wallet picker", () => {
  it("keeps the title and cancel on screen with 9 wallets at 320px", async () => {
    window.innerWidth = 320;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const connectors = Array.from({ length: 9 }, (_item, index) => ({
      id: `wallet-${index + 1}`,
      name: `Wallet ${index + 1}`,
    }));
    await act(async () => {
      root.render(
        <WalletPicker
          open
          connectors={connectors}
          onPick={() => undefined}
          onClose={() => undefined}
        />,
      );
    });
    const dialog = container.querySelector("[data-testid='wallet-picker']");
    expect(dialog?.querySelector("h2")?.textContent).toBe(PICK_WALLET_TITLE);
    const cancel = [...(dialog?.querySelectorAll("button") ?? [])].find((button) => button.textContent === CANCEL_LABEL);
    expect(cancel).toBeTruthy();
    expect(dialog?.querySelectorAll(".wallet-picker-item")).toHaveLength(9);
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
