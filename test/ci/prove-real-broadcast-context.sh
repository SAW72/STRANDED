#!/usr/bin/env bash
# Prove the production `_isBroadcast()` is true under a real
# `forge script --broadcast`. Local anvil only: chain id 84532, no fork,
# no public RPC, no key, no override of `_isBroadcast`.
#
# Also proves two things the unit tests cannot see:
# - `--chain-id 84532` against an anvil whose real chain id is 1 is refused
#   on a B1 dry-run and on a B2 broadcast, and the chain-1 anvil does not move.
# - `forge script --resume` does not run the script. A dry-run JSON is replayed
#   with no env flags. The doc says that, and this script fails if the doc,
#   the `_isBroadcast` body, and that anvil behaviour disagree.
#
# Anvil 1.8.5 has no `--unlock`. `--auto-impersonate` (alias `--auto-unlock`)
# lets `forge script --unlocked --sender` send through `eth_sendTransaction`.
# The sender is funded so a transaction that escaped the guard would change
# the block. The first three cases expect zero transactions. The resume case
# expects the replay to mine one.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

RPC="http://127.0.0.1:8545"
SPOOF_RPC="http://127.0.0.1:8546"
SENDER="0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D"
# forge-std VmSafe.ForgeContext.ScriptBroadcast is enum index 6
# (TestGroup=0 … ScriptDryRun=5, ScriptBroadcast=6, ScriptResume=7).
BROADCAST_CONTEXT=6
SWAP="0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688"

port_busy() {
  curl -sf --max-time 1 -X POST "$1" -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1
}

if port_busy "$RPC"; then
  echo "FAIL: $RPC is already in use. Stop that process first." >&2
  exit 1
fi
if port_busy "$SPOOF_RPC"; then
  echo "FAIL: $SPOOF_RPC is already in use. Stop that process first." >&2
  exit 1
fi

anvil_log="$(mktemp)"
anvil --chain-id 84532 --host 127.0.0.1 --port 8545 \
  --auto-impersonate \
  --fund-accounts "${SENDER}:100" \
  >"$anvil_log" 2>&1 &
anvil_pid=$!

spoof_log="$(mktemp)"
anvil --chain-id 1 --host 127.0.0.1 --port 8546 \
  --auto-impersonate \
  --fund-accounts "${SENDER}:100" \
  >"$spoof_log" 2>&1 &
spoof_pid=$!

cleanup() {
  local pid
  for pid in "${anvil_pid:-}" "${spoof_pid:-}"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$root/broadcast/TestDemoSupply.s.sol" "$root/cache/TestDemoSupply.s.sol"
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

spoof_ready=0
for _ in $(seq 1 50); do
  if cast chain-id --rpc-url "$SPOOF_RPC" >/dev/null 2>&1; then
    spoof_ready=1
    break
  fi
  sleep 0.1
done
if [[ "$spoof_ready" -ne 1 ]]; then
  echo "FAIL: chain-1 anvil did not accept RPC connections" >&2
  cat "$spoof_log" >&2
  exit 1
fi

chain_id="$(cast chain-id --rpc-url "$RPC")"
if [[ "$chain_id" != "84532" ]]; then
  echo "FAIL: anvil chain id is $chain_id" >&2
  exit 1
fi
spoof_chain_id="$(cast chain-id --rpc-url "$SPOOF_RPC")"
if [[ "$spoof_chain_id" != "1" ]]; then
  echo "FAIL: spoof anvil chain id is $spoof_chain_id" >&2
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

# `--chain-id` spoofs block.chainid only. Both anvil calls below pass
# --chain-id 84532 while the RPC's eth_chainId is 1.
spoof_block() {
  cast block-number --rpc-url "$SPOOF_RPC"
}
spoof_nonce() {
  cast nonce "$SENDER" --rpc-url "$SPOOF_RPC"
}

SPOOF_BLOCK0="$(spoof_block)"
SPOOF_NONCE0="$(spoof_nonce)"
echo "spoof anvil chain=$spoof_chain_id block=$SPOOF_BLOCK0 nonce=$SPOOF_NONCE0"

assert_spoof_unchanged() {
  local label="$1"
  local block nonce
  block="$(spoof_block)"
  nonce="$(spoof_nonce)"
  if [[ "$block" != "$SPOOF_BLOCK0" || "$nonce" != "$SPOOF_NONCE0" ]]; then
    echo "FAIL ($label): chain-1 anvil moved block=$block nonce=$nonce (start $SPOOF_BLOCK0 $SPOOF_NONCE0)"
    exit 1
  fi
  echo "unchanged ($label): block=$block nonce=$nonce"
}

run_spoof() {
  local label="$1"
  shift
  local log status
  log="$(mktemp)"
  set +e
  "$@" >"$log" 2>&1
  status=$?
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
  if ! grep -F "RpcChainMismatch" "$log" >/dev/null; then
    echo "FAIL ($label): output missing RpcChainMismatch"
    exit 1
  fi
  assert_spoof_unchanged "$label"
}

echo "case: B1 dry-run, --chain-id 84532, real chain id 1"
unset TEST_DEMO_BROADCAST_OK TEST_DEMO_BROADCAST_STEP
run_spoof chain-spoof-b1 \
  forge script script/TestDemoSupply.s.sol:B1_DeployTestDemoFaucet \
  --rpc-url "$SPOOF_RPC" \
  --chain-id 84532 \
  --sender "$SENDER" \
  --unlocked \
  --color never

echo "case: B2 broadcast, flags set, --chain-id 84532, real chain id 1"
TEST_DEMO_BROADCAST_OK=1 TEST_DEMO_BROADCAST_STEP=B2 \
  run_spoof chain-spoof-b2 \
  forge script script/TestDemoSupply.s.sol:B2_DeployBaseRouter \
  --rpc-url "$SPOOF_RPC" \
  --chain-id 84532 \
  --sender "$SENDER" \
  --unlocked \
  --broadcast \
  --color never
unset TEST_DEMO_BROADCAST_OK TEST_DEMO_BROADCAST_STEP

echo "case: doc, source, and anvil agree that --resume is not gated"
if ! grep -F -- '`--resume` does not run the script, so it is NOT gated' docs/TEST_DEMO_SUPPLY.md >/dev/null; then
  echo "FAIL (resume-doc): docs/TEST_DEMO_SUPPLY.md missing the resume warning"
  exit 1
fi
if ! grep -F -- 'delete `broadcast/**/dry-run` before signing' docs/TEST_DEMO_SUPPLY.md >/dev/null; then
  echo "FAIL (resume-doc): docs/TEST_DEMO_SUPPLY.md missing the dry-run delete warning"
  exit 1
fi
if ! grep -F -- '`--resume` does not run the script, so it is NOT gated' README.md >/dev/null; then
  echo "FAIL (resume-doc): README.md missing the resume warning"
  exit 1
fi
if ! grep -F -- "Never pass a \`--chain-id\` that differs from the RPC." docs/TEST_DEMO_SUPPLY.md >/dev/null; then
  echo "FAIL (chain-id-doc): docs/TEST_DEMO_SUPPLY.md missing the chain-id warning"
  exit 1
fi
python3 - script/TestDemoSupply.s.sol <<'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text()
start = text.find("    function _isBroadcast()")
end = text.find("    function _ethChainId()", start)
if start < 0 or end < 0:
    raise SystemExit("FAIL (resume-source): _isBroadcast body not found")
body = text[start:end]
if "ScriptResume" in body:
    raise SystemExit("FAIL (resume-source): _isBroadcast still mentions ScriptResume")
needle = "return vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);"
if body.count(needle) != 1 or body.count("return ") != 1:
    raise SystemExit("FAIL (resume-source): _isBroadcast is not the single ScriptBroadcast return")
print("resume-source: _isBroadcast has no ScriptResume leg")
PY

rm -rf "$root/broadcast/TestDemoSupply.s.sol" "$root/cache/TestDemoSupply.s.sol"

echo "case: B2 dry-run writes run-latest.json"
dry_log="$(mktemp)"
set +e
forge script script/TestDemoSupply.s.sol:B2_DeployBaseRouter \
  --rpc-url "$RPC" \
  --sender "$SENDER" \
  --unlocked \
  --color never >"$dry_log" 2>&1
dry_status=$?
set -e
echo "----- resume-dry-run (exit $dry_status) -----"
cat "$dry_log"
if [[ "$dry_status" -ne 0 ]]; then
  echo "FAIL (resume-dry-run): B2 dry-run failed"
  exit 1
fi
if ! grep -F "B2 deploy LockedDemoSwapRouter" "$dry_log" >/dev/null; then
  echo "FAIL (resume-dry-run): script did not run"
  exit 1
fi
if [[ ! -f broadcast/TestDemoSupply.s.sol/84532/dry-run/run-latest.json ]]; then
  echo "FAIL (resume-dry-run): dry-run did not write run-latest.json"
  exit 1
fi
assert_unchanged resume-dry-run
resume_block_before="$(cast block-number --rpc-url "$RPC")"
resume_nonce_before="$(cast nonce "$SENDER" --rpc-url "$RPC")"

echo "case: --resume with no flags replays that json"
resume_log="$(mktemp)"
set +e
env -u TEST_DEMO_BROADCAST_OK -u TEST_DEMO_BROADCAST_STEP \
  forge script script/TestDemoSupply.s.sol:B2_DeployBaseRouter \
  --rpc-url "$RPC" \
  --sender "$SENDER" \
  --unlocked \
  --resume \
  --color never >"$resume_log" 2>&1
resume_status=$?
set -e
echo "----- resume-replay (exit $resume_status) -----"
cat "$resume_log"
if [[ "$resume_status" -ne 0 ]]; then
  echo "FAIL (resume-replay): --resume did not submit the dry-run json"
  exit 1
fi
if ! grep -F "ONCHAIN EXECUTION COMPLETE" "$resume_log" >/dev/null; then
  echo "FAIL (resume-replay): output missing ONCHAIN EXECUTION COMPLETE"
  exit 1
fi
if grep -F "B2 deploy LockedDemoSwapRouter" "$resume_log" >/dev/null; then
  echo "FAIL (resume-replay): --resume ran the script"
  exit 1
fi
if grep -F "BroadcastRefused" "$resume_log" >/dev/null; then
  echo "FAIL (resume-replay): --resume evaluated BroadcastRefused"
  exit 1
fi
resume_block_after="$(cast block-number --rpc-url "$RPC")"
resume_nonce_after="$(cast nonce "$SENDER" --rpc-url "$RPC")"
echo "resume anvil block $resume_block_before -> $resume_block_after nonce $resume_nonce_before -> $resume_nonce_after"
if [[ "$resume_block_after" -le "$resume_block_before" || "$resume_nonce_after" -le "$resume_nonce_before" ]]; then
  echo "FAIL (resume-replay): chain-84532 anvil did not advance"
  exit 1
fi

echo "real broadcast context proof passed"
