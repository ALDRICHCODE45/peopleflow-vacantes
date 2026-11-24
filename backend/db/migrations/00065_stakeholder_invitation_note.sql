-- +goose Up
-- +goose StatementBegin
-- Optional note on a stakeholder invitation (stakeholder-metrics-v1 §1.3, audit gap D11). Additive only: one nullable
-- column; existing rows keep NULL. The writer stores the note trimmed and NFC, so 1..80 code points is the whole rule here.
ALTER TABLE stakeholder_invitations
    ADD COLUMN note TEXT NULL
        CONSTRAINT stakeholder_invitations_note_length CHECK (char_length(note) BETWEEN 1 AND 80);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    -- Lock out concurrent writers before checking for lossy rollback.
    LOCK TABLE stakeholder_invitations IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM stakeholder_invitations WHERE note IS NOT NULL) THEN
        RAISE EXCEPTION 'cannot remove stakeholder invitation notes: notes exist';
    END IF;
END $$;
ALTER TABLE stakeholder_invitations DROP COLUMN note;
-- +goose StatementEnd
