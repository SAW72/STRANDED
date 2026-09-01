import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
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
  CANCEL_LABEL,
  CONFIRM_HINT,
  CONFIRMED_HINT,
  FEE_HELPER,
  FEE_LABEL,
  FEE_TO_HELPER,
  FEE_TO_LABEL,
  REVIEW_SUBTITLE,
  REVIEW_TITLE,
  REVIEW_TRUST_LINE,
  SIGN_LOCKED,
  TRY_AGAIN_LABEL,
} from "./copy";
import { CopyAddress } from "./CopyAddress";
import {
  BASE_SEPOLIA_CHAIN_ID,
  gasRescueAddress,
  isBaseSepolia,
  relayerBaseUrl,
  tokenAddress,
} from "./config";
import { formatTokenAmount, parseHumanAmount, shortenAddress } from "./lib/format";
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
import { fetchRescueQuote } from "./lib/quotes";

const DEFAULT_DEADLINE_SECS = 60 * 60;

export function App() {
  const rescue = gasRescueAddress();
  const token = tokenAddress();
  const relayer = relayerBaseUrl();

  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();

  const onBaseSepolia = isBaseSepolia(chainId);
  const injected = connectors.find((c) => c.id === "injected") ?? connectors[0];

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
    chainId: BASE_SEPOLIA_CHAIN_ID,
    query: { enabled: Boolean(token) },
  });

  const { data: tokenName } = useReadContract({
    address: token ?? undefined,
    abi: erc20PermitAbi,
    functionName: "name",
    chainId: BASE_SEPOLIA_CHAIN_ID,
    query: { enabled: Boolean(token) },
  });

  const { data: tokenDecimals } = useReadContract({
    address: token ?? undefined,
    abi: erc20PermitAbi,
    functionName: "decimals",
    chainId: BASE_SEPOLIA_CHAIN_ID,
    query: { enabled: Boolean(token) },
  });

  const { data: balance } = useReadContract({
    address: token ?? undefined,
    abi: erc20PermitAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    query: { enabled: Boolean(token && address && onBaseSepolia) },
  });

  const { data: permitNonce } = useReadContract({
    address: token ?? undefined,
    abi: erc20PermitAbi,
    functionName: "nonces",
    args: address ? [address] : undefined,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    query: { enabled: Boolean(token && address && onBaseSepolia) },
  });

  const displayDecimals = tokenDecimals ?? 18;
  const requestedAmount = parseHumanAmount(humanAmount, displayDecimals);

  const quoteQuery = useQuery({
    queryKey: ["quotes", relayer, token, address, requestedAmount?.toString() ?? "0"],
    enabled: Boolean(relayer && token && address && requestedAmount && requestedAmount > 0n && onBaseSepolia),
    queryFn: () =>
      fetchRescueQuote(relayer, {
        chainId: BASE_SEPOLIA_CHAIN_ID,
        token: token!,
        amount: requestedAmount!,
        user: address!,
      }),
    retry: false,
  });

  const quote = quoteQuery.data?.ok ? quoteQuery.data.quote : null;
  const quoteStatus = quoteUiStatus({
    hasRelayer: Boolean(relayer),
    connectedOnNetwork: Boolean(address && onBaseSepolia),
    hasAmount: Boolean(requestedAmount && requestedAmount > 0n),
    fetching: quoteQuery.isFetching,
    quoteReady: Boolean(quote),
    fetchFailed: Boolean(
      quoteQuery.isError || (quoteQuery.data !== undefined && !quoteQuery.data.ok),
    ),
  });

  const phase = rescuePhase({
    quote,
    detailsConfirmed,
    signing,
    signed: Boolean(signed),
  });

  useEffect(() => {
    setDetailsConfirmed(false);
    setSigned(null);
    setSignError(null);
  }, [humanAmount, quote?.amount, quote?.feeAmount, quote?.feeTo]);

  const reviewDecimals = quote?.tokenDecimals ?? displayDecimals;

  const orderNonceHint = quote?.nonce;
  const { data: nonceUsed } = useReadContract({
    address: rescue ?? undefined,
    abi: gasRescueAbi,
    functionName: "usedNonces",
    args: address && orderNonceHint !== undefined ? [address, orderNonceHint] : undefined,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    query: { enabled: Boolean(rescue && address && orderNonceHint !== undefined) },
  });

  const fillMax = useCallback(() => {
    if (balance === undefined) return;
    setHumanAmount(formatUnits(balance, displayDecimals));
  }, [balance, displayDecimals]);

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
    if (!canPromptSignatures(phase) || !quote || !address || !token || !rescue) return;
    if (!onBaseSepolia) {
      setSignError("Switch to Base Sepolia (84532) before signing.");
      return;
    }

    const deadline = quote.deadline ?? BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECS);
    const nonce = quote.nonce ?? BigInt(Date.now());
    if (quote.nonce !== undefined && nonceUsed) {
      setSignError("Quote nonce is already used on GasRescue. Request a fresh quote.");
      return;
    }

    const order = buildOrder({ user: address, token, quote, deadline, nonce });
    setSigning(true);
    setSignError(null);
    try {
      const orderSignature = await signTypedDataAsync({
        domain: gasRescueDomain(rescue, BASE_SEPOLIA_CHAIN_ID),
        types: ORDER_TYPES,
        primaryType: "Order",
        message: order,
      });
      const permitSignature = await signTypedDataAsync({
        domain: permitDomain(tokenName ?? "MockERC20Permit", token, BASE_SEPOLIA_CHAIN_ID),
        types: PERMIT_TYPES,
        primaryType: "Permit",
        message: {
          owner: address,
          spender: rescue,
          value: order.amount,
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
    if (!relayer) issues.push("RELAYER_BASE_URL is missing.");
    return issues;
  }, [rescue, token, relayer]);

  return (
    <main className="app">
      <p className="eyebrow">Scout #1 · testnet only</p>
      <h1>GasRescue wallet</h1>
      <p className="lede">
        Base Sepolia testnet. Review the fee, confirm the details, then sign in your wallet. Mainnet
        is not available.
      </p>

      <section className="card">
        <h2>1. Connect</h2>
        {!isConnected ? (
          <div className="row">
            <button
              className="btn btn-primary"
              type="button"
              disabled={!injected || isConnecting}
              onClick={() => injected && connect({ connector: injected, chainId: baseSepolia.id })}
            >
              {isConnecting ? "Connecting…" : "Connect wallet"}
            </button>
            <span className="muted">Injected wallet (MetaMask / Rabby / Coinbase).</span>
          </div>
        ) : (
          <div className="row">
            <span className="mono">{shortenAddress(address!)}</span>
            <span className={onBaseSepolia ? "ok" : "warn"}>
              {onBaseSepolia ? "Base Sepolia" : `Wrong network (${chainId ?? "unknown"})`}
            </span>
            {!onBaseSepolia && (
              <button
                className="btn btn-primary"
                type="button"
                disabled={isSwitching}
                onClick={() => switchChain({ chainId: baseSepolia.id })}
              >
                Switch to Base Sepolia
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
        <h2>2. Stranded token</h2>
        <dl className="kv">
          <dt>Token</dt>
          <dd>{token ? `${tokenSymbol ?? "Token"} · ${shortenAddress(token)}` : "not configured"}</dd>
          <dt>Balance</dt>
          <dd>
            {balance !== undefined
              ? formatTokenAmount(balance, displayDecimals)
              : isConnected && onBaseSepolia
                ? "Reading…"
                : "Connect on Base Sepolia to read balance."}
          </dd>
        </dl>
        <label className="field">
          {AMOUNT_LABEL}
          <input
            inputMode="decimal"
            placeholder="0.0"
            value={humanAmount}
            onChange={(event) => setHumanAmount(event.target.value)}
          />
        </label>
        <button className="btn" type="button" disabled={balance === undefined} onClick={fillMax}>
          Use full balance
        </button>
      </section>

      <section className="card">
        <h2>3. {REVIEW_TITLE}</h2>
        <p className="subtitle">{REVIEW_SUBTITLE}</p>

        <div className="review-list">
          <div className="review-row">
            <div className="review-label">{AMOUNT_LABEL}</div>
            <div className="review-value">
              {quote ? formatTokenAmount(quote.amount, reviewDecimals) : "—"}
            </div>
            <p className="review-help">{AMOUNT_HELPER}</p>
          </div>
          <div className="review-row">
            <div className="review-label">{FEE_LABEL}</div>
            <div className="review-value">
              {quote ? formatTokenAmount(quote.feeAmount, reviewDecimals) : "—"}
            </div>
            <p className="review-help">{FEE_HELPER}</p>
          </div>
          <div className="review-row">
            <div className="review-label">{FEE_TO_LABEL}</div>
            <div className="review-value">
              {quote ? <CopyAddress address={quote.feeTo} /> : "—"}
            </div>
            <p className="review-help">{FEE_TO_HELPER}</p>
          </div>
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
            disabled={signing || (!humanAmount && !detailsConfirmed && !signed)}
            onClick={onCancel}
          >
            {CANCEL_LABEL}
          </button>
          {phase === "confirmed" || phase === "signing" || phase === "signed" ? (
            <span className="ok">{CONFIRMED_HINT}</span>
          ) : (
            <span className="muted">{CONFIRM_HINT}</span>
          )}
        </div>
      </section>

      <section className="card">
        <h2>4. Sign</h2>
        <p className="muted">
          Your wallet will ask you to sign twice: once for the rescue, once to allow the token move.
        </p>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!canPromptSignatures(phase) || signing || !quote}
          onClick={onSign}
        >
          {signing ? "Waiting for signatures…" : "Sign Order and permit"}
        </button>
        {!canPromptSignatures(phase) && (
          <div className="banner banner-block">
            {SIGN_LOCKED}
          </div>
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
