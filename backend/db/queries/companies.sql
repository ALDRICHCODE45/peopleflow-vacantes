-- name: CreateCompany :one
INSERT INTO companies (
    id, name, rfc, industry_id, website, logo_url,
    description, size, founded_year, city, country,
    linkedin_url, instagram_url, facebook_url, twitter_url, cover_image_url
)
VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10, $11,
    $12, $13, $14, $15, $16
)
RETURNING *;


-- name: GetCompanyByID :one
SELECT * FROM companies
WHERE id = $1 AND deleted_at IS NULL;
