#!/usr/bin/env bash
# Mutation proof for the tDEMO drip amount, the 24h cooldown, the empty revert,
# and the router payout cap. Each mutation must make the named test fail.
# Restores the originals on exit. Not part of `forge test`.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

faucet="src/TestDemoFaucet.sol"
router="src/LockedDemoSwapRouter.sol"
backup="$(mktemp -d)"
cp "$faucet" "$backup/TestDemoFaucet.sol"
cp "$router" "$backup/LockedDemoSwapRouter.sol"

restore() {
  cp "$backup/TestDemoFaucet.sol" "$faucet"
  cp "$backup/LockedDemoSwapRouter.sol" "$router"
}
trap restore EXIT

expect_fail() {
  local test_name="$1"
  local label="$2"
  set +e
  forge test --match-test "$test_name" --no-match-test "testFuzz" -q
  local status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    echo "MUTATION SURVIVED ($label): $test_name"
    exit 1
  fi
  echo "MUTATION CAUGHT ($label): $test_name"
}

echo "baseline"
forge test --match-contract TestDemoTest --no-match-test "testFuzz" -q

echo "mutation: drip 3 ether"
cp "$backup/TestDemoFaucet.sol" "$faucet"
perl -0pi -e 's/DRIP_AMOUNT = 2 ether/DRIP_AMOUNT = 3 ether/' "$faucet"
expect_fail test_drip_paysExactlyTwo "drip-amount"

echo "mutation: cooldown 1 hour"
cp "$backup/TestDemoFaucet.sol" "$faucet"
perl -0pi -e 's/COOLDOWN = 1 days/COOLDOWN = 1 hours/' "$faucet"
expect_fail test_secondDrip_revertsUntil24h "cooldown"

echo "mutation: drop the empty guard"
cp "$backup/TestDemoFaucet.sol" "$faucet"
perl -0pi -e 's/if \(token\.balanceOf\(address\(this\)\) < DRIP_AMOUNT\) revert FaucetEmpty\(\);/if (false) revert FaucetEmpty();/' "$faucet"
expect_fail test_empty_revertsFaucetEmpty "empty"

echo "mutation: drop the payout cap"
cp "$backup/LockedDemoSwapRouter.sol" "$router"
perl -0pi -e 's/if \(ethOut > maxPayout\) ethOut = maxPayout;/if (false \&\& ethOut > maxPayout) ethOut = maxPayout;/' "$router"
expect_fail test_quote_aboveTwoTokens_isCapped "max-payout"

cp "$backup/TestDemoFaucet.sol" "$faucet"
cp "$backup/LockedDemoSwapRouter.sol" "$router"
echo "restored"
forge test --match-contract TestDemoTest --no-match-test "testFuzz" -q
echo "mutation proof passed"
