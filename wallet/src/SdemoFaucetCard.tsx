import { useState } from "react";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { ARB_SEPOLIA_CHAIN_ID, sdemoFaucetAddress } from "./config";
import { chainLabel } from "./lib/chains";
import { arbDripFees, dripErrorText } from "./lib/dripGas";

const dripAbi = [
  {
    type: "function",
    name: "drip",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

/**
 * Asks the no-mint tDEMO faucet for 2 tokens. Hidden off Arb Sepolia.
 */
export function SdemoFaucetCard() {
  const faucet = sdemoFaucetAddress();
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const publicClient = usePublicClient({ chainId: ARB_SEPOLIA_CHAIN_ID });
  const [message, setMessage] = useState<string | null>(null);
  const onArb = chainId === ARB_SEPOLIA_CHAIN_ID;

  if (!isConnected || !address) return null;

  async function requestDrip() {
    if (!faucet) return;
    setMessage(null);
    try {
      let baseFee: bigint | null = null;
      if (publicClient && typeof publicClient.getBlock === "function") {
        const block = await publicClient.getBlock();
        baseFee = block.baseFeePerGas ?? null;
      }
      const hash = await writeContractAsync({
        address: faucet,
        abi: dripAbi,
        functionName: "drip",
        chainId: ARB_SEPOLIA_CHAIN_ID,
        ...arbDripFees(baseFee),
      });
      setMessage(`Requested 2 tDEMO. Tx ${hash}`);
    } catch (err) {
      setMessage(dripErrorText(err));
    }
  }

  return (
    <section className="card">
      <h2>Get test tDEMO</h2>
      <p className="muted">
        2 tDEMO per wallet each 24 hours. The faucet cannot mint. It only sends tokens already held by the contract.
        tDEMO has no value.
      </p>
      {!onArb && (
        <button
          className="btn"
          type="button"
          disabled={isSwitching}
          onClick={() => switchChain({ chainId: ARB_SEPOLIA_CHAIN_ID })}
        >
          Switch to {chainLabel(ARB_SEPOLIA_CHAIN_ID)}
        </button>
      )}
      {onArb && !faucet && (
        <p className="warn">The faucet contract is not deployed yet. VITE_SDEMO_FAUCET_ARB_SEPOLIA is unset.</p>
      )}
      {onArb && faucet && (
        <button className="btn btn-primary" type="button" disabled={isPending} onClick={() => void requestDrip()}>
          {isPending ? "Waiting for wallet…" : "Get 2 tDEMO"}
        </button>
      )}
      {message && <p className="muted">{message}</p>}
    </section>
  );
}
