// @vitest-environment jsdom
import { act, type ReactElement } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RescueGuide } from "./RescueGuide";

async function render(ui: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(ui);
  });
  return {
    container: host,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("rescue guide", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("explains the rescue path, the points record, and the badges", async () => {
    const view = await render(<RescueGuide />);
    const text = view.container.textContent ?? "";
    const steps = [...view.container.querySelectorAll("[data-testid='guide-step']")].map((node) => node.textContent ?? "");
    expect(steps[0]).toContain("Get tDEMO");
    expect(steps[0]).toContain("tDEMO has no value");
    expect(steps[1]).toContain("Nothing moves until you confirm");
    expect(steps[2]).toContain("the rescue can pay its own gas");
    expect(steps[3]).toContain("One rescue for each wallet every 4 hours");
    expect(text).toContain("Your wallet records 100 points when your rescue confirms.");
    expect(text).toContain("The relayer that sent the rescue records 50 points.");
    expect(text).toContain("They have no value");
    const badges = [...view.container.querySelectorAll("[data-testid='guide-badge']")].map((node) => node.textContent ?? "");
    expect(badges[0]).toContain("Lantern");
    expect(badges[0]).toContain("1 rescue");
    expect(badges[2]).toContain("Beacon");
    expect(badges[4]).toContain("Keep");
    expect(badges[4]).toContain("25 rescues");
    expect(view.container.querySelector("a[href='#rescue']")?.textContent).toBe("Start a rescue");
    expect(view.container.querySelector("a[href='/points']")?.textContent).toBe("See who has the most points");
    expect(text.toLowerCase()).not.toContain("reward");
    expect(text).not.toMatch(/\bearn/i);
    await view.unmount();
  });
});
