-- +goose Up
-- +goose StatementBegin
CREATE TABLE process_delivery_fulfillments (
 process_id UUID PRIMARY KEY REFERENCES vacancy_processes(id),
 fulfilled_at TIMESTAMPTZ NOT NULL,
 result TEXT NOT NULL CHECK (result IN ('on_time','late')),
 business_days_delta INTEGER NOT NULL,
 target INTEGER NOT NULL CHECK (target BETWEEN 1 AND 999),
 delivered INTEGER NOT NULL CHECK (delivered >= target),
 cutoff_stage_id UUID NOT NULL,
 cutoff_stage_name TEXT NOT NULL CHECK (char_length(cutoff_stage_name) BETWEEN 1 AND 40),
 commitment_date DATE NOT NULL,
 candidates JSONB NOT NULL CHECK (jsonb_typeof(candidates)='array' AND jsonb_array_length(candidates)=target),
 CHECK ((result='on_time' AND business_days_delta>=0) OR (result='late' AND business_days_delta<=0))
);
-- Only actual entries count: a substate event remains in the same stage, and a
-- discard enters the exit rather than attaining a progression milestone.
CREATE INDEX participation_history_first_entry_idx
 ON participation_stage_history(participation_id,stage_id,created_at)
 WHERE event_kind IN ('intake','move','recovery');
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM process_delivery_fulfillments) THEN
  RAISE EXCEPTION 'fulfillment data exists; rollback requires an explicit retention decision';
 END IF;
END $$;
DROP INDEX participation_history_first_entry_idx;
DROP TABLE process_delivery_fulfillments;
-- +goose StatementEnd
