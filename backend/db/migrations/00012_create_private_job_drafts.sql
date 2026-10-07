-- +goose Up
-- +goose StatementBegin
-- Private vacancy drafts (T3). A draft is a separate authoring resource, NOT a
-- nullable expansion of legacy `jobs` rows: legacy public/update/delete routes
-- must never find a draft id.
--
-- Columns
--   id                      UUID PK       -- application-generated (v7).
--   company_id              UUID FK       -- owning company; IMMUTABLE.
--   created_by              UUID FK       -- the creator; IMMUTABLE, server-owned.
--   principal_recruiter_id  UUID FK       -- draft principal; IMMUTABLE in this slice.
--   status                  TEXT          -- closed set: 'draft'.
--   version                 BIGINT        -- positive; the CAS/ETag version.
--   fields                  BYTEA         -- canonical writable bytes
--                                         -- {"schema_version":1,"fields":{...}}.
--                                         -- Preserves exact strings and mark order.
--   created_at / updated_at TIMESTAMPTZ   -- server time.
--
-- Immutability of company_id / created_by / principal_recruiter_id is enforced
-- by the adapter, whose only UPDATE statement touches `fields`, `version` and
-- `updated_at` (see draftstore/store.go).
CREATE TABLE job_drafts (
    id                     UUID PRIMARY KEY,
    company_id             UUID NOT NULL REFERENCES companies (id),
    created_by             UUID NOT NULL REFERENCES users (id),
    principal_recruiter_id UUID NOT NULL REFERENCES users (id),
    status                 TEXT NOT NULL DEFAULT 'draft'
        CONSTRAINT job_drafts_status_check CHECK (status IN ('draft')),
    version                BIGINT NOT NULL DEFAULT 1
        CONSTRAINT job_drafts_version_positive CHECK (version > 0),
    fields                 BYTEA NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX job_drafts_company_id_idx ON job_drafts (company_id);

-- POST idempotency: one row per (company, actor, operation, key). No TTL while
-- the draft exists; the normalized fingerprint decides replay vs conflict and
-- the original response body + ETag are frozen at creation time.
CREATE TABLE job_draft_idempotency (
    id            UUID PRIMARY KEY,
    company_id    UUID NOT NULL REFERENCES companies (id),
    actor_id      UUID NOT NULL REFERENCES users (id),
    operation     TEXT NOT NULL,
    idem_key      TEXT NOT NULL,
    fingerprint   BYTEA NOT NULL,
    response_body BYTEA NOT NULL,
    response_etag TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT job_draft_idempotency_unique
        UNIQUE (company_id, actor_id, operation, idem_key)
);

-- Minimal immutable requester catalog. `name_key` is the full-Unicode casefold
-- lookup key produced by the RequesterName value object; `normalization_version`
-- records which normalization algorithm produced the key so a future algorithm
-- change is observable rather than silent. This slice only validates a
-- referenced (id, kind, company) and reads `name`; the requester HTTP surface is
-- out of scope.
CREATE TABLE job_draft_requesters (
    id                    UUID PRIMARY KEY,
    company_id            UUID NOT NULL REFERENCES companies (id),
    kind                  TEXT NOT NULL
        CONSTRAINT job_draft_requesters_kind_check CHECK (kind IN ('internal_area', 'client')),
    name                  TEXT NOT NULL,
    name_key              TEXT NOT NULL,
    normalization_version INTEGER NOT NULL DEFAULT 1,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT job_draft_requesters_unique UNIQUE (company_id, kind, name_key)
);

CREATE INDEX job_draft_requesters_company_kind_idx
    ON job_draft_requesters (company_id, kind);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE job_draft_requesters;
DROP TABLE job_draft_idempotency;
DROP TABLE job_drafts;
-- +goose StatementEnd
