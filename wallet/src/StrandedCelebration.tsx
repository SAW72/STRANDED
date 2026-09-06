import { useEffect, useMemo, useState } from "react";

export const FIRST_RESCUE_KEY = "gasrescue.strandedFirstRescueDone";

export type CelebrationKind = "rescue" | "first" | null;

type Beat = "run" | "find" | "carry" | "lap" | "victory";

const BEATS: Record<Exclude<CelebrationKind, null>, { beat: Beat; ms: number }[]> = {
  rescue: [
    { beat: "run", ms: 1400 },
    { beat: "find", ms: 900 },
    { beat: "carry", ms: 1400 },
    { beat: "victory", ms: 1200 },
  ],
  first: [
    { beat: "run", ms: 1400 },
    { beat: "find", ms: 1000 },
    { beat: "carry", ms: 1400 },
    { beat: "lap", ms: 2200 },
    { beat: "victory", ms: 2400 },
  ],
};

const SRC: Record<Beat, string> = {
  run: "/stranded/run.webp",
  find: "/stranded/find.webp",
  carry: "/stranded/carry.webp",
  lap: "/stranded/run.webp",
  victory: "/stranded/victory.webp",
};

const ALT: Record<Beat, string> = {
  run: "Stranded the Dalmatian running to the rescue",
  find: "Stranded found the stranded tokens",
  carry: "Stranded carrying the tokens home",
  lap: "Stranded running a victory lap",
  victory: "Stranded cheering",
};

export function isFirstRescuePending(): boolean {
  try {
    return localStorage.getItem(FIRST_RESCUE_KEY) !== "1";
  } catch {
    return true;
  }
}

export function markFirstRescueDone(): void {
  try {
    localStorage.setItem(FIRST_RESCUE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function StrandedHero({ onPlay }: { onPlay: () => void }) {
  return (
    <header className="stranded-hero">
      <img
        className="stranded-hero-pup"
        src="/stranded/idle.webp"
        width={160}
        height={160}
        alt="Stranded, a spotted Dalmatian puppy in a little red fire hat and yellow rescue vest"
      />
      <div>
        <h1>Stranded</h1>
        <p className="lede">
          He finds lost tokens and carries them home. Swap a slice for gas, then the rest comes
          too.
        </p>
        <button className="btn btn-play" type="button" onClick={onPlay}>
          Watch Stranded play
        </button>
      </div>
    </header>
  );
}

export function StrandedCelebration({
  kind,
  onDone,
}: {
  kind: CelebrationKind;
  onDone: () => void;
}) {
  const [beat, setBeat] = useState<Beat>("run");
  const confetti = useMemo(
    () =>
      Array.from({ length: kind === "first" ? 28 : 12 }, (_, i) => ({
        id: i,
        left: `${(i * 37) % 100}%`,
        delay: `${(i % 8) * 0.12}s`,
        dur: `${2.4 + (i % 5) * 0.25}s`,
        color: ["#ff6b6b", "#ffd93d", "#6bcB77", "#4d96ff", "#ff8fab", "#c77dff"][i % 6],
        size: 8 + (i % 5) * 3,
        round: i % 2 === 0,
      })),
    [kind],
  );

  const finish = () => {
    if (kind === "first") markFirstRescueDone();
    onDone();
  };

  useEffect(() => {
    if (!kind) return;
    const seq = BEATS[kind];
    setBeat(seq[0].beat);
    let i = 0;
    let timer: number;
    const step = () => {
      const current = seq[i];
      timer = window.setTimeout(() => {
        i += 1;
        if (i >= seq.length) {
          finish();
          return;
        }
        setBeat(seq[i].beat);
        step();
      }, current.ms);
    };
    step();
    return () => window.clearTimeout(timer);
    // finish is stable for a given kind+onDone
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, onDone]);

  if (!kind) return null;

  const first = kind === "first";

  return (
    <div
      className={`stranded-overlay ${first ? "stranded-overlay-first" : ""}`}
      role="dialog"
      aria-label={first ? "Stranded's first rescue party" : "Stranded bringing tokens home"}
    >
      {confetti.map((bit) => (
        <span
          key={bit.id}
          className="stranded-confetti"
          style={{
            left: bit.left,
            animationDelay: bit.delay,
            animationDuration: bit.dur,
            background: bit.color,
            width: bit.size,
            height: bit.round ? bit.size : bit.size * 0.45,
            borderRadius: bit.round ? "50%" : 2,
          }}
        />
      ))}

      <div className={`stranded-stage stranded-stage-${beat}`}>
        <div className="stranded-house" aria-hidden="true">
          <span className="stranded-house-roof" />
          <span className="stranded-house-door" />
        </div>
        <img className="stranded-pup" src={SRC[beat]} alt={ALT[beat]} />
      </div>

      <p className="stranded-caption">
        {beat === "run" && "Here comes Stranded!"}
        {beat === "find" && "He found the stranded tokens!"}
        {beat === "carry" && "Carrying them home…"}
        {beat === "lap" && "Victory lap!"}
        {beat === "victory" && (first ? "Yay! First rescue!" : "Home safe!")}
      </p>

      <button className="btn btn-primary stranded-skip" type="button" onClick={finish}>
        {first ? "All done!" : "Yay!"}
      </button>
    </div>
  );
}
