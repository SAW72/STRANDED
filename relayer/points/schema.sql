-- Append-only points ledger (SQLite).
-- Points are off-chain scores and are unpaid.
-- Postgres can replace this file later. Do not put a connection string in this repo.
--
-- wallet is a lowercase 0x address.
-- action is one id from the fixed rubric set. Point amounts are chosen by the caller.
-- tx_hash is the on-chain transaction hash, or a deterministic synthetic key
-- from syntheticTxKey() when the action is off-chain.
-- UNIQUE (wallet, action, tx_hash) rejects a second insert of the same event.
-- Triggers reject UPDATE and DELETE.
--
-- The opener must run PRAGMA recursive_triggers = ON. Otherwise INSERT OR REPLACE
-- can remove a row without running the delete trigger.

CREATE TABLE IF NOT EXISTS points_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  action TEXT NOT NULL,
  points INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    length(wallet) = 42
    AND substr(wallet, 1, 2) = '0x'
    AND wallet = lower(wallet)
    AND substr(wallet, 3) NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    action IN (
      'rescue_completed',
      'relayer_job',
      'registry_find_posted',
      'registry_find_claimed',
      'wallet_session',
      'bug_report'
    )
  ),
  CHECK (typeof(points) = 'integer' AND points > 0),
  CHECK (
    (
      length(tx_hash) = 66
      AND substr(tx_hash, 1, 2) = '0x'
      AND tx_hash = lower(tx_hash)
      AND substr(tx_hash, 3) NOT GLOB '*[^0-9a-f]*'
    )
    OR (
      length(tx_hash) = 68
      AND substr(tx_hash, 1, 4) = 'off:'
      AND substr(tx_hash, 5) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (metadata IS NULL OR (json_valid(metadata) AND length(metadata) <= 4096)),
  CHECK (length(created_at) >= 20),
  UNIQUE (wallet, action, tx_hash)
) STRICT;

CREATE TRIGGER IF NOT EXISTS points_ledger_no_update
BEFORE UPDATE ON points_ledger
BEGIN
  SELECT RAISE(ABORT, 'points_ledger is append-only');
END;

CREATE TRIGGER IF NOT EXISTS points_ledger_no_delete
BEFORE DELETE ON points_ledger
BEGIN
  SELECT RAISE(ABORT, 'points_ledger is append-only');
END;
