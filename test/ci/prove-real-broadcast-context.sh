#!/usr/bin/env bash
# Prove the production `_isBroadcast()` is true under a real
# `forge script --broadcast`. Local anvil only: chain id 84532, no fork,
# no public RPC, no key, no override of `_isBroadcast`.
#
# Anvil 1.8.5 has no `--unlock`. `--auto-impersonate` (alias `--auto-unlock`)
# lets `forge script --unlocked --sender` send through `eth_sendTransaction`.
# The sender is funded so a transaction that escaped the guard would change
# the block. This proof expects zero transactions.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

RPC="http://127.0.0.1:8545"
SENDER="0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D"
# forge-std VmSafe.ForgeContext.ScriptBroadcast is enum index 6
# (TestGroup=0 … ScriptDryRun=5, ScriptBroadcast=6, ScriptResume=7).
BROADCAST_CONTEXT=6
SWAP="0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688"

if curl -sf --max-time 1 -X POST "$RPC" -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1; then
  echo "FAIL: $RPC is already in use. Stop that process first." >&2
  exit 1
fi

anvil_log="$(mktemp)"
anvil --chain-id 84532 --host 127.0.0.1 --port 8545 \
  --auto-impersonate \
  --fund-accounts "${SENDER}:100" \
  >"$anvil_log" 2>&1 &
anvil_pid=$!

cleanup() {
  if kill -0 "$anvil_pid" 2>/dev/null; then
    kill "$anvil_pid" 2>/dev/null || true
    wait "$anvil_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 50); do
  if cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.1
done
if [[ "$ready" -ne 1 ]]; then
  echo "FAIL: anvil did not accept RPC connections" >&2
  cat "$anvil_log" >&2
  exit 1
fi

chain_id="$(cast chain-id --rpc-url "$RPC")"
if [[ "$chain_id" != "84532" ]]; then
  echo "FAIL: anvil chain id is $chain_id" >&2
  exit 1
fi

block_number() {
  curl -s -X POST "$RPC" -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
}

tx_count() {
  cast rpc eth_getBlockTransactionCountByNumber latest --rpc-url "$RPC"
}

BLOCK0="$(block_number)"
TX0="$(tx_count)"
echo "anvil chain=$chain_id block=$BLOCK0 tx_count=$TX0"

assert_unchanged() {
  local label="$1"
  local block tx
  block="$(block_number)"
  tx="$(tx_count)"
  if [[ "$block" != "$BLOCK0" || "$tx" != "$TX0" ]]; then
    echo "FAIL ($label): anvil moved block=$block tx=$tx (start $BLOCK0 $TX0)"
    exit 1
  fi
  echo "unchanged ($label): block=$block tx=$tx"
}

# $1 log, $2 context index, $3 true|false
context_returned() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, ident, want = sys.argv[1:]
text = open(path, encoding="utf-8", errors="replace").read()
needle = f"VM::isContext({ident})"
idx = text.find(needle)
if idx < 0:
    sys.exit(1)
window = text[idx:idx + 500]
sys.exit(0 if f"[Return] {want}" in window else 1)
PY
}

# $1 label, $2 yes|no (BroadcastRefused expected), then the command.
run_case() {
  local label="$1"
  local expect_refused="$2"
  shift 2
  local log
  log="$(mktemp)"
  set +e
  "$@" >"$log" 2>&1
  local status=$?
  set -e
  echo "----- $label (exit $status) -----"
  cat "$log"
  if [[ "$status" -eq 0 ]]; then
    echo "FAIL ($label): expected a non-zero exit"
    exit 1
  fi
  if grep -F "Compiler run failed" "$log" >/dev/null; then
    echo "FAIL ($label): script did not compile"
    exit 1
  fi
  if [[ "$expect_refused" == "yes" ]]; then
    if ! grep -F "BroadcastRefused" "$log" >/dev/null; then
      echo "FAIL ($label): output missing BroadcastRefused"
      exit 1
    fi
    if ! context_returned "$log" "$BROADCAST_CONTEXT" true; then
      echo "FAIL ($label): production isContext(ScriptBroadcast) was not true"
      exit 1
    fi
  else
    if grep -F "BroadcastRefused" "$log" >/dev/null; then
      echo "FAIL ($label): dry-run hit BroadcastRefused"
      exit 1
    fi
    if ! context_returned "$log" "$BROADCAST_CONTEXT" false; then
      echo "FAIL ($label): dry-run isContext(ScriptBroadcast) was not false"
      exit 1
    fi
    if ! grep -F "call to non-contract address ${SWAP}" "$log" >/dev/null; then
      echo "FAIL ($label): expected the empty-swap failure, not BroadcastRefused"
      exit 1
    fi
  fi
  assert_unchanged "$label"
}

script_cmd=(
  forge script script/TestDemoSupply.s.sol:B4_DelistStaleAllowlist
  --rpc-url "$RPC"
  --sender "$SENDER"
  --unlocked
  --color never
)

echo "case: --broadcast, no env flags"
unset TEST_DEMO_BROADCAST_OK TEST_DEMO_BROADCAST_STEP
run_case broadcast-no-flags yes "${script_cmd[@]}" --broadcast

echo "case: --broadcast, OK=1, wrong step"
unset TEST_DEMO_BROADCAST_OK TEST_DEMO_BROADCAST_STEP
TEST_DEMO_BROADCAST_OK=1 TEST_DEMO_BROADCAST_STEP=B1 \
  run_case broadcast-wrong-step yes "${script_cmd[@]}" --broadcast

echo "case: no --broadcast, same anvil"
unset TEST_DEMO_BROADCAST_OK TEST_DEMO_BROADCAST_STEP
run_case dry-run no "${script_cmd[@]}"

echo "real broadcast context proof passed"
