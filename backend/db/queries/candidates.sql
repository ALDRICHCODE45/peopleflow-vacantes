-- name: UpsertCandidateProfile :one
-- Idempotent upsert keyed on the PK (user_id). First PUT creates the row;
-- subsequent PUTs overwrite the editable columns. search_vector is a STORED
-- generated column owned by Postgres and MUST NOT be touched here.
INSERT INTO candidate_profiles (
    user_id, phone, linkedin_url, portfolio_url, professional_title,
    current_company, years_of_experience, profile_summary, birth_date,
    city, country, education_level, field_of_study, skills,
    current_salary_gross, current_salary_net, expected_salary,
    salary_currency, expected_salary_period, cv_s3_key,
    created_at, updated_at
)
VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9,
    $10, $11, $12, $13, $14,
    $15, $16, $17,
    $18, $19, $20,
    now(), now()
)
ON CONFLICT (user_id) DO UPDATE SET
    phone                  = EXCLUDED.phone,
    linkedin_url           = EXCLUDED.linkedin_url,
    portfolio_url          = EXCLUDED.portfolio_url,
    professional_title     = EXCLUDED.professional_title,
    current_company        = EXCLUDED.current_company,
    years_of_experience    = EXCLUDED.years_of_experience,
    profile_summary        = EXCLUDED.profile_summary,
    birth_date             = EXCLUDED.birth_date,
    city                   = EXCLUDED.city,
    country                = EXCLUDED.country,
    education_level        = EXCLUDED.education_level,
    field_of_study         = EXCLUDED.field_of_study,
    skills                 = EXCLUDED.skills,
    current_salary_gross   = EXCLUDED.current_salary_gross,
    current_salary_net     = EXCLUDED.current_salary_net,
    expected_salary        = EXCLUDED.expected_salary,
    salary_currency        = EXCLUDED.salary_currency,
    expected_salary_period = EXCLUDED.expected_salary_period,
    cv_s3_key              = EXCLUDED.cv_s3_key,
    updated_at             = now()
RETURNING *;

-- name: GetCandidateProfileByUserID :one
SELECT * FROM candidate_profiles
WHERE user_id = $1;

-- name: ListCandidateLanguagesByUserID :many
SELECT user_id, language, level FROM candidate_languages
WHERE user_id = $1
ORDER BY language;

-- name: DeleteCandidateLanguagesByUserID :exec
DELETE FROM candidate_languages
WHERE user_id = $1;

-- name: InsertCandidateLanguage :exec
-- Used inside the atomic replace transaction. Composite PK (user_id, language)
-- prevents duplicate languages for the same user — the adapter surfaces a
-- 23505 as ErrDuplicateLanguage.
INSERT INTO candidate_languages (user_id, language, level)
VALUES ($1, $2, $3);
