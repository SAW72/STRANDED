import { describe, expect, it } from "vitest";
import { rescueBadge, rescueCountLabel } from "./rescueBadges";

describe("rescue badges", () => {
  it("picks the highest badge the rescue count has reached", () => {
    expect(rescueBadge(0)).toBeNull();
    expect(rescueBadge(1)?.name).toBe("Lantern");
    expect(rescueBadge(2)?.id).toBe("lantern");
    expect(rescueBadge(3)?.name).toBe("Flare");
    expect(rescueBadge(4)?.id).toBe("flare");
    expect(rescueBadge(5)?.name).toBe("Beacon");
    expect(rescueBadge(9)?.id).toBe("beacon");
    expect(rescueBadge(10)?.name).toBe("Harbor");
    expect(rescueBadge(24)?.id).toBe("harbor");
    expect(rescueBadge(25)?.name).toBe("Keep");
    expect(rescueBadge(100)?.id).toBe("keep");
    expect(rescueBadge(1.5)).toBeNull();
    expect(rescueBadge(-1)).toBeNull();
  });

  it("labels one rescue differently from several", () => {
    expect(rescueCountLabel(1)).toBe("1 rescue");
    expect(rescueCountLabel(3)).toBe("3 rescues");
  });
});
