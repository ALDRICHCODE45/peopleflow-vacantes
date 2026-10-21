-- +goose Up
ALTER TABLE vacancy_processes
    DROP CONSTRAINT vacancy_process_status,
    ADD CONSTRAINT vacancy_process_status CHECK (status IN ('published', 'paused', 'closed')),
    ADD COLUMN process_status TEXT NOT NULL DEFAULT 'active'
        CONSTRAINT vacancy_process_internal_status CHECK (process_status IN ('active', 'finished')),
    ADD COLUMN lifecycle_version BIGINT NOT NULL DEFAULT 1
        CONSTRAINT vacancy_lifecycle_version_positive CHECK (lifecycle_version > 0),
    ADD COLUMN paused_at TIMESTAMPTZ,
    ADD COLUMN closed_at TIMESTAMPTZ,
    ADD COLUMN process_finished_at TIMESTAMPTZ,
    ADD CONSTRAINT vacancy_finished_requires_closed CHECK (process_status <> 'finished' OR status = 'closed');

CREATE TABLE vacancy_lifecycle_events (
    id UUID PRIMARY KEY,
    process_id UUID NOT NULL REFERENCES vacancy_processes (id) ON DELETE CASCADE,
    lifecycle_version BIGINT NOT NULL CHECK (lifecycle_version > 1),
    action TEXT NOT NULL CHECK (action IN ('pause', 'resume', 'close', 'finish_process', 'reopen')),
    -- Only close records the explicit request choice, not the resulting axis.
    process TEXT,
    actor_id UUID NOT NULL REFERENCES users (id),
    actor_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT vacancy_lifecycle_close_choice CHECK (
        (action = 'close' AND process IS NOT NULL AND process IN ('continue', 'finish'))
        OR (action <> 'close' AND process IS NULL)
    ),
    UNIQUE (process_id, lifecycle_version)
);
CREATE INDEX vacancy_lifecycle_events_history_idx
    ON vacancy_lifecycle_events (process_id, created_at DESC, lifecycle_version DESC);

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    -- Lock out concurrent writers before checking for lossy rollback.
    LOCK TABLE vacancy_processes, vacancy_lifecycle_events IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM vacancy_processes WHERE status <> 'published' OR process_status <> 'active')
       OR EXISTS (SELECT 1 FROM vacancy_lifecycle_events) THEN
        RAISE EXCEPTION 'cannot remove vacancy lifecycle: non-published/active state or lifecycle history exists';
    END IF;
END $$;
DROP TABLE vacancy_lifecycle_events;
ALTER TABLE vacancy_processes
    DROP CONSTRAINT vacancy_finished_requires_closed,
    DROP CONSTRAINT vacancy_process_status,
    DROP COLUMN process_status,
    DROP COLUMN lifecycle_version,
    DROP COLUMN paused_at,
    DROP COLUMN closed_at,
    DROP COLUMN process_finished_at,
    ADD CONSTRAINT vacancy_process_status CHECK (status IN ('published'));
-- +goose StatementEnd
