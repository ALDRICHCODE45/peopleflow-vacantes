-- +goose Up
-- +goose StatementBegin
-- audit-log-v1 §1: the company, the vacancy and the client a row belongs to.
-- company_id is null only for events with no company (candidate-side account
-- events). ip/user_agent/ip_source come from the request context, never from
-- emitters: 'bff' = forwarded by the Next server with the shared secret,
-- 'peer' = TCP peer or the trusted proxy chain.
ALTER TABLE audit_events
    ADD COLUMN company_id UUID,
    ADD COLUMN vacancy_id UUID,
    ADD COLUMN ip INET,
    ADD COLUMN user_agent TEXT,
    ADD COLUMN ip_source TEXT
        CONSTRAINT audit_events_ip_source_check CHECK (ip_source IN ('bff', 'peer'));

-- Dev data is disposable: take the ids the older emitters put in metadata and
-- leave the rest null (those rows never reach the company audit screen).
UPDATE audit_events
SET company_id = CASE WHEN metadata->>'company_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      THEN (metadata->>'company_id')::uuid END,
    vacancy_id = CASE WHEN metadata->>'vacancy_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      THEN (metadata->>'vacancy_id')::uuid
                      WHEN entity_type IN ('job_draft', 'vacancy') THEN entity_id END;

CREATE INDEX audit_events_company_idx ON audit_events (company_id, occurred_at DESC, id DESC);
CREATE INDEX audit_events_company_actor_idx ON audit_events (company_id, actor_id, occurred_at DESC);
CREATE INDEX audit_events_company_vacancy_idx ON audit_events (company_id, vacancy_id, occurred_at DESC);
CREATE INDEX audit_events_company_type_idx ON audit_events (company_id, event_type, occurred_at DESC);

-- audit-log-v1 §6: append-only for every application path. The one DELETE is
-- the retention purge (D2, 24 months): its transaction sets the flag to its
-- own txid (set_config('peopleflow.audit_purge', txid_current()::text, true)),
-- so a session-level SET or a stale value never opens it. The database owner
-- can still disable the trigger; the least-privilege role (D4) closes that.
CREATE FUNCTION audit_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND current_setting('peopleflow.audit_purge', true) = txid_current()::text
       AND OLD.occurred_at < now() - interval '24 months' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_events_append_only
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

CREATE TRIGGER audit_events_no_truncate
    BEFORE TRUNCATE ON audit_events
    FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TRIGGER audit_events_no_truncate ON audit_events;
DROP TRIGGER audit_events_append_only ON audit_events;
DROP FUNCTION audit_events_append_only();
DROP INDEX audit_events_company_type_idx;
DROP INDEX audit_events_company_vacancy_idx;
DROP INDEX audit_events_company_actor_idx;
DROP INDEX audit_events_company_idx;
ALTER TABLE audit_events
    DROP COLUMN ip_source,
    DROP COLUMN user_agent,
    DROP COLUMN ip,
    DROP COLUMN vacancy_id,
    DROP COLUMN company_id;
-- +goose StatementEnd
