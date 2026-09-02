import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatUnits, type Hex } from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useSignTypedData,
  useSwitchChain,
} from "wagmi";
import { erc20PermitAbi, gasRescueAbi } from "./abi";
import {
  AMOUNT_HELPER,
  AMOUNT_LABEL,
  AMOUNT_SWAP_HELPER,
  AMOUNT_SWAP_LABEL,
  CANCEL_LABEL,
  CHAIN_SWITCH_HINT,
  CONFIRM_HINT,
  CONFIRMED_HINT,
  DEADLINE_HELPER,
  DEADLINE_LABEL,
  FEE_HELPER,
  FEE_LABEL,
  FEE_TO_HELPER,
  FEE_TO_LABEL,
  FIXTURE_BANNER,
  FIXTURE_HELP,
  MIN_OUT_HELPER,
  MIN_OUT_LABEL,
  NATIVE_TO_HELPER,
  NATIVE_TO_LABEL,
  NETWORK_HELPER,
  NETWORK_LABEL,
  NONCE_HELPER,
  NONCE_LABEL,
  PATH_HASH_HELPER,
  PATH_HASH_LABEL,
  REMAINDER_HELPER,
  REMAINDER_LABEL,
  REMAINDER_TO_HELPER,
  REMAINDER_TO_LABEL,
  REVIEW_SUBTITLE,
  REVIEW_TITLE,
  REVIEW_TRUST_LINE,
  ROUTER_HELPER,
  ROUTER_LABEL,
  SAMPLE_BADGE,
  SIGN_LOCKED,
  SIGN_LOCKED_MISSING,
  SWITCH_TO_PREFIX,
  TOKEN_HELPER,
  TOKEN_IN_HELPER,
  TOKEN_IN_LABEL,
  TOKEN_LABEL,
  TRY_AGAIN_LABEL,
  USER_HELPER,
  USER_LABEL,
} from "./copy";
import { CopyAddress } from "./CopyAddress";
import { CopyValue } from "./CopyValue";
import {
  BASE_SEPOLIA_CHAIN_ID,
  gasRescueAddress,
  isOnSelectedChain,
  relayerUrl,
  tokenAddress,
  type SupportedChainId,
} from "./config";
import { chainLabel, SUPPORTED_CHAIN_IDS, viemChain } from "./lib/chains";
import { sampleFixtureQuote } from "./lib/fixture";
import {
  formatDeadline,
  formatNativeOut,
  formatNetwork,
  formatTokenAmount,
  formatTokenAmountWithSymbol,
  parseHumanAmount,
  shortenAddress,
  shortenBytes32,
} from "./lib/format";
import { quoteUiStatus } from "./lib/quoteStatus";
import {
  buildOrder,
  gasRescueDomain,
  ORDER_TYPES,
  permitDomain,
  PERMIT_TYPES,
  splitPermitSignature,
} from "./lib/order";
import { canPromptSignatures, rescuePhase } from "./lib/processGate";
import { fetchRescueQuote, hasRequiredQuoteFields, type QuoteSource, type RescueQuote } from "./lib/quotes";

function ReviewRow({
  label,
  value,
  help,
}: {
  label: string;
  value: ReactNode;
  help: string;
}) {
  return (
    <div className="review-row">
      <div className="review-label">{label}</div>
      <div className="review-value">{value}</div>
      <p className="review-help">{help}</p>
    </div>
  );
}

function dashOr(value: ReactNode, ready: boolean): ReactNode {
  return ready ? value : "—";
}

export function App() {
  const relayer = relayerUrl();
  const useFixture = !relayer;
  const [selectedChainId, setSelectedChainId] = useState<SupportedChainId>(BASE_SEPOLIA_CHAIN_ID);

  const rescue = gasRescueAddress(selectedChainId);
  const token = tokenAddress(selectedChainId);

  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();

  const onSelectedChain = isOnSelectedChain(chainId, selectedChainId);
  const injected = connectors.find((c) => c.id === "injected") ?? connectors[0];
  const selectedViem = viemChain(selectedChainId);

  const [humanAmount, setHumanAmount] = useState("");
  const [detailsConfirmed, setDetailsConfirmed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [signed, setSigned] = useState<{
    orderSignature: Hex;
    permitV: number;
    permitR: Hex;
    permitS: Hex;
  } | null>(null);

  const { data: tokenSymbol } = useReadContract({
    address: token ?? undefined,
    abi: erc20PermitAbi,
    functionName: "symbol",
    chainId: selectedChainId,
    query: { enabled: Boolean(token) },
  });

  const { data: tokenName } = useReadContract({
    address: token ?? undefined,
    abi: erc20PermitAbi,
    functionName: "name",
    chainId: selectedChainId,
    query: { enabled: Boolean(token) },
  });

  const { data: tokenDecimals } = useReadContract({
    address: token ?? undefined,
    abi: erc20PermitAbi,
    functionName: "decimals",
    chainId: selectedChainId,
    query: { enabled: Boolean(token) },
  });

  const { data: balance } = useReadContract({
    address: token ?? undefined,
    abi: erc20PermitAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: selectedChainId,
    query: { enabled: Boolean(token && address && onSelectedChain) },
  });

  const { data: permitNonce } = useReadContract({
    address: token ?? undefined,
    abi: erc20PermitAbi,
    functionName: "nonces",
    args: address ? [address] : undefined,
    chainId: selectedChainId,
    query: { enabled: Boolean(token && address && onSelectedChain) },
  });

  const displayDecimals = tokenDecimals ?? 18;
  const requestedAmount = parseHumanAmount(humanAmount, displayDecimals);

  const liveEnabled = Boolean(
    !useFixture &&
      relayer &&
      token &&
      address &&
      requestedAmount &&
      requestedAmount > 0n &&
      onSelectedChain,
  );

  const quoteQuery = useQuery({
    queryKey: [
      "quotes",
      relayer,
      selectedChainId,
      token,
      address,
      requestedAmount?.toString() ?? "0",
    ],
    enabled: liveEnabled,
    queryFn: () =>
      fetchRescueQuote(relayer, {
        user: address!,
        tokenIn: token!,
        amountIn: requestedAmount!,
        chainId: selectedChainId,
        to: address!,
        nativeTo: address!,
        slippageBps: 100,
      }),
    retry: false,
  });

  const liveQuote = quoteQuery.data?.ok ? quoteQuery.data.quote : null;

  const fixtureQuote = useMemo(() => {
    if (!useFixture) return null;
    return sampleFixtureQuote({
      chainId: selectedChainId,
      user: address,
      tokenIn: token ?? undefined,
      tokenSymbol: typeof tokenSymbol === "string" ? tokenSymbol : undefined,
    });
  }, [useFixture, selectedChainId, address, token, tokenSymbol]);

  const quote: RescueQuote | null = useFixture ? fixtureQuote : liveQuote;
  const quoteSource: QuoteSource | null = quote ? (useFixture ? "fixture" : "relayer") : null;
  const quoteReady = hasRequiredQuoteFields(quote);

  const quoteStatus = quoteUiStatus({
    hasRelayer: Boolean(relayer),
    connectedOnNetwork: Boolean(address && onSelectedChain),
    hasAmount: Boolean(requestedAmount && requestedAmount > 0n),
    fetching: quoteQuery.isFetching,
    quoteReady,
    fetchFailed: Boolean(
      !useFixture && (quoteQuery.isError || (quoteQuery.data !== undefined && !quoteQuery.data.ok)),
    ),
    usingFixture: useFixture,
  });

  const phase = rescuePhase({
    quote: quoteReady ? quote : null,
    detailsConfirmed,
    signing,
    signed: Boolean(signed),
  });

  useEffect(() => {
    document.title = `GasRescue · ${chainLabel(selectedChainId)}`;
  }, [selectedChainId]);

  useEffect(() => {
    setDetailsConfirmed(false);
    setSigned(null);
    setSignError(null);
  }, [
    humanAmount,
    selectedChainId,
    quote?.amountIn,
    quote?.amountSwap,
    quote?.feeAmount,
    quote?.feeTo,
    quote?.to,
    quote?.nativeTo,
    quote?.quoteId,
  ]);

  const reviewDecimals = quote?.tokenDecimals ?? displayDecimals;
  const reviewSymbol = quote?.tokenSymbol;

  const orderNonceHint = quote?.nonce;
  const { data: nonceUsed } = useReadContract({
    address: rescue ?? undefined,
    abi: gasRescueAbi,
    functionName: "usedNonces",
    args: address && orderNonceHint !== undefined ? [address, orderNonceHint] : undefined,
    chainId: selectedChainId,
    query: { enabled: Boolean(rescue && address && orderNonceHint !== undefined && !useFixture) },
  });

  const fillMax = useCallback(() => {
    if (balance === undefined) return;
    setHumanAmount(formatUnits(balance, displayDecimals));
  }, [balance, displayDecimals]);

  function selectChain(next: SupportedChainId) {
    setSelectedChainId(next);
    if (isConnected && chainId !== next) {
      switchChain({ chainId: next });
    }
  }

  function onCancel() {
    setSignError(null);
    if (detailsConfirmed || signed) {
      setDetailsConfirmed(false);
      setSigned(null);
      return;
    }
    setHumanAmount("");
  }

  async function onSign() {
    if (!canPromptSignatures(phase) || !quoteReady || !quote || !address || !token || !rescue) return;
    if (!onSelectedChain) {
      setSignError(`Switch to ${chainLabel(selectedChainId)} (${selectedChainId}) before signing.`);
      return;
    }
    if (quote.chainId !== selectedChainId) {
      setSignError("Quote network does not match the selected testnet.");
      return;
    }
    if (quote.nonce !== undefined && nonceUsed) {
      setSignError("Quote nonce is already used on GasRescue. Request a fresh quote.");
      return;
    }

    const order = buildOrder({ quote });
    setSigning(true);
    setSignError(null);
    try {
      const orderSignature = await signTypedDataAsync({
        domain: gasRescueDomain(rescue, selectedChainId),
        types: ORDER_TYPES,
        primaryType: "Order",
        message: order,
      });
      const permitSignature = await signTypedDataAsync({
        domain: permitDomain(tokenName ?? "MockERC20Permit", token, selectedChainId),
        types: PERMIT_TYPES,
        primaryType: "Permit",
        message: {
          owner: address,
          spender: rescue,
          value: order.amountIn,
          nonce: permitNonce ?? 0n,
          deadline: order.deadline,
        },
      });
      const permit = splitPermitSignature(permitSignature);
      setSigned({
        orderSignature,
        permitV: permit.v,
        permitR: permit.r,
        permitS: permit.s,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Signature rejected.";
      setSignError(message);
    } finally {
      setSigning(false);
    }
  }

  const configProblems = useMemo(() => {
    const issues: string[] = [];
    if (!rescue) issues.push("VITE_GAS_RESCUE_ADDRESS is missing or not an address.");
    if (!token) issues.push("VITE_TOKEN_ADDRESS is missing or not an address.");
    if (!relayer) issues.push("VITE_RELAYER_URL is missing — sample quote mode is available.");
    return issues;
  }, [rescue, token, relayer]);

  return (
    <main className="app">
      <p className="eyebrow">Scout #1 · testnet only</p>
      <h1>GasRescue wallet</h1>
      <p className="lede">
        Swap a slice of stranded tokens for native gas, then move the rest out. Base Sepolia or Arb
        Sepolia — pick one. Mainnet is not available.
      </p>

      <section className="card">
        <h2>1. Network</h2>
        <p className="subtitle">{CHAIN_SWITCH_HINT}</p>
        <div className="chain-switch" role="group" aria-label="Rescue testnet">
          {SUPPORTED_CHAIN_IDS.map((id) => (
            <button
              key={id}
              className={`btn ${selectedChainId === id ? "btn-primary" : ""}`}
              type="button"
              aria-pressed={selectedChainId === id}
              onClick={() => selectChain(id)}
            >
              {chainLabel(id)}
            </button>
          ))}
        </div>
        <p className="muted">
          Selected: {formatNetwork(selectedChainId)}. Wallet:{" "}
          {isConnected ? formatNetwork(chainId ?? 0) : "not connected"}.
        </p>
      </section>

      <section className="card">
        <h2>2. Connect</h2>
        {!isConnected ? (
          <div className="row">
            <button
              className="btn btn-primary"
              type="button"
              disabled={!injected || isConnecting}
              onClick={() => injected && connect({ connector: injected, chainId: selectedViem.id })}
            >
              {isConnecting ? "Connecting…" : "Connect wallet"}
            </button>
            <span className="muted">Injected wallet (MetaMask / Rabby / Coinbase).</span>
          </div>
        ) : (
          <div className="row">
            <span className="mono">{shortenAddress(address!)}</span>
            <span className={onSelectedChain ? "ok" : "warn"}>
              {onSelectedChain ? chainLabel(selectedChainId) : `On ${chainId ?? "unknown"}`}
            </span>
            {!onSelectedChain && (
              <button
                className="btn btn-primary"
                type="button"
                disabled={isSwitching}
                onClick={() => switchChain({ chainId: selectedViem.id })}
              >
                {SWITCH_TO_PREFIX} {chainLabel(selectedChainId)}
              </button>
            )}
            <button className="btn" type="button" onClick={() => disconnect()}>
              Disconnect
            </button>
          </div>
        )}
        {connectError && <p className="danger">{connectError.message}</p>}
      </section>

      <section className="card">
        <h2>3. Stranded token</h2>
        <dl className="kv">
          <dt>Token</dt>
          <dd>{token ? `${tokenSymbol ?? "Token"} · ${shortenAddress(token)}` : "not configured"}</dd>
          <dt>Balance</dt>
          <dd>
            {balance !== undefined
              ? formatTokenAmount(balance, displayDecimals)
              : isConnected && onSelectedChain
                ? "Reading…"
                : `Connect on ${chainLabel(selectedChainId)} to read the on-chain balance.`}
          </dd>
        </dl>
        <label className="field">
          {AMOUNT_LABEL}
          <input
            inputMode="decimal"
            placeholder="0.0"
            value={humanAmount}
            onChange={(event) => setHumanAmount(event.target.value)}
            disabled={useFixture}
          />
        </label>
        {useFixture && (
          <p className="muted">
            Sample mode uses the fixture amounts below. Entering a live amount is disabled so we do
            not invent a Relayer price.
          </p>
        )}
        <button className="btn" type="button" disabled={balance === undefined || useFixture} onClick={fillMax}>
          Use full balance
        </button>
      </section>

      <section className="card">
        <h2>4. {REVIEW_TITLE}</h2>
        <p className="subtitle">{REVIEW_SUBTITLE}</p>

        {quoteSource === "fixture" && (
          <div className="banner banner-sample" role="status">
            <strong>{SAMPLE_BADGE}</strong>
            <p>{FIXTURE_BANNER}</p>
          </div>
        )}

        <h3 className="review-heading">What happens to your tokens</h3>
        <div className="review-list">
          <ReviewRow
            label={AMOUNT_LABEL}
            value={dashOr(
              quote ? formatTokenAmountWithSymbol(quote.amountIn, reviewDecimals, reviewSymbol) : null,
              quoteReady,
            )}
            help={AMOUNT_HELPER}
          />
          <ReviewRow
            label={AMOUNT_SWAP_LABEL}
            value={dashOr(
              quote
                ? formatTokenAmountWithSymbol(quote.amountSwap, reviewDecimals, reviewSymbol)
                : null,
              quoteReady,
            )}
            help={AMOUNT_SWAP_HELPER}
          />
          <ReviewRow
            label={REMAINDER_LABEL}
            value={dashOr(
              quote
                ? formatTokenAmountWithSymbol(quote.amountRemainder, reviewDecimals, reviewSymbol)
                : null,
              quoteReady,
            )}
            help={REMAINDER_HELPER}
          />
          <ReviewRow
            label={REMAINDER_TO_LABEL}
            value={dashOr(quote ? <CopyAddress address={quote.to} /> : null, quoteReady)}
            help={REMAINDER_TO_HELPER}
          />
          <ReviewRow
            label={FEE_LABEL}
            value={dashOr(
              quote
                ? formatTokenAmountWithSymbol(quote.feeAmount, reviewDecimals, reviewSymbol)
                : null,
              quoteReady,
            )}
            help={FEE_HELPER}
          />
          <ReviewRow
            label={FEE_TO_LABEL}
            value={dashOr(quote ? <CopyAddress address={quote.feeTo} /> : null, quoteReady)}
            help={FEE_TO_HELPER}
          />
          <ReviewRow
            label={NATIVE_TO_LABEL}
            value={dashOr(quote ? <CopyAddress address={quote.nativeTo} /> : null, quoteReady)}
            help={NATIVE_TO_HELPER}
          />
          <ReviewRow
            label={MIN_OUT_LABEL}
            value={dashOr(
              quote ? formatNativeOut(quote.minAmountOut, quote.chainId) : null,
              quoteReady,
            )}
            help={MIN_OUT_HELPER}
          />
          <ReviewRow
            label={TOKEN_LABEL}
            value={dashOr(
              quote ? `${quote.tokenSymbol} · ${quote.tokenDecimals} decimals` : null,
              quoteReady,
            )}
            help={TOKEN_HELPER}
          />
          <ReviewRow
            label={NETWORK_LABEL}
            value={dashOr(quote ? formatNetwork(quote.chainId) : null, quoteReady)}
            help={NETWORK_HELPER}
          />
        </div>

        <h3 className="review-heading">What you will sign</h3>
        <div className="review-list">
          <ReviewRow
            label={USER_LABEL}
            value={dashOr(quote ? <CopyAddress address={quote.user} /> : null, quoteReady)}
            help={USER_HELPER}
          />
          <ReviewRow
            label={TOKEN_IN_LABEL}
            value={dashOr(quote ? <CopyAddress address={quote.tokenIn} /> : null, quoteReady)}
            help={TOKEN_IN_HELPER}
          />
          <ReviewRow
            label={ROUTER_LABEL}
            value={dashOr(quote ? <CopyAddress address={quote.router} /> : null, quoteReady)}
            help={ROUTER_HELPER}
          />
          <ReviewRow
            label={PATH_HASH_LABEL}
            value={dashOr(
              quote ? (
                <CopyValue
                  value={quote.pathHash}
                  display={shortenBytes32(quote.pathHash)}
                  title={quote.pathHash}
                />
              ) : null,
              quoteReady,
            )}
            help={PATH_HASH_HELPER}
          />
          <ReviewRow
            label={DEADLINE_LABEL}
            value={dashOr(quote ? formatDeadline(quote.deadline) : null, quoteReady)}
            help={DEADLINE_HELPER}
          />
          <ReviewRow
            label={NONCE_LABEL}
            value={dashOr(quote ? quote.nonce.toString() : null, quoteReady)}
            help={NONCE_HELPER}
          />
        </div>

        {quoteStatus.kind === "loading" && (
          <div className="banner" role="status">
            {quoteStatus.message}
          </div>
        )}
        {quoteStatus.kind === "error" && (
          <div className="banner banner-block" role="alert">
            <div className="row">
              <span>{quoteStatus.message}</span>
              <button className="btn btn-compact" type="button" onClick={() => quoteQuery.refetch()}>
                {TRY_AGAIN_LABEL}
              </button>
            </div>
            <p className="review-help">{FIXTURE_HELP}</p>
          </div>
        )}
        {quoteStatus.kind === "idle" && !useFixture && <p className="muted">{quoteStatus.message}</p>}

        <p className="trust-line">{REVIEW_TRUST_LINE}</p>

        <div className="row">
          <button
            className="btn btn-primary"
            type="button"
            disabled={phase !== "review"}
            onClick={() => setDetailsConfirmed(true)}
          >
            Confirm details
          </button>
          <button
            className="btn"
            type="button"
            disabled={signing || (!humanAmount && !useFixture && !detailsConfirmed && !signed)}
            onClick={onCancel}
          >
            {CANCEL_LABEL}
          </button>
          {phase === "confirmed" || phase === "signing" || phase === "signed" ? (
            <span className="ok">{CONFIRMED_HINT}</span>
          ) : (
            <span className="muted">{quoteReady ? CONFIRM_HINT : SIGN_LOCKED_MISSING}</span>
          )}
        </div>
      </section>

      <section className="card">
        <h2>5. Sign</h2>
        <p className="muted">
          Your wallet will ask you to sign twice: the StewardGasRescue Order (swap-for-gas +
          move-out), then the token permit. Domain name StewardGasRescue, version 1.
        </p>
        {quoteSource === "fixture" && (
          <p className="warn">
            You are signing a sample Order. It is not a live Relayer quote.
          </p>
        )}
        <button
          className="btn btn-primary"
          type="button"
          disabled={!canPromptSignatures(phase) || signing || !quoteReady}
          onClick={onSign}
        >
          {signing ? "Waiting for signatures…" : "Sign Order and permit"}
        </button>
        {!canPromptSignatures(phase) && (
          <div className="banner banner-block">{quoteReady ? SIGN_LOCKED : SIGN_LOCKED_MISSING}</div>
        )}
        {signError && <p className="danger">{signError}</p>}
        {signed && (
          <div className="banner banner-ok">
            <p>Signatures captured. Submit them with your Relayer — this UI does not broadcast.</p>
            <pre className="sig">{JSON.stringify(signed, null, 2)}</pre>
          </div>
        )}
      </section>

      {configProblems.length > 0 && (
        <p className="footer-note">
          Config: {configProblems.join(" ")} Copy <code>wallet/.env.example</code> to{" "}
          <code>wallet/.env</code>. Never put private keys in the frontend env.
        </p>
      )}
    </main>
  );
}
