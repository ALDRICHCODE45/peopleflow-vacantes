-- name: ListActiveIndustries :many
SELECT * FROM industries
WHERE active = true
ORDER BY sort_order, id;
