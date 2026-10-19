-- Forward rebuild. 0001's CREATE TABLE IF NOT EXISTS does not add
-- CHECK (action <> 'wallet_session') to a table created before that CHECK
-- existed. Copy the rows, swap the table, and recreate the triggers and index.
-- A wallet_session row cannot satisfy the rebuilt CHECK, so it is not copied.
-- This file does not edit 0001.

CREATE TABLE points_ledger_next (
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
      'registry_find_claimed'
    )
  ),
  CHECK (action <> 'wallet_session'),
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

INSERT INTO points_ledger_next (id, wallet, action, points, tx_hash, metadata, created_at)
SELECT id, wallet, action, points, tx_hash, metadata, created_at
FROM points_ledger
WHERE action <> 'wallet_session';

DROP TABLE points_ledger;

ALTER TABLE points_ledger_next RENAME TO points_ledger;

UPDATE sqlite_sequence SET name = 'points_ledger' WHERE name = 'points_ledger_next';

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

DROP TRIGGER IF EXISTS points_ledger_no_excluded_insert;
CREATE TRIGGER points_ledger_no_excluded_insert
BEFORE INSERT ON points_ledger
WHEN NEW.action IN ('bug_report', 'security', 'security_finding', 'finding', 'wallet_session')
BEGIN
  SELECT RAISE(ABORT, 'excluded_action');
END;

DROP TRIGGER IF EXISTS points_ledger_no_excluded_update;
CREATE TRIGGER points_ledger_no_excluded_update
BEFORE UPDATE ON points_ledger
WHEN NEW.action IN ('bug_report', 'security', 'security_finding', 'finding', 'wallet_session')
  OR OLD.action IN ('bug_report', 'security', 'security_finding', 'finding', 'wallet_session')
BEGIN
  SELECT RAISE(ABORT, 'excluded_action');
END;

DROP INDEX IF EXISTS points_ledger_onchain_action_tx;
CREATE UNIQUE INDEX points_ledger_onchain_action_tx
ON points_ledger(action, tx_hash)
WHERE substr(tx_hash,1,2)='0x';

DROP INDEX IF EXISTS points_ledger_bug_action_tx;
