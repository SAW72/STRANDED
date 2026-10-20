import {
  POINTS_BADGE_BEACON,
  POINTS_BADGE_FLARE,
  POINTS_BADGE_HARBOR,
  POINTS_BADGE_KEEP,
  POINTS_BADGE_LANTERN,
} from "../copy";

export type RescueBadge = {
  id: "lantern" | "flare" | "beacon" | "harbor" | "keep";
  name: string;
  minRescues: number;
};

/** Highest badge whose rescue count the wallet has reached. */
export const RESCUE_BADGES: readonly RescueBadge[] = [
  { id: "lantern", name: POINTS_BADGE_LANTERN, minRescues: 1 },
  { id: "flare", name: POINTS_BADGE_FLARE, minRescues: 3 },
  { id: "beacon", name: POINTS_BADGE_BEACON, minRescues: 5 },
  { id: "harbor", name: POINTS_BADGE_HARBOR, minRescues: 10 },
  { id: "keep", name: POINTS_BADGE_KEEP, minRescues: 25 },
];

export function rescueBadge(count: number): RescueBadge | null {
  if (!Number.isSafeInteger(count) || count < 1) return null;
  let picked: RescueBadge | null = null;
  for (const badge of RESCUE_BADGES) {
    if (count >= badge.minRescues) picked = badge;
  }
  return picked;
}

export function rescueCountLabel(count: number): string {
  if (count === 1) return "1 rescue";
  return `${String(count)} rescues`;
}
