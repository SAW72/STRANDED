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
  BASE_SEPOLIA_CHAIN_ID,
  FEE_HELPER_COPY,
  gasRescueAddress,
  isBaseSepolia,
  relayerBaseUrl,
  tokenAddress,
} from "./config";
import { formatTokenAmount, parseHumanAmount, shortenAddress } from "./lib/format";
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
  const quoteBlockReason = !relayer
    ? "RELAYER_BASE_URL is not set. The sign path is blocked until the Relayer quote exists."
    : quoteQuery.isError
      ? "Relayer GET /quotes failed. Signing is blocked."
      : quoteQuery.data && !quoteQuery.data.ok
        ? quoteQuery.data.reason
        : quoteQuery.isFetching
          ? null
          : requestedAmount && requestedAmount > 0n && onBaseSepolia && address
            ? "Waiting for Relayer GET /quotes."
            : null;

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
        Base Sepolia (84532). Review the Relayer quote, confirm the details, then sign one EIP-712
        Order and one EIP-2612 permit. No mainnet config.
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
          <dd className="mono">{token ? `${tokenSymbol ?? "ERC-20"} · ${token}` : "not configured"}</dd>
          <dt>Balance</dt>
          <dd>
            {balance !== undefined
              ? `${formatTokenAmount(balance, displayDecimals)} (${displayDecimals} decimals)`
              : isConnected && onBaseSepolia
                ? "Reading…"
                : "Connect on Base Sepolia to read balance."}
          </dd>
          <dt>GasRescue</dt>
          <dd className="mono">{rescue ?? "not configured"}</dd>
        </dl>
        <label className="field">
          Amount to rescue
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
        <h2>3. Review rescue</h2>
        <p className="muted">{FEE_HELPER_COPY}</p>
        <p className="muted">Values come from Relayer GET /quotes (feeAmount clamp in rescued token units).</p>

        {quote ? (
          <dl className="kv">
            <dt>amount</dt>
            <dd>
              {formatTokenAmount(quote.amount, reviewDecimals)}{" "}
              <span className="muted">({quote.amount.toString()} raw · {reviewDecimals} decimals)</span>
            </dd>
            <dt>feeAmount</dt>
            <dd>
              {formatTokenAmount(quote.feeAmount, reviewDecimals)}{" "}
              <span className="muted">({quote.feeAmount.toString()} raw)</span>
            </dd>
            <dt>feeTo</dt>
            <dd className="mono">{quote.feeTo}</dd>
          </dl>
        ) : (
          <div className="banner banner-block">
            Quote missing. Signing is blocked.
            {quoteBlockReason ? ` ${quoteBlockReason}` : ""}
          </div>
        )}

        <div className="row">
          <button
            className="btn btn-primary"
            type="button"
            disabled={phase !== "review"}
            onClick={() => setDetailsConfirmed(true)}
          >
            Confirm details
          </button>
          {phase === "confirmed" || phase === "signing" || phase === "signed" ? (
            <span className="ok">Details confirmed. Signature prompts may proceed.</span>
          ) : (
            <span className="muted">Confirm the quote before any wallet signature.</span>
          )}
        </div>
      </section>

      <section className="card">
        <h2>4. Sign Order + permit</h2>
        <p className="muted">
          One path only: EIP-712 <code>Order</code>, then EIP-2612 <code>Permit</code>. The permit
          spender is GasRescue; value equals the quoted amount; deadline is shared.
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
            Sign path locked until a Relayer quote exists and you tap Confirm details.
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
