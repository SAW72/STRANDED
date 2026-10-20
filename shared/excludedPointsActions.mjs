/** Actions stored on an old ledger, never scored, and rejected on a new write. schema.sql trigger IN lists must match this array. */
export const EXCLUDED_POINTS_ACTIONS = Object.freeze([
  "bug_report",
  "security",
  "security_finding",
  "finding",
  "wallet_session",
]);
