/** Relayer-side pause. Distinct from owner-only GasRescueSwap.pause(). */

export function parseEnvFlag(value) {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * @param {{ initial?: boolean }} [opts]
 */
export function createKillSwitch(opts = {}) {
  let paused = Boolean(opts.initial);
  return {
    isPaused() {
      return paused;
    },
    pause() {
      paused = true;
      return paused;
    },
    unpause() {
      paused = false;
      return paused;
    },
    setPaused(value) {
      paused = Boolean(value);
      return paused;
    },
  };
}

export const RELAYER_PAUSED = "relayer_paused";
