-- +goose Up
-- +goose StatementBegin
-- Additive VAC-4 read model; no backfill. Down removes only this projection.
CREATE TABLE vacancy_public_projections (
    id UUID PRIMARY KEY REFERENCES vacancy_processes (id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies (id),
    title TEXT NOT NULL,
    description JSONB,
    description_plain TEXT NOT NULL,
    location TEXT NOT NULL,
    work_mode TEXT NOT NULL CHECK (work_mode IN ('onsite','remote','hybrid')),
    work_schedule TEXT NOT NULL CHECK (work_schedule IN ('full_time','part_time')),
    contract_type TEXT NOT NULL CHECK (contract_type IN ('project','indefinite','professional_services','temporary','internship')),
    professional_area TEXT NOT NULL,
    seniority TEXT CHECK (seniority IN ('intern','junior','mid','senior','lead')),
    required_requirements TEXT,
    preferred_requirements TEXT,
    benefits JSONB NOT NULL,
    compensation JSONB,
    published_at TIMESTAMPTZ NOT NULL,
    source_draft_version BIGINT NOT NULL CHECK (source_draft_version > 0),
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(description_plain, '')), 'B')
    ) STORED
);
CREATE INDEX vacancy_public_search_idx ON vacancy_public_projections USING GIN (search_vector);
CREATE INDEX vacancy_public_listing_idx ON vacancy_public_projections (published_at DESC, id DESC);
CREATE INDEX vacancy_public_company_idx ON vacancy_public_projections (company_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE vacancy_public_projections;
-- +goose StatementEnd
