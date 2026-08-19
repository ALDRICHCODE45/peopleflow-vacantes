-- +goose Up
-- +goose StatementBegin
CREATE TABLE users (
    id          UUID PRIMARY KEY,
    cognito_sub TEXT NOT NULL,
    email       TEXT NOT NULL,
    full_name   TEXT NOT NULL,
    user_type   TEXT NOT NULL
        CONSTRAINT users_user_type_check
        CHECK (user_type IN ('candidate', 'recruiter')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

-- Named partial unique indexes so the Cognito upsert can target the right
-- conflict predicate and so the email branch of mapCreateError can identify
-- which constraint fired.
CREATE UNIQUE INDEX users_cognito_sub_unique
    ON users (cognito_sub) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX users_email_unique
    ON users (email) WHERE deleted_at IS NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE users;
-- +goose StatementEnd
