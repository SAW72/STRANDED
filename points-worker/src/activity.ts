/** Flat figures from relayer/points/rubric.mjs FIXED_POINTS. */
export const RESCUE_POINTS = 100;
export const RELAYER_JOB_POINTS = 50;

/**
 * Ledger action ids projected to the strings wallet/src/copy.ts already labels.
 * Points are recorded for activity.
 */
export const CLIENT_ACTION: Record<string, string> = {
  rescue_completed: "rescue",
  relayer_job: "relayer_job",
  registry_find_posted: "registry_find",
  registry_find_claimed: "registry_claim",
};

export const UNSCORED_ACTIONS = ["wallet_session"] as const;

export function clientAction(action: string): string {
  return CLIENT_ACTION[action] ?? action;
}
