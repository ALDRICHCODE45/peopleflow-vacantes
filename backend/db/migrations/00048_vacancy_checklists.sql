-- +goose Up
-- +goose StatementBegin
CREATE TABLE job_draft_checklists (
 draft_id UUID PRIMARY KEY REFERENCES job_drafts(id) ON DELETE CASCADE,
 version BIGINT NOT NULL CHECK (version > 0),
 checklist JSONB NOT NULL
);
CREATE TABLE participation_checklist_marks (
 participation_id UUID NOT NULL REFERENCES process_participations(id) ON DELETE CASCADE,
 criterion_id UUID NOT NULL,
 verdict TEXT NOT NULL CHECK (verdict IN ('met', 'not_met')),
 note TEXT CHECK (char_length(note) <= 500),
 marked_by UUID NOT NULL REFERENCES users(id),
 marked_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY (participation_id, criterion_id)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
LOCK TABLE job_draft_checklists, participation_checklist_marks IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM job_draft_checklists)
 OR EXISTS (SELECT 1 FROM participation_checklist_marks) THEN
  RAISE EXCEPTION 'checklist data exist; rollback requires an explicit retention decision';
 END IF;
END $$;
DROP TABLE participation_checklist_marks;
DROP TABLE job_draft_checklists;
-- +goose StatementEnd
