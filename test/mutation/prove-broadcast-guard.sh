#!/usr/bin/env bash
# Mutation proof for the tDEMO broadcast gate.
# Each mutant must fail a named test, or, for the `_isBroadcast` wiring,
# fail test/ci/prove-real-broadcast-context.sh (a real `forge script --broadcast`
# on local anvil, not an override).
# Restores the script on exit. Not part of `forge test`.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

script="script/TestDemoSupply.s.sol"
backup="$(mktemp)"
cp "$script" "$backup"

restore() {
  cp "$backup" "$script"
}
trap restore EXIT

expect_fail_in() {
  local contract="$1"
  local test_name="$2"
  local label="$3"
  local log
  log="$(mktemp)"
  set +e
  forge test --match-contract "$contract" --match-test "$test_name" >"$log" 2>&1
  local status=$?
  set -e
  cat "$log"
  if grep -F "Compiler run failed" "$log" >/dev/null; then
    echo "MUTATION DID NOT COMPILE ($label)"
    exit 1
  fi
  if [[ "$status" -eq 0 ]]; then
    echo "MUTATION SURVIVED ($label): $test_name"
    exit 1
  fi
  if ! grep -F "$test_name" "$log" >/dev/null; then
    echo "MUTATION NOT ATTRIBUTED ($label): $test_name"
    exit 1
  fi
  echo "MUTATION CAUGHT ($label): $test_name"
}

expect_fail() {
  expect_fail_in TestDemoBroadcastGuardTest "$1" "$2"
}

strip_between() {
  local start="$1"
  local end="$2"
  python3 - "$script" "$start" "$end" <<'PY'
import pathlib, sys
path, start, end = sys.argv[1:]
file = pathlib.Path(path)
text = file.read_text()
i = text.find(start)
j = text.find(end, i + len(start)) if i >= 0 else -1
if i < 0 or j < 0:
    raise SystemExit(f"marker not found: {start!r} .. {end!r}")
file.write_text(text[:i] + text[j:])
PY
}

replace_once() {
  local old="$1"
  local new="$2"
  python3 - "$script" "$old" "$new" <<'PY'
import pathlib, sys
path, old, new = sys.argv[1:]
file = pathlib.Path(path)
text = file.read_text()
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected one occurrence, found {count}: {old!r}")
file.write_text(text.replace(old, new, 1))
PY
}

echo "baseline"
forge test --match-contract TestDemoBroadcastGuardTest -q
echo "baseline a2 cap"
forge test --match-contract TestDemoArbCapTest --match-test "test_a2_" -q

echo "mutation: remove the chain check"
strip_between \
  "        // CHAIN_GUARD: intended chain must be 84532 or 421614 and equal block.chainid."$'\n' \
  "        if (!_isBroadcast()) return;"$'\n'
expect_fail test_broadcast_wrongChain_refuses "chain-check"
cp "$backup" "$script"

echo "mutation: remove the step binding"
strip_between \
  "        // STEP_GUARD: one step id cannot authorize another step."$'\n' \
  "    }"
expect_fail test_broadcast_wrongStep_refuses "step-binding"
cp "$backup" "$script"

echo "mutation: remove the aggregator revert"
strip_between \
  "        // AGGREGATOR_GUARD: this entry never broadcasts, even with a valid step flag."$'\n' \
  "        // SENDER_GUARD: the Foundry default sender and any non-owner are refused."$'\n'
expect_fail test_aggregators_neverBroadcast "aggregator"
cp "$backup" "$script"

echo "mutation: remove the TEST_DEMO_BROADCAST_OK == \"1\" check"
strip_between \
  "        // OK_GUARD: TEST_DEMO_BROADCAST_OK must be exactly \"1\"."$'\n' \
  "        // STEP_GUARD: one step id cannot authorize another step."$'\n'
expect_fail test_broadcast_flagVariants_refuse "ok-flag"
cp "$backup" "$script"

echo "mutation: remove the owner and default-sender checks"
strip_between \
  "        // SENDER_GUARD: the Foundry default sender and any non-owner are refused."$'\n' \
  "        // CHAIN_GUARD: intended chain must be 84532 or 421614 and equal block.chainid."$'\n'
expect_fail test_broadcast_wrongSender_refuses "sender"
cp "$backup" "$script"

echo "mutation: force _isBroadcast() to return false"
replace_once \
  "        return vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);" \
  "        return false;"
proof_log="$(mktemp)"
set +e
bash test/ci/prove-real-broadcast-context.sh >"$proof_log" 2>&1
proof_status=$?
set -e
cat "$proof_log"
if grep -F "Compiler run failed" "$proof_log" >/dev/null; then
  echo "MUTATION DID NOT COMPILE (is-broadcast)"
  exit 1
fi
if [[ "$proof_status" -eq 0 ]]; then
  echo "MUTATION SURVIVED (is-broadcast): prove-real-broadcast-context.sh"
  exit 1
fi
if ! grep -F "FAIL (broadcast-no-flags): output missing BroadcastRefused" "$proof_log" >/dev/null; then
  echo "MUTATION NOT CAUGHT CLEANLY (is-broadcast): anvil proof failed for another reason"
  exit 1
fi
echo "MUTATION CAUGHT (is-broadcast): prove-real-broadcast-context.sh"
cp "$backup" "$script"

echo "mutation: remove the eth_chainId check"
strip_between \
  "        // RPC_CHAIN_GUARD: \`--chain-id\` spoofs block.chainid. eth_chainId does not."$'\n' \
  "        if (!_isBroadcast()) return;"$'\n'
rpc_log="$(mktemp)"
set +e
bash test/ci/prove-real-broadcast-context.sh >"$rpc_log" 2>&1
rpc_status=$?
set -e
cat "$rpc_log"
if grep -F "Compiler run failed" "$rpc_log" >/dev/null; then
  echo "MUTATION DID NOT COMPILE (rpc-chain)"
  exit 1
fi
if [[ "$rpc_status" -eq 0 ]]; then
  echo "MUTATION SURVIVED (rpc-chain): prove-real-broadcast-context.sh"
  exit 1
fi
if ! grep -E "FAIL \(chain-spoof-b1\)|FAIL \(chain-spoof-b2\)" "$rpc_log" >/dev/null; then
  echo "MUTATION NOT CAUGHT CLEANLY (rpc-chain): anvil proof failed for another reason"
  exit 1
fi
echo "MUTATION CAUGHT (rpc-chain): prove-real-broadcast-context.sh"
cp "$backup" "$script"

echo "mutation: remove the A2 maxPayout cap"
strip_between \
  "            // A2_CAP_GUARD: 2 tDEMO pays the live maxPayout until A3 lowers it."$'\n' \
  "        } else {"$'\n'
expect_fail_in TestDemoArbCapTest test_a2_refusesHighCap "a2-cap"
cp "$backup" "$script"

echo "mutation: turn the A2 cap compare from <= into <"
replace_once \
  "LockedDemoSwapRouter(payable(ARB_ROUTER)).maxPayout() <= ARB_RECOMMENDED_MAX_PAYOUT, \"A2: sign A3 first\"" \
  "LockedDemoSwapRouter(payable(ARB_ROUTER)).maxPayout() < ARB_RECOMMENDED_MAX_PAYOUT, \"A2: sign A3 first\""
expect_fail_in TestDemoArbCapTest test_a2_acceptsExact1e14Cap "a2-cap-boundary"
cp "$backup" "$script"

echo "restored"
forge test --match-contract TestDemoBroadcastGuardTest -q
echo "mutation proof passed"
