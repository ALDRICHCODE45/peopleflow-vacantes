-- name: SearchPublicJobs :many
-- Explicit public allowlists. Legacy dimensions are deliberately NULL: an
-- employment_type is not a schedule or contract type. Rank is float8 on both
-- sides of the keyset comparison so cursor round-trips lose no precision.
WITH catalog AS (
 SELECT j.id, 'legacy'::text AS source, j.published_at, j.location,
        j.work_mode, NULL::text AS work_schedule, NULL::text AS contract_type,
        NULL::text AS professional_area, j.search_vector,
        jsonb_build_object(
          'id',j.id,'source','legacy','title',j.title,
          'company',jsonb_build_object('id',c.id,'name',c.name),
          'location',j.location,'work_mode',j.work_mode,
          'work_schedule',NULL,'contract_type',NULL,'professional_area',NULL,
          'seniority',j.seniority,'legacy_employment_type',j.employment_type,
          'compensation',NULL,
          'legacy_salary',CASE WHEN j.salary_min IS NULL AND j.salary_max IS NULL THEN NULL
            ELSE jsonb_build_object('min',CASE WHEN j.salary_min IS NULL THEN NULL ELSE j.salary_min::text || '.00' END,
                                    'max',CASE WHEN j.salary_max IS NULL THEN NULL ELSE j.salary_max::text || '.00' END,
                                    'currency',j.salary_currency) END,
          'published_at',j.published_at,'description',NULL,
          'description_plain',j.description,
          'requirements',jsonb_build_object('required',NULL,'preferred',NULL),
          'benefits',jsonb_build_object('predefined','[]'::jsonb,'custom','[]'::jsonb)
        ) AS body
 FROM jobs j JOIN companies c ON c.id=j.company_id
 WHERE j.status='published' AND j.deleted_at IS NULL AND j.published_at IS NOT NULL
   AND c.status='active' AND c.deleted_at IS NULL
 UNION ALL
 SELECT p.id, 'vacancy'::text AS source, p.published_at, p.location,
        p.work_mode,p.work_schedule,p.contract_type,p.professional_area,p.search_vector,
        jsonb_build_object(
          'id',p.id,'source','vacancy','title',p.title,
          'company',jsonb_build_object('id',c.id,'name',c.name),
          'location',p.location,'work_mode',p.work_mode,
          'work_schedule',p.work_schedule,'contract_type',p.contract_type,
          'professional_area',p.professional_area,'seniority',p.seniority,
          'legacy_employment_type',NULL,'compensation',p.compensation,'legacy_salary',NULL,
          'published_at',p.published_at,'description',p.description,
          'description_plain',p.description_plain,
          'requirements',jsonb_build_object('required',p.required_requirements,'preferred',p.preferred_requirements),
          'benefits',p.benefits
        ) AS body
 FROM vacancy_public_projections p
 JOIN vacancy_processes v ON v.id=p.id AND v.company_id=p.company_id
 JOIN companies c ON c.id=p.company_id
 WHERE v.status='published' AND c.status='active' AND c.deleted_at IS NULL
), ranked AS (
 SELECT catalog.*, ts_rank(search_vector,websearch_to_tsquery('spanish',sqlc.arg('q')::text))::float8 AS search_rank
 FROM catalog
 WHERE (sqlc.arg('q')::text='' OR search_vector @@ websearch_to_tsquery('spanish',sqlc.arg('q')::text))
   AND (sqlc.arg('location')::text='' OR strpos(lower(location),lower(sqlc.arg('location')::text))>0)
   AND (sqlc.arg('work_mode')::text='' OR work_mode=sqlc.arg('work_mode')::text)
   AND (sqlc.arg('work_schedule')::text='' OR work_schedule=sqlc.arg('work_schedule')::text)
   AND (sqlc.arg('contract_type')::text='' OR contract_type=sqlc.arg('contract_type')::text)
   AND (sqlc.arg('professional_area')::text='' OR professional_area=sqlc.arg('professional_area')::text)
   AND (sqlc.narg('detail_id')::uuid IS NULL OR id=sqlc.narg('detail_id')::uuid)
)
SELECT body,search_rank FROM ranked
WHERE (sqlc.narg('cursor_ts')::timestamptz IS NULL OR
       (search_rank,published_at,source COLLATE "C",id) <
       (sqlc.arg('cursor_rank')::float8,sqlc.narg('cursor_ts')::timestamptz,
        sqlc.arg('cursor_source')::text COLLATE "C",sqlc.arg('cursor_id')::uuid))
ORDER BY search_rank DESC,published_at DESC,source COLLATE "C" DESC,id DESC
LIMIT sqlc.arg('page_limit')::int;
