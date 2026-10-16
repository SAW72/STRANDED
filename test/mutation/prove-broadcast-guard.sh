#!/usr/bin/env bash
# Mutation proof for the tDEMO broadcast gate: chain check, step binding,
# and the aggregator refuse. Each mutant must fail the named test.
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

expect_fail() {
  local test_name="$1"
  local label="$2"
  set +e
  forge test --match-contract TestDemoBroadcastGuardTest --match-test "$test_name" -q
  local status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    echo "MUTATION SURVIVED ($label): $test_name"
    exit 1
  fi
  echo "MUTATION CAUGHT ($label): $test_name"
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

echo "baseline"
forge test --match-contract TestDemoBroadcastGuardTest -q

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
  "        if (sender == FOUNDRY_DEFAULT_SENDER) revert FoundryDefaultSender();"$'\n'
expect_fail test_aggregators_neverBroadcast "aggregator"
cp "$backup" "$script"

echo "restored"
forge test --match-contract TestDemoBroadcastGuardTest -q
echo "mutation proof passed"
