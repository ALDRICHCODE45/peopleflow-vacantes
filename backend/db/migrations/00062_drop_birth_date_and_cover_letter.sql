-- +goose Up
-- +goose StatementBegin
-- Two 2 Oct 2026 partner agreements: the candidate's birth date and the
-- application cover letter are no longer part of the product. The code stopped
-- reading and writing both columns in the commits that precede this migration
-- (S1/S2), so the DROPs only discard stored data.
--
-- DEPLOY: take a database backup BEFORE applying this migration in production.
-- The data is destroyed; Down restores the columns, never the values.
ALTER TABLE candidate_profiles DROP COLUMN birth_date;
ALTER TABLE applications DROP COLUMN cover_letter;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Structural rollback only: both columns come back empty (NULL). The dropped
-- values are NOT restorable from this migration; restore them from the
-- pre-migration backup if they are ever needed.
ALTER TABLE candidate_profiles ADD COLUMN birth_date DATE;
ALTER TABLE applications ADD COLUMN cover_letter TEXT;
-- +goose StatementEnd
