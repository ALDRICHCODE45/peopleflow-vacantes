-- name: CreateApplication :one
-- Atomic apply + eligibility gate for POST /jobs/{jobId}/applications
-- (design D1).
--
-- The visibility predicate lives entirely in SQL (no Go-level read
-- between middleware and INSERT). A zero-row outcome (draft / closed /
-- soft-deleted job, suspended / pending_verification / missing company,
-- or non-existent job) surfaces as pgx.ErrNoRows and the adapter maps
-- it to ErrJobNotApplicable (404 "job not applicable" — single body
-- shape, no leak).
--
-- status is NOT inserted: the DB DEFAULT 'submitted' applies, so the
-- row is born in the closed vocabulary's start state and no client write
-- path can set a different value on create.
--
-- cv_s3_key and anonymized_at are NOT in the INSERT column list and
-- NOT in the RETURNING list — the reserved columns stay NULL and never
-- reach the wire (D11).
--
-- source / cover_letter are sqlc.narg (nullable): absent on the wire →
-- SQL NULL.
INSERT INTO applications (id, job_id, candidate_id, source, cover_letter)
SELECT
    sqlc.arg('id')::uuid,
    sqlc.arg('job_id')::uuid,
    sqlc.arg('candidate_id')::uuid,
    sqlc.narg('source')::text,
    sqlc.narg('cover_letter')::text
WHERE EXISTS (
    SELECT 1
    FROM jobs j
    JOIN companies c ON c.id = j.company_id
    WHERE j.id = sqlc.arg('job_id')::uuid
      AND j.status = 'published'
      AND j.deleted_at IS NULL
      AND c.status = 'active'
)
RETURNING id, job_id, candidate_id, status, source, cover_letter, created_at, updated_at;

-- name: GetApplicationByID :one
-- Recruiter detail endpoint (design D5 / spec scenario "recruiter gets
-- an application's detail"). Scopes by (id, job_id, company_id) and
-- joins users (full_name) + candidate_profiles (LEFT JOIN — professional
-- title + years_of_experience ONLY for PII minimization, D12).
--
-- 0 rows → pgx.ErrNoRows → entities.ErrApplicationNotFound (404).
SELECT
    a.id, a.job_id, a.candidate_id, a.status, a.source, a.cover_letter,
    a.created_at, a.updated_at,
    u.full_name AS candidate_full_name,
    cp.professional_title AS candidate_professional_title,
    cp.years_of_experience AS candidate_years_of_experience
FROM applications a
JOIN jobs j ON j.id = a.job_id
JOIN users u ON u.id = a.candidate_id
LEFT JOIN candidate_profiles cp ON cp.user_id = a.candidate_id
WHERE a.id         = sqlc.arg('id')::uuid
  AND a.job_id     = sqlc.arg('job_id')::uuid
  AND j.company_id = sqlc.arg('company_id')::uuid;

-- name: ListApplicationsByJob :many
-- Recruiter queue read (design D5 second step). Same-company scope
-- enforced inside the same statement. NO deleted_at / status filter on
-- jobs: soft-deleted jobs' applications remain recruiter-accessible
-- (locked decision).
--
-- Hard cap 100 (no pagination in this slice).
SELECT
    a.id, a.job_id, a.candidate_id, a.status, a.source, a.cover_letter,
    a.created_at, a.updated_at,
    u.full_name AS candidate_full_name,
    cp.professional_title AS candidate_professional_title,
    cp.years_of_experience AS candidate_years_of_experience
FROM applications a
JOIN jobs j ON j.id = a.job_id
JOIN users u ON u.id = a.candidate_id
LEFT JOIN candidate_profiles cp ON cp.user_id = a.candidate_id
WHERE a.job_id     = sqlc.arg('job_id')::uuid
  AND j.company_id = sqlc.arg('company_id')::uuid
ORDER BY a.created_at DESC, a.id DESC
LIMIT 100;

-- name: ListMyApplications :many
-- Candidate's GET /me/applications list. Joins jobs (title) + companies
-- (id, name) to render the embedded job summary. NOT redacted by
-- jobs.deleted_at on purpose: the candidate's own history persists
-- even if the job has since been soft-deleted (locked decision).
--
-- Hard cap 100 (no pagination in this slice).
SELECT
    a.id, a.job_id, a.candidate_id, a.status, a.source, a.cover_letter,
    a.created_at, a.updated_at,
    j.title AS job_title,
    c.id   AS company_id,
    c.name AS company_name
FROM applications a
JOIN jobs j ON j.id = a.job_id
JOIN companies c ON c.id = j.company_id
WHERE a.candidate_id = sqlc.arg('candidate_id')::uuid
ORDER BY a.created_at DESC, a.id DESC
LIMIT 100;

-- name: TransitionStatus :one
-- Recruiter transition with the same-company invariant + the lost-race
-- status guard (no CAS — design D3). The WHERE narrows to (id, job_id,
-- status = expected_from) and scopes the owning job to the caller's
-- company via EXISTS. 0 rows → pgx.ErrNoRows → ErrApplicationNotFound
-- (lost race / cross-company / non-existent / mismatched job —
-- indistinguishable, 404).
--
-- No deleted_at / status filter on jobs: transitions on soft-deleted
-- jobs' applications remain legal (historical pipeline).
UPDATE applications a
SET status     = sqlc.arg('to_status')::text,
    updated_at = now()
WHERE a.id        = sqlc.arg('id')::uuid
  AND a.job_id    = sqlc.arg('job_id')::uuid
  AND a.status    = sqlc.arg('from_status')::text
  AND EXISTS (
      SELECT 1
      FROM jobs j
      WHERE j.id = a.job_id
        AND j.company_id = sqlc.arg('company_id')::uuid
  )
RETURNING id, job_id, candidate_id, status, source, cover_letter, created_at, updated_at;

-- name: GetJobForApplicationsScope :one
-- Same-company scope check for the recruiter list (design D5). Reads
-- jobs directly (cross-feature SQL in the applications adapter; the
-- jobs port is NOT extended). No deleted_at / status filter: soft-
-- deleted jobs remain recruiter-accessible.
--
-- 0 rows → pgx.ErrNoRows → ErrApplicationNotFound (cross-company /
-- non-existent).
SELECT id
FROM jobs
WHERE id         = sqlc.arg('job_id')::uuid
  AND company_id = sqlc.arg('company_id')::uuid;
