-- +goose Up
-- +goose StatementBegin
-- stakeholder-metrics-v1 §3.6: metric reads compute on request. 00058 already
-- added (created_at, origin_channel) on participations and the requester
-- columns' index; these two serve the tramo overlap and close-event scans.
CREATE INDEX vacancy_assignments_draft_started_idx ON vacancy_assignments (draft_id, started_at);
CREATE INDEX vacancy_lifecycle_events_action_created_idx ON vacancy_lifecycle_events (action, created_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX vacancy_lifecycle_events_action_created_idx;
DROP INDEX vacancy_assignments_draft_started_idx;
-- +goose StatementEnd
