-- Append-only points ledger (SQLite).
-- Points are off-chain scores and are unpaid.
-- Postgres can replace this file later. Do not put a connection string in this repo.
--
-- Append-only is enforced only through the app (no update or delete API) and
-- these triggers. Dropping the triggers leaves the rows writable.
--
-- wallet is a lowercase 0x address.
-- action is one id from the fixed rubric set.
-- points is a positive integer up to 500 (MAX_POINTS_PER_ROW in rubric.mjs).
-- tx_hash is NOT NULL: the on-chain transaction hash, or a deterministic
-- synthetic key from syntheticTxKey() when the action is off-chain.
-- syntheticTxKey lowercases its inputs before hashing.
-- UNIQUE (wallet, action, tx_hash) rejects a second insert of the same event
-- for one wallet. On-chain hashes (0x...) are also unique on (action, tx_hash),
-- so a second wallet cannot claim that transaction for the same action.
-- Bug reports and security findings are not scored. Rows already stored are
-- left in place: this file does not delete or rewrite them and does not
-- rebuild the table. CREATE TABLE IF NOT EXISTS leaves an older action CHECK.
-- BEFORE INSERT and BEFORE UPDATE triggers reject bug_report, security,
-- security_finding, and finding. Reads omit those actions.
-- The on-chain unique index is created on open without rewriting rows.
-- UPDATE and DELETE triggers raise 'append-only'.
-- BEFORE INSERT raises 'duplicate' when the id, (wallet, action, tx_hash),
-- or an on-chain (action, tx_hash) is already stored.
-- Each of those checks is its own EXISTS so SQLite can use an index.
-- That fires before ON CONFLICT, so a raw
-- INSERT ... ON CONFLICT DO NOTHING raises 'duplicate' instead of skipping
-- the row. REPLACE deletes the old row only after that trigger, and it runs
-- the delete trigger only when recursive_triggers is on. Aborting first keeps
-- the old row when recursive_triggers is off.
-- CREATE TABLE IF NOT EXISTS does not add this points cap to a table that
-- already exists. The store rejects an over-cap row either way.

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
      'wallet_session'
    )
  ),
  CHECK (typeof(points) = 'integer' AND points > 0 AND points <= 500),
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

DROP TRIGGER IF EXISTS points_ledger_no_insert;
CREATE TRIGGER points_ledger_no_insert
BEFORE INSERT ON points_ledger
WHEN EXISTS(SELECT 1 FROM points_ledger WHERE id=NEW.id)
  OR EXISTS(SELECT 1 FROM points_ledger WHERE wallet=NEW.wallet AND action=NEW.action AND tx_hash=NEW.tx_hash)
  OR (substr(NEW.tx_hash,1,2)='0x' AND EXISTS(SELECT 1 FROM points_ledger WHERE action=NEW.action AND tx_hash=NEW.tx_hash AND substr(tx_hash,1,2)='0x'))
BEGIN
  SELECT RAISE(ABORT, 'duplicate');
END;

DROP TRIGGER IF EXISTS points_ledger_no_update;
CREATE TRIGGER points_ledger_no_update
BEFORE UPDATE ON points_ledger
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

DROP TRIGGER IF EXISTS points_ledger_no_delete;
CREATE TRIGGER points_ledger_no_delete
BEFORE DELETE ON points_ledger
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- Reject a new bug or security row. This does not delete or rewrite a row
-- that is already stored. An older CHECK may still name bug_report.
DROP TRIGGER IF EXISTS points_ledger_no_excluded_insert;
CREATE TRIGGER points_ledger_no_excluded_insert
BEFORE INSERT ON points_ledger
WHEN NEW.action IN ('bug_report', 'security', 'security_finding', 'finding')
BEGIN
  SELECT RAISE(ABORT, 'excluded_action');
END;

DROP TRIGGER IF EXISTS points_ledger_no_excluded_update;
CREATE TRIGGER points_ledger_no_excluded_update
BEFORE UPDATE ON points_ledger
WHEN NEW.action IN ('bug_report', 'security', 'security_finding', 'finding')
  OR OLD.action IN ('bug_report', 'security', 'security_finding', 'finding')
BEGIN
  SELECT RAISE(ABORT, 'excluded_action');
END;

-- Predicate matches the on-chain EXISTS exactly so the planner can use this index.
DROP INDEX IF EXISTS points_ledger_onchain_action_tx;
CREATE UNIQUE INDEX points_ledger_onchain_action_tx
ON points_ledger(action, tx_hash)
WHERE substr(tx_hash,1,2)='0x';

-- The bug-report action is gone. Drop a leftover index from an older file.
DROP INDEX IF EXISTS points_ledger_bug_action_tx;
