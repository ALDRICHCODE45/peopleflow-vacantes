-- +goose Up
-- +goose StatementBegin
-- Replacement processes (docs/contracts/replacement-processes-v1.md «Data model»).
-- A replacement is a new draft + vacancy process linked to the process it was
-- started from, to the original of the logical vacancy (root) and to the fallen
-- placement credits it replaces. The original process has NO row here, so a row
-- means «replacement». Same-company is enforced by the writer, as for
-- placement_credits: the FK graph cannot express it.
CREATE TABLE vacancy_replacements (
    process_id UUID PRIMARY KEY REFERENCES vacancy_processes (id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies (id),
    source_process_id UUID NOT NULL REFERENCES vacancy_processes (id),
    root_process_id UUID NOT NULL REFERENCES vacancy_processes (id),
    -- 1-based position in the chain, assigned under the root process lock.
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    started_at TIMESTAMPTZ NOT NULL,
    started_by UUID NOT NULL REFERENCES users (id),
    target_quantity INTEGER NOT NULL CHECK (target_quantity BETWEEN 1 AND 999),
    CHECK (process_id <> source_process_id AND process_id <> root_process_id),
    UNIQUE (root_process_id, sequence)
);
CREATE INDEX vacancy_replacements_source_idx ON vacancy_replacements (source_process_id);

-- The fallen credits a replacement replaces; a credit is replaced at most once.
CREATE TABLE vacancy_replacement_credits (
    replacement_process_id UUID NOT NULL REFERENCES vacancy_replacements (process_id) ON DELETE CASCADE,
    placement_credit_id UUID NOT NULL UNIQUE REFERENCES placement_credits (id),
    PRIMARY KEY (replacement_process_id, placement_credit_id)
);

-- Lineage of a carried participation; NULL for every normal participation.
ALTER TABLE process_participations
    ADD COLUMN carried_from_participation_id UUID NULL REFERENCES process_participations (id);
CREATE INDEX process_participations_carried_idx ON process_participations (carried_from_participation_id)
    WHERE carried_from_participation_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    -- Lock out concurrent writers before checking for lossy rollback.
    LOCK TABLE vacancy_replacements, vacancy_replacement_credits, process_participations IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM vacancy_replacements)
       OR EXISTS (SELECT 1 FROM process_participations WHERE carried_from_participation_id IS NOT NULL) THEN
        RAISE EXCEPTION 'cannot remove replacement processes: replacements or carried participations exist';
    END IF;
END $$;
DROP INDEX process_participations_carried_idx;
ALTER TABLE process_participations DROP COLUMN carried_from_participation_id;
DROP TABLE vacancy_replacement_credits;
DROP TABLE vacancy_replacements;
-- +goose StatementEnd
