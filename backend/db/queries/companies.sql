-- name: CreateCompany :one
INSERT INTO companies (id, name, rfc, industry_id, website, logo_url)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;


-- name: GetCompanyByID :one
SELECT * FROM companies 
WHERE id = $1 AND deleted_at IS NULL;
