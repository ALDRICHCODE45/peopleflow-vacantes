//go:build integration

package v2

// These fixture statements keep the former principal setup intent, while every
// seeded draft has the same team/assignment/function shape as a real creation.
const insertFixtureDraft = `WITH d AS (
 INSERT INTO job_drafts(id,company_id,created_by,fields) VALUES($1,$2,$3,$4) RETURNING *
), t AS (
 INSERT INTO vacancy_teams(draft_id,company_id,mode,updated_at) SELECT id,company_id,'with_responsible',created_at FROM d RETURNING draft_id
), a AS (
 INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,started_by,start_cause)
 SELECT gen_random_uuid(),d.id,d.company_id,d.created_by,d.created_at,d.created_by,'creation' FROM d JOIN t ON t.draft_id=d.id RETURNING *
) INSERT INTO vacancy_assignment_functions(id,assignment_id,draft_id,function,started_at,start_cause)
 SELECT gen_random_uuid(),id,draft_id,'responsible',started_at,'creation' FROM a`

const cloneDraftWithTeam = `WITH d AS (
 INSERT INTO job_drafts(id,company_id,created_by,fields) SELECT $1,company_id,created_by,fields FROM job_drafts WHERE id=$2 RETURNING *
), t AS (
 INSERT INTO vacancy_teams(draft_id,company_id,mode,updated_at) SELECT id,company_id,'with_responsible',created_at FROM d RETURNING draft_id
), a AS (
 INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,started_by,start_cause)
 SELECT gen_random_uuid(),d.id,d.company_id,old.user_id,d.created_at,d.created_by,'creation' FROM d JOIN t ON t.draft_id=d.id
 JOIN vacancy_assignments old ON old.draft_id=$2 AND old.ended_at IS NULL
 JOIN vacancy_assignment_functions f ON f.assignment_id=old.id AND f.ended_at IS NULL AND f.function='responsible' RETURNING *
) INSERT INTO vacancy_assignment_functions(id,assignment_id,draft_id,function,started_at,start_cause)
 SELECT gen_random_uuid(),id,draft_id,'responsible',started_at,'creation' FROM a`

const fixtureResponsibleQuery = `SELECT a.user_id FROM vacancy_assignments a JOIN vacancy_assignment_functions f ON f.assignment_id=a.id
 WHERE a.draft_id=$1 AND a.ended_at IS NULL AND f.ended_at IS NULL AND f.function='responsible'`

// Existing authorization fixtures replace their sole initial user in place;
// they intentionally do not model a historical ended stay.
const replaceFixtureResponsible = `UPDATE vacancy_assignments SET user_id=$2 WHERE draft_id=$1 AND ended_at IS NULL`
