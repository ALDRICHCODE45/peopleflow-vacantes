-- name: UpsertVacancyPublicProjection :exec
INSERT INTO vacancy_public_projections (
 id,company_id,title,description,description_plain,location,work_mode,work_schedule,
 contract_type,professional_area,seniority,required_requirements,preferred_requirements,
 benefits,compensation,published_at,source_draft_version,skills,screening_questions
) VALUES (
 sqlc.arg('id')::uuid,sqlc.arg('company_id')::uuid,sqlc.arg('title')::text,
 sqlc.narg('description')::jsonb,sqlc.arg('description_plain')::text,
 sqlc.arg('location')::text,sqlc.arg('work_mode')::text,sqlc.arg('work_schedule')::text,
 sqlc.arg('contract_type')::text,sqlc.arg('professional_area')::text,
 sqlc.narg('seniority')::text,sqlc.narg('required_requirements')::text,
 sqlc.narg('preferred_requirements')::text,sqlc.arg('benefits')::jsonb,
 sqlc.narg('compensation')::jsonb,sqlc.arg('published_at')::timestamptz,
 sqlc.arg('source_draft_version')::bigint,sqlc.arg('skills')::text[],sqlc.arg('screening_questions')::int
) ON CONFLICT (id) DO UPDATE SET
 title=EXCLUDED.title,description=EXCLUDED.description,description_plain=EXCLUDED.description_plain,
 location=EXCLUDED.location,work_mode=EXCLUDED.work_mode,work_schedule=EXCLUDED.work_schedule,
 contract_type=EXCLUDED.contract_type,professional_area=EXCLUDED.professional_area,
 seniority=EXCLUDED.seniority,required_requirements=EXCLUDED.required_requirements,
 preferred_requirements=EXCLUDED.preferred_requirements,benefits=EXCLUDED.benefits,
 compensation=EXCLUDED.compensation,source_draft_version=EXCLUDED.source_draft_version,
 skills=EXCLUDED.skills,screening_questions=EXCLUDED.screening_questions;
