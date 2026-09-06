import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatUnits, type Hex } from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
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
  CONNECT_HINT,
  CONNECT_LABEL,
  CONNECTING_LABEL,
  DEADLINE_HELPER,
  DEADLINE_LABEL,
  FEE_HELPER,
  FEE_LABEL,
  FEE_TO_HELPER,
  FEE_TO_LABEL,
  FIXTURE_BANNER,
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
  SUBMIT_RESCUE_ERROR,
  SUBMITTED_RESCUE,
  SUBMITTING_RESCUE,
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
  ARB_SEPOLIA_CHAIN_ID,
  gasRescueAddress,
  isOnSelectedChain,
  relayerUrl,
  tokenAddress,
  type SupportedChainId,
} from "./config";
import {
  connectErrorMessage,
  createConnectGuard,
  orderWalletConnectors,
} from "./lib/connectors";
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
import { readLiveHoldings, readLivePermitAuth, type LiveHoldings } from "./lib/holdings";
import { QUOTES_QUERY_KEY, quoteSessionAfterRescueSuccess } from "./lib/quoteSession";
import { fetchRescueQuote, hasRequiredQuoteFields, type QuoteSource, type RescueQuote } from "./lib/quotes";
import { receiptFromSubmit, type RescueReceiptView } from "./lib/receipt";
import { submitRescue } from "./lib/rescues";
import { RescueReceipt } from "./RescueReceipt";
import {
  StrandedCelebration,
  StrandedHero,
  isFirstRescuePending,
  type CelebrationKind,
} from "./StrandedCelebration";
import { WalletPicker } from "./WalletPicker";
import "./stranded.css";

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
  const [selectedChainId, setSelectedChainId] = useState<SupportedChainId>(ARB_SEPOLIA_CHAIN_ID);
  const relayer = relayerUrl(selectedChainId);
  const useFixture = !relayer;

  const rescue = gasRescueAddress(selectedChainId);
  const token = tokenAddress(selectedChainId);

  const { address, isConnected, chainId } = useAccount();
  const {
    connectAsync,
    connectors,
    isPending: isConnecting,
    error: connectError,
    reset: resetConnect,
    variables: connectVariables,
  } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const publicClient = usePublicClient({ chainId: selectedChainId });

  const onSelectedChain = isOnSelectedChain(chainId, selectedChainId);
  const walletConnectors = useMemo(() => orderWalletConnectors(connectors), [connectors]);
  const selectedViem = viemChain(selectedChainId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const connectGuard = useRef(createConnectGuard());
  const pendingConnectorId =
    isConnecting && connectVariables?.connector && "id" in connectVariables.connector
      ? connectVariables.connector.id
      : undefined;
  const connectInFlight = connectBusy || isConnecting;

  const closePicker = useCallback(() => {
    setPickerOpen(false);
  }, []);

  const pickWallet = useCallback(
    async (connector: (typeof walletConnectors)[number]) => {
      if (!connectGuard.current.tryBegin()) return;
      setConnectBusy(true);
      try {
        // Do not pass chainId here: wagmi would also try to switch chain during
        // the same connect, which MetaMask surfaces as a second permissions request.
        // Never auto-retry on -32002: revoke + a second connectAsync stacks popups.
        const result = await connectAsync({ connector });
        if (result.chainId !== selectedViem.id) {
          await switchChainAsync({ chainId: selectedViem.id }).catch(() => {
            /* user can switch from the Connect card */
          });
        }
      } catch {
        // Error is shown from useConnect(). Unlock so the user can try again.
      } finally {
        connectGuard.current.end();
        setConnectBusy(false);
      }
    },
    [connectAsync, selectedViem.id, switchChainAsync],
  );

  useEffect(() => {
    if (isConnected) {
      connectGuard.current.end();
      setConnectBusy(false);
      setPickerOpen(false);
    }
  }, [isConnected]);

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
  const [submitState, setSubmitState] = useState<
    { kind: "idle" } | { kind: "posting" } | { kind: "ok"; txHash: Hex | null } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [receipt, setReceipt] = useState<RescueReceiptView | null>(null);
  const [celebration, setCelebration] = useState<CelebrationKind>(null);
  const [awaitingFreshHoldings, setAwaitingFreshHoldings] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const play = new URLSearchParams(window.location.search).get("play");
    if (play === "first") setCelebration("first");
    else if (play === "1" || play === "rescue") setCelebration("rescue");
  }, []);

  const { data: tokenSymbol } = useReadContract({
    address: token ?? undefined,
    abi: erc20PermitAbi,
    functionName: "symbol",
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

  const [tokenBalance, setTokenBalance] = useState<bigint | undefined>();

  const displayDecimals = tokenDecimals ?? 18;

  const refreshHoldings = useCallback(async (): Promise<LiveHoldings | undefined> => {
    if (!publicClient || !token || !address || !onSelectedChain) return undefined;
    // Live eth_call — wagmi/react-query cache served pre-mint / pre-rescue GRTT.
    const next = await readLiveHoldings(publicClient, token, address);
    setTokenBalance(next.tokenBalance);
    return next;
  }, [publicClient, token, address, onSelectedChain]);

  useEffect(() => {
    if (!address || !onSelectedChain || !token) {
      setTokenBalance(undefined);
      return;
    }
    void refreshHoldings();
  }, [address, onSelectedChain, token, selectedChainId, refreshHoldings]);

  const requestedAmount = parseHumanAmount(humanAmount, displayDecimals);

  const liveEnabled = Boolean(
    !useFixture &&
      !receipt &&
      relayer &&
      token &&
      address &&
      requestedAmount &&
      requestedAmount > 0n &&
      onSelectedChain,
  );

  const quoteQuery = useQuery({
    queryKey: [
      QUOTES_QUERY_KEY,
      relayer,
      selectedChainId,
      token,
      address,
      requestedAmount?.toString() ?? "0",
    ],
    enabled: liveEnabled && !detailsConfirmed && !signing && !signed,
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
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
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
    document.title = `Stranded · ${chainLabel(selectedChainId)}`;
  }, [selectedChainId]);

  useEffect(() => {
    if (receipt) return;
    setDetailsConfirmed(false);
    setSigned(null);
    setSignError(null);
    setSubmitState({ kind: "idle" });
  }, [humanAmount, selectedChainId, token, receipt]);

  const reviewDecimals = quote?.tokenDecimals ?? displayDecimals;
  const reviewSymbol = quote?.tokenSymbol;

  const orderNonceHint = quote?.nonce;
  const { data: nonceUsed, refetch: refetchNonceUsed } = useReadContract({
    address: rescue ?? undefined,
    abi: gasRescueAbi,
    functionName: "usedNonces",
    args: address && orderNonceHint !== undefined ? [address, orderNonceHint] : undefined,
    chainId: selectedChainId,
    query: { enabled: Boolean(rescue && address && orderNonceHint !== undefined && !useFixture) },
  });

  const fillMax = useCallback(async () => {
    // Live eth_call at click — cached balanceOf filled a pre-mint / pre-rescue amount.
    const next = await refreshHoldings();
    if (!next) return;
    setHumanAmount(formatUnits(next.tokenBalance, displayDecimals));
  }, [refreshHoldings, displayDecimals]);

  function selectChain(next: SupportedChainId) {
    setSelectedChainId(next);
    if (isConnected && chainId !== next) {
      switchChain({ chainId: next });
    }
  }

  function onCancel() {
    setSignError(null);
    if (receipt) {
      setAwaitingFreshHoldings(true);
      void (async () => {
        try {
          // Live eth_call — cached holdings after rescue quoted the old amount / nonce.
          await refreshHoldings();
        } finally {
          setReceipt(null);
          setSubmitState({ kind: "idle" });
          setSigned(null);
          setDetailsConfirmed(false);
          setHumanAmount("");
          queryClient.removeQueries({ queryKey: [QUOTES_QUERY_KEY] });
          setAwaitingFreshHoldings(false);
        }
      })();
      return;
    }
    if (detailsConfirmed || signed) {
      setDetailsConfirmed(false);
      setSigned(null);
      return;
    }
    setHumanAmount("");
  }

  async function onSign() {
    if (signing || awaitingFreshHoldings || submitState.kind === "posting") return;
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
      setSignError("Quote nonce is already used on Stranded. Request a fresh quote.");
      return;
    }
    if (tokenBalance !== undefined && quote.amountIn > tokenBalance) {
      setSignError(
        "Amount is larger than the token balance in this wallet. Lower the amount and request a fresh quote.",
      );
      return;
    }

    if (!publicClient) {
      setSignError("RPC is not ready. Switch to Arb Sepolia and try again.");
      return;
    }

    const order = buildOrder({ quote });
    setSigning(true);
    setSignError(null);
    try {
      // Live name() + nonces() — cached "MockERC20Permit" / spent nonce → ERC2612InvalidSigner 0x4b800e46.
      const permitAuth = await readLivePermitAuth(publicClient, token, address);
      const orderSignature = await signTypedDataAsync({
        domain: gasRescueDomain(rescue, selectedChainId),
        types: ORDER_TYPES,
        primaryType: "Order",
        message: order,
      });
      const permitSignature = await signTypedDataAsync({
        domain: permitDomain(permitAuth.tokenName, token, selectedChainId),
        types: PERMIT_TYPES,
        primaryType: "Permit",
        message: {
          owner: address,
          spender: rescue,
          value: order.amountIn,
          nonce: permitAuth.permitNonce,
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
      let postedOk = useFixture || !relayer;
      if (relayer && !useFixture) {
        setSubmitState({ kind: "posting" });
        const submitted = await submitRescue(relayer, {
          chainId: selectedChainId,
          order,
          orderSignature,
          permitV: permit.v,
          permitR: permit.r,
          permitS: permit.s,
          swapData: quote.swapData,
        });
        if (submitted.ok) {
          const nextReceipt = receiptFromSubmit(quote, submitted);
          if (nextReceipt) setReceipt(nextReceipt);
          postedOk = true;
          console.info("[rescue] submit ok", submitted.txHash);
          // Spent Order (nonce/sig/minOut/deadline) must not linger — UsedNonce on replay.
          const cleared = quoteSessionAfterRescueSuccess();
          setSigned(cleared.signed);
          setDetailsConfirmed(cleared.detailsConfirmed);
          setSignError(cleared.signError);
          setSubmitState({ kind: "ok", txHash: submitted.txHash });
          queryClient.removeQueries({ queryKey: [QUOTES_QUERY_KEY] });
          setAwaitingFreshHoldings(true);
          await Promise.all([refreshHoldings(), refetchNonceUsed()]);
          setAwaitingFreshHoldings(false);
        } else {
          setSubmitState({ kind: "error", message: submitted.reason });
          setSigned(null);
          postedOk = false;
          console.error("[rescue] submit failed", submitted.reason);
        }
      }
      if (postedOk) {
        setCelebration(isFirstRescuePending() ? "first" : "rescue");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Signature rejected.";
      console.error("[rescue] sign/submit threw", error);
      setSignError(message);
      setSigned(null);
    } finally {
      setSigning(false);
      setAwaitingFreshHoldings(false);
    }
  }

  const configProblems = useMemo(() => {
    const issues: string[] = [];
    const onArb = selectedChainId === ARB_SEPOLIA_CHAIN_ID;
    const rescueVar = onArb ? "VITE_GAS_RESCUE_ADDRESS_ARB_SEPOLIA" : "VITE_GAS_RESCUE_ADDRESS";
    const tokenVar = onArb ? "VITE_TOKEN_ADDRESS_ARB_SEPOLIA" : "VITE_TOKEN_ADDRESS";
    const relayerVar = onArb ? "VITE_RELAYER_URL_ARB_SEPOLIA" : "VITE_RELAYER_URL";
    if (!rescue) issues.push(`${rescueVar} is missing or not an address.`);
    if (!token) issues.push(`${tokenVar} is missing or not an address.`);
    if (!relayer) issues.push(`${relayerVar} is missing — sample quote mode is available.`);
    return issues;
  }, [rescue, token, relayer, selectedChainId]);

  return (
    <main className="app">
      <StrandedCelebration kind={celebration} onDone={() => setCelebration(null)} />
      <StrandedHero onPlay={() => setCelebration("rescue")} />

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
              data-testid="connect-wallet"
              disabled={connectInFlight && !connectError}
              onClick={() => {
                setPickerOpen(true);
              }}
            >
              {connectInFlight ? CONNECTING_LABEL : CONNECT_LABEL}
            </button>
            <span className="muted">{CONNECT_HINT}</span>
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
        {connectError && !pickerOpen && <p className="danger">{connectErrorMessage(connectError)}</p>}
      </section>

      <WalletPicker
        open={pickerOpen}
        connectors={walletConnectors}
        pendingId={pendingConnectorId}
        busy={connectInFlight}
        error={connectError ? connectErrorMessage(connectError) : null}
        onPick={pickWallet}
        onClose={closePicker}
        onRetry={() => {
          connectGuard.current.end();
          setConnectBusy(false);
          resetConnect();
        }}
      />

      <section className="card">
        <h2>3. Stranded token</h2>
        <dl className="kv">
          <dt>Token</dt>
          <dd>{token ? `${tokenSymbol ?? "Token"} · ${shortenAddress(token)}` : "not configured"}</dd>
          <dt>Balance</dt>
          <dd>
            {tokenBalance !== undefined
              ? formatTokenAmount(tokenBalance, displayDecimals)
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
        <button className="btn" type="button" disabled={tokenBalance === undefined || useFixture} onClick={() => void fillMax()}>
          Use full balance
        </button>
      </section>

      {receipt ? (
        <RescueReceipt
          receipt={receipt}
          onDone={awaitingFreshHoldings ? undefined : onCancel}
        />
      ) : (
      <>
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
          </div>
        )}
        {quoteStatus.kind === "idle" && <p className="muted">{quoteStatus.message}</p>}

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
          Your wallet will ask you to sign twice: the Stranded order (swap-for-gas + move-out),
          then the token permit. MetaMask will show domain StewardGasRescue, version 1.
        </p>
        {quoteSource === "fixture" && (
          <p className="warn">
            You are signing a sample Order. It is not a live Relayer quote.
          </p>
        )}
        <button
          className="btn btn-primary"
          type="button"
          disabled={
            !canPromptSignatures(phase) ||
            signing ||
            !quoteReady ||
            awaitingFreshHoldings ||
            submitState.kind === "posting"
          }
          onClick={onSign}
        >
          {submitState.kind === "posting"
            ? SUBMITTING_RESCUE
            : awaitingFreshHoldings
              ? "Rescued — fetching new quote…"
              : signing
                ? "Waiting for signatures…"
                : "Sign Order and permit"}
        </button>
        {!canPromptSignatures(phase) && (
          <div className="banner banner-block">{quoteReady ? SIGN_LOCKED : SIGN_LOCKED_MISSING}</div>
        )}
        {signError && <p className="danger">{signError}</p>}
        {signed && (
          <div className="banner banner-ok">
            <p>
              {useFixture
                ? "Stranded did it! Sample signatures only — this UI does not send them to the Relayer."
                : submitState.kind === "posting"
                  ? SUBMITTING_RESCUE
                  : submitState.kind === "ok"
                    ? SUBMITTED_RESCUE
                    : "Stranded did it! Signatures are ready."}
            </p>
            {submitState.kind === "ok" && submitState.txHash ? (
              <p className="mono">{submitState.txHash}</p>
            ) : null}
            <pre className="sig">{JSON.stringify(signed, null, 2)}</pre>
          </div>
        )}
        {submitState.kind === "error" && (
          <div className="banner banner-block" role="alert">
            <p className="danger">
              {SUBMIT_RESCUE_ERROR} {submitState.message}
            </p>
          </div>
        )}
      </section>
      </>
      )}

      {configProblems.length > 0 && (
        <p className="footer-note">
          Config: {configProblems.join(" ")} Copy <code>wallet/.env.example</code> to{" "}
          <code>wallet/.env</code>. Never put private keys in the frontend env.
        </p>
      )}
    </main>
  );
}
