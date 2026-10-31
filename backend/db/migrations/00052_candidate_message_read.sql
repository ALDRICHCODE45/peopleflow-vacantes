-- +goose Up
-- +goose StatementBegin
ALTER TABLE process_participations
 ADD COLUMN candidate_message_read_at TIMESTAMPTZ,
 ADD CONSTRAINT participation_message_read_shape CHECK (
  candidate_message_read_at IS NULL OR
  (candidate_message IS NOT NULL AND discarded_at IS NOT NULL AND candidate_message_read_at >= created_at)
 );
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM process_participations WHERE candidate_message_read_at IS NOT NULL) THEN
  RAISE EXCEPTION 'read data exists; rollback requires an explicit retention decision';
 END IF;
END $$;
ALTER TABLE process_participations
 DROP CONSTRAINT participation_message_read_shape,
 DROP COLUMN candidate_message_read_at;
-- +goose StatementEnd
