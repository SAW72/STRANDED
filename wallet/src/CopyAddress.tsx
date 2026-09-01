import { shortenAddress } from "./lib/format";
import { CopyValue } from "./CopyValue";

export function CopyAddress({ address }: { address: string }) {
  return <CopyValue value={address} display={shortenAddress(address)} title={address} />;
}
