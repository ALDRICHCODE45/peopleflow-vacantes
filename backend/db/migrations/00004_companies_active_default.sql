-- +goose Up
-- MVP decision: companies are born `active`. There is no verification pipeline
-- in the MVP (see docs/flujo-verificacion-empresas.md), so `pending_verification`
-- is reserved vocabulary, not a starting state.
--
-- 1. Backfill: existing rows stuck in `pending_verification` (created before
--    this decision) become `active` so no company is left unpublishable by the
--    upcoming `jobs` rule "solo empresa active publica".
-- 2. Default: the column DEFAULT flips to `active` so direct SQL inserts (and
--    any future write path that bypasses the domain factory) are born active
--    too, keeping DB default and domain default in lockstep.
UPDATE companies SET status = 'active' WHERE status = 'pending_verification';

ALTER TABLE companies ALTER COLUMN status SET DEFAULT 'active';

-- +goose Down
ALTER TABLE companies ALTER COLUMN status SET DEFAULT 'pending_verification';
-- Note: the backfill is NOT reversed. The down migration restores the schema
-- DEFAULT only; rows already flipped to `active` stay active.
