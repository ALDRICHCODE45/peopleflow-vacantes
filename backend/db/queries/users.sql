-- name: CreateUser :one
-- Idempotent upsert keyed on the partial unique index `users_cognito_sub_unique`.
-- The `WHERE deleted_at IS NULL` predicate is required: a bare `ON CONFLICT (cognito_sub)`
-- would not match the partial index and would raise SQLSTATE 42P10.
-- On conflict, `RETURNING *` produces zero rows so pgx returns pgx.ErrNoRows;
-- the adapter re-fetches by cognito_sub to return the existing entity.
INSERT INTO users (id, cognito_sub, email, full_name, user_type)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (cognito_sub) WHERE deleted_at IS NULL DO NOTHING
RETURNING *;

-- name: GetUserByID :one
SELECT * FROM users
WHERE id = $1 AND deleted_at IS NULL;

-- name: GetUserByCognitoSub :one
SELECT * FROM users
WHERE cognito_sub = $1 AND deleted_at IS NULL;
