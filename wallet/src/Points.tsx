import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  POINTS_ACTION_OTHER,
  POINTS_ACTION_REGISTRY_CLAIM,
  POINTS_ACTION_REGISTRY_FIND,
  POINTS_ACTION_RELAYER_JOB,
  POINTS_ACTION_RESCUE,
  POINTS_ACTION_SESSION,
  POINTS_ADDRESS_LABEL,
  POINTS_BOARD_EMPTY,
  POINTS_BOARD_ERROR,
  POINTS_BOARD_HEADING,
  POINTS_BOARD_LOADING,
  POINTS_BOARD_NOTE,
  POINTS_ADDRESS_PLACEHOLDER,
  POINTS_ADDRESS_RESULT_LABEL,
  POINTS_BACK_LABEL,
  POINTS_CATEGORIES_LABEL,
  POINTS_DISCLAIMER,
  POINTS_EMPTY,
  POINTS_ENTRIES_LABEL,
  POINTS_EXAMPLE_BADGE,
  POINTS_EXAMPLE_NOTE,
  POINTS_HOW_BODY,
  POINTS_HOW_HEADING,
  POINTS_HOW_STATUS,
  POINTS_INTRO,
  POINTS_INVALID_ADDRESS,
  POINTS_LOAD_ERROR,
  POINTS_LOADING,
  POINTS_LOOKUP_LABEL,
  POINTS_NO_TX,
  POINTS_TITLE,
  POINTS_TX_LABEL,
  POINTS_WEIGHTS_NOTE,
} from "./copy";
import { EXCLUDED_POINTS_ACTIONS } from "../../shared/excludedPointsActions.mjs";
import { chainLabel, isSupportedChainId, transactionUrl } from "./lib/chains";
import { shortenAddress, shortenBytes32 } from "./lib/format";
import {
  createPointsClient,
  normaliseWalletAddress,
  type LeaderboardRow,
  type PointsClient,
  type WalletPoints,
} from "./lib/points";
import { rescueBadge, rescueCountLabel } from "./lib/rescueBadges";

const ACTION_LABELS: Record<string, string> = {
  rescue: POINTS_ACTION_RESCUE,
  relayer_job: POINTS_ACTION_RELAYER_JOB,
  registry_find: POINTS_ACTION_REGISTRY_FIND,
  registry_claim: POINTS_ACTION_REGISTRY_CLAIM,
  session: POINTS_ACTION_SESSION,
  wallet_session: POINTS_ACTION_SESSION,
};

/** Bug reports and security findings are not points actions and are not shown. */
const UNLISTED_ACTIONS = new Set(EXCLUDED_POINTS_ACTIONS);

function isListedAction(action: string): boolean {
  return !UNLISTED_ACTIONS.has(action);
}

export function isPointsRoute(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === "/points";
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? POINTS_ACTION_OTHER;
}

type Lookup =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "empty"; wallet: string }
  | { kind: "error" }
  | { kind: "loaded"; result: WalletPoints };

type Board =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; rows: LeaderboardRow[] };

function byPoints(a: LeaderboardRow, b: LeaderboardRow): number {
  if (a.total !== b.total) return b.total - a.total;
  if (a.wallet < b.wallet) return -1;
  if (a.wallet > b.wallet) return 1;
  return 0;
}

function listedRescueCount(result: WalletPoints): number {
  return result.categories
    .filter((category) => category.action === "rescue" && isListedAction(category.action))
    .reduce((sum, category) => sum + category.count, 0);
}

function isEmptyResult(result: WalletPoints): boolean {
  const categories = result.categories.filter((category) => isListedAction(category.action));
  const entries = result.entries.filter((entry) => isListedAction(entry.action));
  return categories.length === 0 && entries.length === 0;
}

export function Points({ client }: { client?: PointsClient }) {
  const api = client ?? createPointsClient();
  const [input, setInput] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ kind: "idle" });
  const [board, setBoard] = useState<Board>({ kind: "loading" });
  const requestId = useRef(0);

  useEffect(() => {
    const current = client ?? createPointsClient();
    let cancel = false;
    current
      .getLeaderboard()
      .then((result) => {
        if (cancel) return;
        setBoard({ kind: "ready", rows: [...result.rows].sort(byPoints) });
      })
      .catch(() => {
        if (cancel) return;
        setBoard({ kind: "error" });
      });
    return () => {
      cancel = true;
    };
  }, [client]);

  useEffect(() => {
    document.title = "Stranded · " + POINTS_TITLE;
  }, []);

  useEffect(() => {
    if (window.location.hash !== "#how-points-are-recorded") return;
    const node = document.getElementById("how-points-are-recorded");
    if (!node) return;
    let reduce = false;
    try {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      reduce = false;
    }
    node.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, []);

  async function loadWallet(raw: string) {
    const wallet = normaliseWalletAddress(raw);
    if (!wallet) {
      requestId.current += 1;
      setLookup({ kind: "invalid" });
      return;
    }
    const id = requestId.current + 1;
    requestId.current = id;
    setLookup({ kind: "loading" });
    try {
      const result = await api.getWallet(wallet);
      if (requestId.current !== id) return;
      setLookup(isEmptyResult(result) ? { kind: "empty", wallet: result.wallet } : { kind: "loaded", result });
    } catch {
      if (requestId.current !== id) return;
      setLookup({ kind: "error" });
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadWallet(input);
  }

  return (
    <main className="app">
      <p className="points-nav">
        <a href="/" data-testid="points-home">
          {POINTS_BACK_LABEL}
        </a>
      </p>
      <h1>{POINTS_TITLE}</h1>
      <p className="lede">{POINTS_INTRO}</p>
      <p className="points-disclaimer" role="note" data-testid="points-disclaimer">
        {POINTS_DISCLAIMER}
      </p>
      <section className="points-how" id="how-points-are-recorded" data-testid="points-how">
        <h2>{POINTS_HOW_HEADING}</h2>
        <p>{POINTS_HOW_BODY}</p>
        <p>{POINTS_HOW_STATUS}</p>
      </section>
      {api.source === "example" ? (
        <div className="banner banner-sample" role="status" data-testid="points-example">
          <strong>{POINTS_EXAMPLE_BADGE}</strong>
          <p>{POINTS_EXAMPLE_NOTE}</p>
        </div>
      ) : null}
      <PointsBoard
        board={board}
        example={api.source === "example"}
        onPick={(wallet) => {
          setInput(wallet);
          void loadWallet(wallet);
        }}
      />
      <form onSubmit={onSubmit} noValidate>
        <label className="field">
          {POINTS_ADDRESS_LABEL}
          <input
            data-testid="points-address"
            value={input}
            placeholder={POINTS_ADDRESS_PLACEHOLDER}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={lookup.kind === "invalid"}
            aria-describedby={lookup.kind === "invalid" ? "points-address-error" : undefined}
            onChange={(event) => setInput(event.target.value)}
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={lookup.kind === "loading"}>
          {POINTS_LOOKUP_LABEL}
        </button>
      </form>
      {lookup.kind === "invalid" ? (
        <p id="points-address-error" className="danger" role="alert" data-testid="points-invalid">
          {POINTS_INVALID_ADDRESS}
        </p>
      ) : null}
      {lookup.kind === "loading" ? (
        <p role="status" data-testid="points-loading">
          {POINTS_LOADING}
        </p>
      ) : null}
      {lookup.kind === "error" ? (
        <p className="danger" role="alert" data-testid="points-error">
          {POINTS_LOAD_ERROR}
        </p>
      ) : null}
      {lookup.kind === "empty" ? (
        <p role="status" data-testid="points-empty">
          {api.source === "example" ? <ExampleLabel /> : null}
          {POINTS_EMPTY}
        </p>
      ) : null}
      {lookup.kind === "loaded" ? (
        <Loaded result={lookup.result} example={api.source === "example"} />
      ) : null}
    </main>
  );
}

function PointsBoard({
  board,
  example,
  onPick,
}: {
  board: Board;
  example: boolean;
  onPick: (wallet: string) => void;
}) {
  return (
    <section className="points-how" id="most-points" data-testid="points-board">
      <h2>
        {example ? <ExampleLabel /> : null}
        {POINTS_BOARD_HEADING}
      </h2>
      <p>{POINTS_BOARD_NOTE}</p>
      {board.kind === "loading" ? (
        <p role="status" data-testid="points-board-loading">
          {POINTS_BOARD_LOADING}
        </p>
      ) : null}
      {board.kind === "error" ? (
        <p className="danger" role="alert" data-testid="points-board-error">
          {POINTS_BOARD_ERROR}
        </p>
      ) : null}
      {board.kind === "ready" && board.rows.length === 0 ? (
        <p role="status" data-testid="points-board-empty">
          {POINTS_BOARD_EMPTY}
        </p>
      ) : null}
      {board.kind === "ready" && board.rows.length > 0 ? (
        <ol className="points-board">
          {board.rows.map((row, index) => (
            <li className="points-board-row" data-testid="points-board-row" key={row.wallet}>
              <span className="points-place">{String(index + 1)}</span>
              <button
                type="button"
                className="points-board-wallet mono"
                data-testid="points-board-wallet"
                onClick={() => onPick(row.wallet)}
              >
                {shortenAddress(row.wallet)}
              </button>
              <span data-testid="points-board-points">{String(row.total)}</span>
              <RescueBadgeView count={row.rescues} />
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function RescueBadgeView({ count }: { count: number }) {
  const badge = rescueBadge(count);
  if (!badge) return null;
  return (
    <span className={"rescue-badge rescue-badge-" + badge.id} data-testid="rescue-badge">
      <span className="rescue-mark" aria-hidden="true" />
      <span>{badge.name}</span>
      <span className="rescue-count">{rescueCountLabel(count)}</span>
    </span>
  );
}

function ExampleLabel() {
  return (
    <strong className="points-example-mark" data-testid="points-result-example">
      {POINTS_EXAMPLE_BADGE}
    </strong>
  );
}

function Loaded({ result, example }: { result: WalletPoints; example: boolean }) {
  return (
    <section data-testid="points-loaded" aria-live="polite">
      <div data-testid="points-result">
        {example ? <ExampleLabel /> : null}
        <dl className="kv">
          {/* Total stays off this list. */}
          <dt>{POINTS_ADDRESS_RESULT_LABEL}</dt>
          <dd className="mono" data-testid="points-wallet">
            {result.wallet}
          </dd>
        </dl>
      </div>
      <div data-testid="points-result">
        <h2>
          {example ? <ExampleLabel /> : null}
          {POINTS_CATEGORIES_LABEL}
        </h2>
        <p data-testid="points-weights">{POINTS_WEIGHTS_NOTE}</p>
        <ul className="points-list">
          {result.categories.filter((category) => isListedAction(category.action)).map((category, index) => (
            <li className="points-entry" data-testid="points-category" key={category.action + "-" + String(index)}>
              {example ? <ExampleLabel /> : null}
              <span>{actionLabel(category.action)}</span>
              <span>{String(category.points)}</span>
              {category.action === "rescue" ? <RescueBadgeView count={listedRescueCount(result)} /> : null}
            </li>
          ))}
        </ul>
      </div>
      <div data-testid="points-result">
        <h2>
          {example ? <ExampleLabel /> : null}
          {POINTS_ENTRIES_LABEL}
        </h2>
        <ul className="points-list">
          {result.entries.filter((entry) => isListedAction(entry.action)).map((entry, index) => {
            const href =
              entry.txHash && entry.chainId != null ? transactionUrl(entry.chainId, entry.txHash) : null;
            return (
              <li className="points-entry" data-testid="points-entry" key={String(index)}>
                {example ? <ExampleLabel /> : null}
                <span>{actionLabel(entry.action)}</span>
                <span>{String(entry.points)}</span>
                <EntryTx href={href} txHash={entry.txHash} chainId={entry.chainId} />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function EntryTx({
  href,
  txHash,
  chainId,
}: {
  href: string | null;
  txHash: string | null;
  chainId: number | null;
}) {
  let body: ReactNode;
  if (href && txHash) {
    body = (
      <a data-testid="points-tx" href={href} target="_blank" rel="noreferrer">
        {POINTS_TX_LABEL} {shortenBytes32(txHash)}
      </a>
    );
  } else if (txHash) {
    body = <span className="mono">{shortenBytes32(txHash)}</span>;
  } else {
    body = <span>{POINTS_NO_TX}</span>;
  }
  return (
    <span>
      {body}
      {chainId != null && isSupportedChainId(chainId) ? <span className="muted"> {chainLabel(chainId)}</span> : null}
    </span>
  );
}
