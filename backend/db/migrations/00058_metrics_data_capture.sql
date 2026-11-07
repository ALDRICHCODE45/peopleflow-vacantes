-- +goose Up
-- +goose StatementBegin
-- stakeholder-metrics-v1 §2.5 / D9: where a participation came from. Organic
-- rows before this migration cannot tell the portal from the careers site.
ALTER TABLE process_participations ADD COLUMN origin_channel TEXT;
UPDATE process_participations SET origin_channel = CASE source WHEN 'manual' THEN 'manual' ELSE 'unknown' END;
ALTER TABLE process_participations
    ALTER COLUMN origin_channel SET NOT NULL,
    ADD CONSTRAINT process_participations_origin_channel_check
        CHECK (origin_channel IN ('portal', 'careers_site', 'manual', 'unknown'));

-- Application writers always name the channel. An insert that omits it gets
-- the historical rule, so a missing channel is never guessed as 'portal'.
CREATE FUNCTION process_participations_default_origin_channel() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.origin_channel IS NULL THEN
        NEW.origin_channel := CASE NEW.source WHEN 'manual' THEN 'manual' ELSE 'unknown' END;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER process_participations_default_origin_channel
    BEFORE INSERT ON process_participations
    FOR EACH ROW EXECUTE FUNCTION process_participations_default_origin_channel();
CREATE INDEX process_participations_origin_idx ON process_participations (created_at, origin_channel);

-- §2.7: the current requester copied out of the canonical draft JSON on every
-- write. kind may be set with a null id («sin especificar»).
ALTER TABLE job_drafts
    ADD COLUMN requester_kind TEXT
        CONSTRAINT job_drafts_requester_kind_check CHECK (requester_kind IN ('internal_area', 'client')),
    ADD COLUMN requester_id UUID,
    ADD CONSTRAINT job_drafts_requester_id_kind_check CHECK (requester_id IS NULL OR requester_kind IS NOT NULL);
DO $$
DECLARE
    d record;
    r jsonb;
    cleaned text;
    stripped text;
BEGIN
    FOR d IN SELECT id, convert_from(fields, 'UTF8') AS raw FROM job_drafts LOOP
        -- A draft whose requester cannot be read keeps null columns until its next save.
        BEGIN
            r := d.raw::jsonb->'fields'->'requester';
        EXCEPTION WHEN data_exception THEN
            -- Canonical bytes may hold \u0000 escapes, which jsonb rejects; they
            -- never occur in the requester, so drop them (keeping escaped
            -- backslashes intact) before reading it.
            -- Repeat: adjacent escapes share the character a match consumes.
            cleaned := d.raw;
            LOOP
                stripped := regexp_replace(cleaned, '(^|[^\\])((\\\\)*)\\u0000', '\1\2', 'g');
                EXIT WHEN stripped = cleaned;
                cleaned := stripped;
            END LOOP;
            BEGIN
                r := cleaned::jsonb->'fields'->'requester';
            EXCEPTION WHEN data_exception THEN
                r := NULL;
            END;
        END;
        IF jsonb_typeof(r) = 'object' AND r->>'kind' IN ('internal_area', 'client') THEN
            UPDATE job_drafts
            SET requester_kind = r->>'kind',
                requester_id = CASE WHEN r->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                    THEN (r->>'id')::uuid END
            WHERE id = d.id;
        END IF;
    END LOOP;
END;
$$;
CREATE INDEX job_drafts_requester_idx ON job_drafts (company_id, requester_kind, requester_id);

-- §2.2 / D7: optional closing target in the management configuration, with
-- every change logged like commitment renegotiations (no reason required).
ALTER TABLE job_draft_management_configs ADD COLUMN target_close_date DATE;
CREATE TABLE vacancy_close_target_changes (
    id uuid PRIMARY KEY,
    draft_id uuid NOT NULL REFERENCES job_drafts(id) ON DELETE CASCADE,
    company_id uuid NOT NULL,
    previous_date date NULL,
    new_date date NULL,
    performed_by uuid NOT NULL REFERENCES users(id),
    performed_at timestamptz NOT NULL,
    CONSTRAINT vacancy_close_target_changes_changed_check CHECK (previous_date IS DISTINCT FROM new_date)
);
CREATE INDEX vacancy_close_target_changes_draft_idx ON vacancy_close_target_changes (draft_id, performed_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Not data-preserving: channels, requester columns and closing targets are
-- dropped (the requester stays in the draft JSON).
DROP TABLE vacancy_close_target_changes;
ALTER TABLE job_draft_management_configs DROP COLUMN target_close_date;
DROP INDEX job_drafts_requester_idx;
ALTER TABLE job_drafts
    DROP CONSTRAINT job_drafts_requester_id_kind_check,
    DROP COLUMN requester_id,
    DROP COLUMN requester_kind;
DROP INDEX process_participations_origin_idx;
DROP TRIGGER process_participations_default_origin_channel ON process_participations;
DROP FUNCTION process_participations_default_origin_channel();
ALTER TABLE process_participations DROP COLUMN origin_channel;
-- +goose StatementEnd
