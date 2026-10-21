-- +goose Up
ALTER TABLE vacancy_lifecycle_events
    ADD COLUMN reason TEXT,
    ADD COLUMN reason_note TEXT,
    ADD CONSTRAINT vacancy_lifecycle_reason CHECK (reason IS NULL OR reason IN ('filled', 'cancelled', 'other')),
    ADD CONSTRAINT vacancy_lifecycle_reason_action CHECK (action = 'close' OR (reason IS NULL AND reason_note IS NULL)),
    ADD CONSTRAINT vacancy_lifecycle_reason_note CHECK (
        (reason IS NOT NULL AND reason = 'other' AND reason_note IS NOT NULL AND reason_note !~ '^[[:space:]]*$')
        OR ((reason IS NULL OR reason <> 'other') AND reason_note IS NULL)
    ),
    ADD CONSTRAINT vacancy_lifecycle_reason_note_length CHECK (char_length(reason_note) <= 200);

-- Projection upserts update content but never published_at: this is the first
-- publication, unlike the old process timestamp refreshed by resume/reopen.
UPDATE vacancy_processes AS process
SET published_at = projection.published_at
FROM vacancy_public_projections AS projection
WHERE projection.id = process.id;

-- +goose Down
-- The repaired first-publication timestamp is intentionally retained.
-- +goose StatementBegin
DO $$
BEGIN
    LOCK TABLE vacancy_lifecycle_events IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM vacancy_lifecycle_events WHERE reason IS NOT NULL OR reason_note IS NOT NULL) THEN
        RAISE EXCEPTION 'cannot remove close reasons: recorded reasons exist';
    END IF;
END $$;
ALTER TABLE vacancy_lifecycle_events
    DROP CONSTRAINT vacancy_lifecycle_reason,
    DROP CONSTRAINT vacancy_lifecycle_reason_action,
    DROP CONSTRAINT vacancy_lifecycle_reason_note,
    DROP CONSTRAINT vacancy_lifecycle_reason_note_length,
    DROP COLUMN reason,
    DROP COLUMN reason_note;
-- +goose StatementEnd
