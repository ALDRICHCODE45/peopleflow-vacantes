-- +goose Up
-- +goose StatementBegin
-- stakeholder-metrics-v2 §2 (slice v2c): origin and the applications list
-- count participations by vacancy and creation instant; until now only the
-- global (created_at, origin_channel) index existed.
CREATE INDEX process_participations_process_created_idx ON process_participations (process_id, created_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX process_participations_process_created_idx;
-- +goose StatementEnd
