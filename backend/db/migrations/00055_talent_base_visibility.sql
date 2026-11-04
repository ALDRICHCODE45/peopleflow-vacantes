-- +goose Up
-- +goose StatementBegin
-- Who may use the company talent base. A company without a settings row behaves
-- as all_recruiters v1; the row is created on demand, so there is no backfill.
CREATE TABLE company_talent_base_settings (
    company_id UUID PRIMARY KEY REFERENCES companies (id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('all_recruiters', 'selected_users')),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at TIMESTAMPTZ NULL,
    updated_by UUID NULL REFERENCES users (id)
);

-- Only meaningful while mode = 'selected_users'; always empty in 'all_recruiters'.
CREATE TABLE company_talent_base_viewers (
    company_id UUID NOT NULL REFERENCES company_talent_base_settings (company_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES company_members (user_id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL,
    added_by UUID NOT NULL REFERENCES users (id),
    PRIMARY KEY (company_id, user_id)
);
-- Serves the member-removal cascade, which looks viewers up by user alone.
CREATE INDEX company_talent_base_viewers_user_idx ON company_talent_base_viewers (user_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE company_talent_base_viewers;
DROP TABLE company_talent_base_settings;
-- +goose StatementEnd
