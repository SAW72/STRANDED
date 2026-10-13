#!/usr/bin/env bash
# Mutation proof for the CHAIN_ID startup guard, the RPC eth_chainId check,
# and the rescue order chainId requirement. Each mutant must fail the named test.
# Restores the originals on exit. Not part of `npm test`.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

quote="quoteRequest.mjs"
server="server.mjs"
backup="$(mktemp -d)"
cp "$quote" "$backup/quoteRequest.mjs"
cp "$server" "$backup/server.mjs"

restore() {
  cp "$backup/quoteRequest.mjs" "$quote"
  cp "$backup/server.mjs" "$server"
}
trap restore EXIT

expect_fail() {
  local pattern="$1"
  local label="$2"
  set +e
  node --test --test-name-pattern "$pattern" test/chainGuard.test.mjs
  local status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    echo "MUTATION SURVIVED ($label): $pattern"
    exit 1
  fi
  echo "MUTATION CAUGHT ($label): $pattern"
}

echo "baseline"
node --test test/chainGuard.test.mjs

echo "mutation: silent CHAIN_ID default of 421614"
cp "$backup/server.mjs" "$server"
perl -0pi -e 's/CHAIN_ID = parseExplicitChainId\(process\.env\.CHAIN_ID\);/CHAIN_ID = Number(process.env.CHAIN_ID || 421614);/' "$server"
expect_fail "startup rejects a missing CHAIN_ID" "missing-chain-id"
expect_fail "startup rejects a non-decimal CHAIN_ID" "hex-chain-id"

echo "mutation: accept Number() coercion instead of a decimal string"
cp "$backup/quoteRequest.mjs" "$quote"
cp "$backup/server.mjs" "$server"
perl -0pi -e 's/if \(typeof raw !== "string"\) throw new Error\(CHAIN_ID_DECIMAL\);\n  const trimmed = raw\.trim\(\);\n  if \(!\/\^\[0-9\]\+\$\/\.test\(trimmed\)\) throw new Error\(CHAIN_ID_DECIMAL\);\n  const chainId = Number\(trimmed\);\n  if \(String\(chainId\) !== trimmed \|\| !isTestnetChainId\(chainId\)\) throw new Error\(CHAIN_ID_TESTNET\);/const trimmed = String(raw ?? "").trim();\n  const chainId = Number(trimmed);\n  if (!isTestnetChainId(chainId)) throw new Error(CHAIN_ID_TESTNET);/' "$quote"
expect_fail "parseExplicitChainId rejects a non-decimal CHAIN_ID" "decimal-only"

echo "mutation: do not exit when eth_chainId mismatches"
cp "$backup/quoteRequest.mjs" "$quote"
cp "$backup/server.mjs" "$server"
perl -0pi -e 's/process\.exit\(1\); \/\/ fail closed when RPC eth_chainId does not match CHAIN_ID/void err;/' "$server"
expect_fail "startup rejects an RPC chain mismatch" "rpc-chain-id"

echo "mutation: allow a rescue order with no chainId"
cp "$backup/quoteRequest.mjs" "$quote"
cp "$backup/server.mjs" "$server"
perl -0pi -e 's/throw fail\(400, "wrong_chain", configuredChainMessage\(defaultChainId\)\);\n  \}\n  const n = Number\(chainRaw\);/return;\n  }\n  const n = Number(chainRaw);/' "$quote"
expect_fail "order with no chainId is wrong_chain" "order-chain-id"

cp "$backup/quoteRequest.mjs" "$quote"
cp "$backup/server.mjs" "$server"
echo "restored"
node --test test/chainGuard.test.mjs
echo "mutation proof passed"
