package pool

import "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/candidateview"

// Manual reads are live, with the same six-key projection as board/profile_sql.go.
// There is deliberately no query of candidate_profiles or candidate contact tables.
const manualProfileSQL = `jsonb_build_object(
 'location',jsonb_build_object('country',cc.country_code,'state',cc.state_code,'municipality',cc.municipality_code),
 'skills',cc.skills,'years_of_experience',trim_scale(cc.years_of_experience)::text,'seniority',cc.seniority,
 'education',jsonb_build_object('highest_completed',
   (SELECT level FROM company_candidate_educations e WHERE e.company_candidate_id=cc.id AND e.status='completed'
    ORDER BY array_position(ARRAY['secondary','high_school','technical','tsu','bachelor','specialty','master','phd'],e.level) DESC,e.position,e.id LIMIT 1),
   'in_progress',(SELECT level FROM company_candidate_educations e WHERE e.company_candidate_id=cc.id AND e.status='in_progress' ORDER BY array_position(ARRAY['secondary','high_school','technical','tsu','bachelor','specialty','master','phd'],e.level) DESC,e.position,e.id LIMIT 1)),
 'languages',COALESCE((SELECT jsonb_agg(jsonb_build_object('code',l.code,'level',l.level) ORDER BY l.code)
   FROM company_candidate_languages l WHERE l.company_candidate_id=cc.id),'[]'::jsonb))`
const emptyProfileSQL = candidateview.EmptyProfileSQL

// The identity set and snapshot choice are company-scoped before filtering.
// source does not determine identity kind, and discarded rows are not removed.
var poolSQL = `WITH participations AS MATERIALIZED (
 SELECT p.id,p.process_id,p.stage_id,p.created_at,p.discarded_at,p.profile_snapshot,
 vp.process_status IS DISTINCT FROM 'finished' AS process_open,
 CASE WHEN p.company_candidate_id IS NULL THEN 'organic' ELSE 'manual' END AS kind,
 COALESCE(p.company_candidate_id,p.candidate_id) AS person_id,
 row_number() OVER (PARTITION BY p.company_candidate_id,p.candidate_id ORDER BY p.created_at DESC,p.id DESC) AS ordinal
 FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id WHERE vp.company_id=$1
), counts AS (
 SELECT kind,person_id,count(*) AS total,count(*) FILTER(WHERE discarded_at IS NULL AND process_open) AS active,
 min(created_at) AS first_applied_at
 FROM participations GROUP BY kind,person_id
), identities AS (
 SELECT 'manual'::text AS kind,cc.id,cc.full_name,cc.email,cc.professional_title,cc.current_company,cc.created_at,cc.postal_code,` + manualProfileSQL + ` AS manual_profile
 FROM company_candidates cc WHERE cc.company_id=$1
 UNION ALL
 SELECT 'organic',u.id,u.full_name,u.email,NULL::text,NULL::text,NULL::timestamptz,NULL::text,NULL::jsonb
 FROM users u WHERE EXISTS(SELECT 1 FROM participations p WHERE p.kind='organic' AND p.person_id=u.id)
), uncorrected AS (
 SELECT i.kind,i.id,i.full_name,i.email,i.professional_title,i.current_company,i.postal_code,
 CASE WHEN i.kind='manual' THEN i.manual_profile ELSE COALESCE(last.profile_snapshot,` + emptyProfileSQL + `) END AS profile,
 COALESCE(last.created_at,i.created_at) AS last_activity_at,
 CASE WHEN i.kind='manual' THEN i.created_at ELSE c.first_applied_at END AS created_at,
 COALESCE(c.total,0) AS total,COALESCE(c.active,0) AS active,
 last.process_id,last.stage_id,last.discarded_at,last.created_at AS applied_at
 FROM identities i LEFT JOIN counts c ON c.kind=i.kind AND c.person_id=i.id
 LEFT JOIN participations last ON last.kind=i.kind AND last.person_id=i.id AND last.ordinal=1
), candidates AS (
 SELECT b.kind,b.id,
 CASE WHEN o.corrections ? 'full_name' THEN o.corrections->>'full_name' ELSE b.full_name END AS full_name,
 CASE WHEN o.corrections ? 'email' THEN o.corrections->>'email' ELSE b.email END AS email,
 CASE WHEN o.corrections ? 'professional_title' THEN o.corrections->>'professional_title' ELSE b.professional_title END AS professional_title,
 CASE WHEN o.corrections ? 'current_company' THEN o.corrections->>'current_company' ELSE b.current_company END AS current_company,
 CASE WHEN o.corrections ? 'location' THEN o.corrections#>>'{location,postal_code}' ELSE b.postal_code END AS postal_code,
 ` + candidateview.EffectiveProfileSQL("b.profile") + ` AS profile,
 b.full_name AS original_full_name,b.profile AS original_profile,
 b.last_activity_at,b.created_at,b.total,b.active,b.process_id,b.stage_id,b.discarded_at,b.applied_at
 FROM uncorrected b LEFT JOIN company_candidate_corrections o ON b.kind='organic' AND o.company_id=$1 AND o.user_id=b.id
), filtered AS MATERIALIZED (SELECT * FROM candidates WHERE true `

// Hydration is restricted to the limit+1 page; totals and rows share one SQL
// statement snapshot. No rows (including a cursor beyond the end) still returns total.
const projectionSQL = `SELECT page.kind,page.id,page.full_name,page.professional_title,page.current_company,
 CASE WHEN page.profile->'location' IS NULL OR page.profile->'location'='null'::jsonb THEN page.profile
 ELSE jsonb_set(page.profile,'{location}',jsonb_build_object(
 'country',jsonb_build_object('id',page.profile->'location'->>'country','name',gc.name_es),
 'state',CASE WHEN page.profile->'location'->>'state' IS NULL THEN NULL ELSE jsonb_build_object('id',page.profile->'location'->>'state','name',gs.name) END,
 'municipality',CASE WHEN page.profile->'location'->>'municipality' IS NULL THEN NULL ELSE jsonb_build_object('id',page.profile->'location'->>'municipality','name',gm.name) END,
 'postal_code',page.postal_code,'label',CASE WHEN gm.code IS NOT NULL THEN gm.name||', '||gs.name WHEN gs.code IS NOT NULL THEN gs.name ELSE gc.name_es END)) END AS profile,
 jsonb_build_object('total',page.total,'active',page.active) AS participations,
 CASE WHEN page.process_id IS NULL THEN NULL ELSE jsonb_build_object(
 'vacancy',jsonb_build_object('id',page.process_id,'title',COALESCE(convert_from(d.fields,'UTF8')::jsonb->'fields'->>'title',''),
 'lifecycle',jsonb_build_object('publication',CASE WHEN vp.status='draft' THEN NULL ELSE vp.status END,'process',vp.process_status)),
 'stage',jsonb_build_object('id',page.stage_id,'name',''),
 'state',CASE WHEN page.discarded_at IS NULL THEN 'active' ELSE 'discarded' END,'applied_at',page.applied_at) END AS latest_participation,
 page.last_activity_at,CASE WHEN c.configuration IS NULL THEN NULL ELSE convert_from(c.configuration,'UTF8')::jsonb END AS stage_configuration
 FROM page
 LEFT JOIN job_drafts d ON d.id=page.process_id AND d.company_id=$1
 LEFT JOIN vacancy_processes vp ON vp.id=page.process_id AND vp.company_id=$1
 LEFT JOIN job_draft_pipeline_configs c ON c.draft_id=page.process_id
 LEFT JOIN geo_countries gc ON gc.code=page.profile->'location'->>'country'
 LEFT JOIN geo_states gs ON gs.country_code=gc.code AND gs.code=page.profile->'location'->>'state'
 LEFT JOIN geo_municipalities gm ON gm.country_code=gc.code AND gm.state_code=gs.code AND gm.code=page.profile->'location'->>'municipality'`
