-- name: GetPublishedScreeningSource :one
SELECT d.fields FROM job_drafts d
JOIN vacancy_processes p ON p.id = d.id
JOIN vacancy_public_projections v ON v.id = p.id
JOIN companies c ON c.id = p.company_id
WHERE p.id = $1 AND p.status = 'published' AND c.status = 'active' AND c.deleted_at IS NULL;
