import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  POINTS_ACTION_OTHER,
  POINTS_ACTION_REGISTRY_CLAIM,
  POINTS_ACTION_REGISTRY_FIND,
  POINTS_ACTION_RELAYER_JOB,
  POINTS_ACTION_RESCUE,
  POINTS_ACTION_SESSION,
  POINTS_ADDRESS_LABEL,
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
import { shortenBytes32 } from "./lib/format";
import {
  createPointsClient,
  normaliseWalletAddress,
  type PointsClient,
  type WalletPoints,
} from "./lib/points";

const ACTION_LABELS: Record<string, string> = {
  rescue: POINTS_ACTION_RESCUE,
  relayer_job: POINTS_ACTION_RELAYER_JOB,
  registry_find: POINTS_ACTION_REGISTRY_FIND,
  registry_claim: POINTS_ACTION_REGISTRY_CLAIM,
  session: POINTS_ACTION_SESSION,
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

function isEmptyResult(result: WalletPoints): boolean {
  const categories = result.categories.filter((category) => isListedAction(category.action));
  const entries = result.entries.filter((entry) => isListedAction(entry.action));
  return categories.length === 0 && entries.length === 0;
}

export function Points({ client }: { client?: PointsClient }) {
  const api = client ?? createPointsClient();
  const [input, setInput] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ kind: "idle" });
  const requestId = useRef(0);

  useEffect(() => {
    document.title = "Stranded · " + POINTS_TITLE;
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const wallet = normaliseWalletAddress(input);
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
      <section data-testid="points-how">
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
          {/* Total and rank stay hidden until category weights are set. */}
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
