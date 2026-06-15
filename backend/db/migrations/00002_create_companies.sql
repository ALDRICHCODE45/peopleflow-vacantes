-- +goose Up
CREATE TABLE companies (
    id           UUID PRIMARY KEY,
    name         TEXT NOT NULL,
    rfc          TEXT NOT NULL,
    industry_id  TEXT NOT NULL REFERENCES industries (id),
    website      TEXT,
    logo_url     TEXT,
    status       TEXT NOT NULL DEFAULT 'pending_verification'
        CONSTRAINT companies_status_check
        CHECK (status IN ('pending_verification', 'active', 'suspended')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ
);

CREATE INDEX companies_industry_id_idx ON companies (industry_id);

CREATE UNIQUE INDEX companies_rfc_unique
    ON companies (rfc) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE companies;
