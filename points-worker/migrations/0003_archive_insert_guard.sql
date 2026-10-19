-- Archive rows stay append-only. INSERT OR REPLACE deletes the old row
-- without firing the DELETE trigger, so a second insert of the same id
-- is refused here. 0002 is unchanged.

CREATE TRIGGER IF NOT EXISTS points_ledger_archive_no_replace
BEFORE INSERT ON points_ledger_archive
WHEN EXISTS (SELECT 1 FROM points_ledger_archive WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;
