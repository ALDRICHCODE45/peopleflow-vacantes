-- +goose Up
CREATE TABLE vacancy_teams (
 draft_id uuid PRIMARY KEY REFERENCES job_drafts(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies(id),
 mode text NOT NULL CHECK (mode IN ('with_responsible','shared')),
 version bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL
);
CREATE TABLE vacancy_assignments (
 id uuid PRIMARY KEY,
 draft_id uuid NOT NULL REFERENCES vacancy_teams(draft_id) ON DELETE CASCADE,
 company_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id),
 started_at timestamptz NOT NULL,
 started_by uuid NULL REFERENCES users(id),
 start_cause text NOT NULL CHECK (start_cause IN ('creation','added','reassignment','backfill')),
 recruiter_deadline date NULL,
 ended_at timestamptz NULL,
 ended_by uuid NULL REFERENCES users(id),
 end_cause text NULL CHECK (end_cause IN ('removed','left','reassigned','membership_ended')),
 closing_deadline date NULL,
 reassignment_id uuid NULL,
 CHECK ((ended_at IS NULL) = (end_cause IS NULL)),
 CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX vacancy_assignments_one_active_per_user ON vacancy_assignments(draft_id,user_id) WHERE ended_at IS NULL;
CREATE INDEX vacancy_assignments_active_by_user ON vacancy_assignments(user_id) WHERE ended_at IS NULL;
CREATE INDEX vacancy_assignments_by_user ON vacancy_assignments(user_id,started_at DESC);
CREATE TABLE vacancy_assignment_functions (
 id uuid PRIMARY KEY,
 assignment_id uuid NOT NULL REFERENCES vacancy_assignments(id) ON DELETE CASCADE,
 draft_id uuid NOT NULL,
 function text NOT NULL CHECK (function IN ('responsible','collaborator','member')),
 started_at timestamptz NOT NULL,
 start_cause text NOT NULL CHECK (start_cause IN ('creation','added','reassignment','mode_change','backfill')),
 ended_at timestamptz NULL,
 end_cause text NULL CHECK (end_cause IN ('reassignment','mode_change','tramo_ended')),
 CHECK ((ended_at IS NULL) = (end_cause IS NULL))
);
CREATE UNIQUE INDEX vacancy_assignment_functions_one_open ON vacancy_assignment_functions(assignment_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX vacancy_assignment_functions_one_responsible ON vacancy_assignment_functions(draft_id) WHERE ended_at IS NULL AND function='responsible';
CREATE TABLE vacancy_reassignments (
 id uuid PRIMARY KEY,
 draft_id uuid NOT NULL REFERENCES vacancy_teams(draft_id) ON DELETE CASCADE,
 company_id uuid NOT NULL,
 from_assignment_id uuid NOT NULL REFERENCES vacancy_assignments(id),
 to_assignment_id uuid NOT NULL REFERENCES vacancy_assignments(id),
 reason text NOT NULL CHECK (reason IN ('workload','recruiter_departure','performance','client_request','other')),
 note text NULL CHECK (reason <> 'other' OR length(btrim(note)) BETWEEN 1 AND 500),
 previous_responsible text NOT NULL CHECK (previous_responsible IN ('remove','keep_as_collaborator')),
 performed_by uuid NOT NULL REFERENCES users(id),
 performed_at timestamptz NOT NULL,
 state_snapshot jsonb NOT NULL
);
CREATE TABLE vacancy_team_mode_changes (
 id uuid PRIMARY KEY,
 draft_id uuid NOT NULL REFERENCES vacancy_teams(draft_id) ON DELETE CASCADE,
 company_id uuid NOT NULL,
 from_mode text NOT NULL CHECK (from_mode IN ('with_responsible','shared')),
 to_mode text NOT NULL CHECK (to_mode IN ('with_responsible','shared') AND to_mode <> from_mode),
 responsible_user_id uuid NULL REFERENCES users(id),
 performed_by uuid NOT NULL REFERENCES users(id),
 performed_at timestamptz NOT NULL
);
CREATE TABLE vacancy_commitment_changes (
 id uuid PRIMARY KEY,
 draft_id uuid NOT NULL REFERENCES job_drafts(id) ON DELETE CASCADE,
 company_id uuid NOT NULL,
 previous_date date NULL,
 new_date date NOT NULL,
 reason text NOT NULL CHECK (reason IN ('client_request','scope_change','internal_delay','other')),
 note text NULL CHECK (reason <> 'other' OR length(btrim(note)) BETWEEN 1 AND 500),
 performed_by uuid NOT NULL REFERENCES users(id),
 performed_at timestamptz NOT NULL
);
CREATE TABLE placement_credits (
 id uuid PRIMARY KEY,
 company_id uuid NOT NULL,
 process_id uuid NOT NULL,
 participation_id uuid NOT NULL,
 hire_history_id uuid NOT NULL UNIQUE,
 hired_at timestamptz NOT NULL,
 hired_by uuid NOT NULL REFERENCES users(id),
 team_mode text NOT NULL CHECK (team_mode IN ('with_responsible','shared')),
 status text NOT NULL CHECK (status IN ('active','did_not_hold','voided')) DEFAULT 'active',
 exit_history_id uuid NULL,
 exit_reason text NULL CHECK (exit_reason IN ('moved_by_mistake','candidate_left')),
 status_changed_at timestamptz NULL,
 status_changed_by uuid NULL REFERENCES users(id)
);
CREATE TABLE placement_credit_recipients (
 credit_id uuid NOT NULL REFERENCES placement_credits(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id),
 assignment_id uuid NOT NULL REFERENCES vacancy_assignments(id),
 kind text NOT NULL CHECK (kind IN ('direct','participant','shared')),
 PRIMARY KEY (credit_id,user_id)
);

INSERT INTO vacancy_teams(draft_id,company_id,mode,updated_at)
 SELECT id,company_id,'with_responsible',created_at FROM job_drafts;
INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,start_cause)
 SELECT gen_random_uuid(),id,company_id,principal_recruiter_id,created_at,'backfill' FROM job_drafts;
INSERT INTO vacancy_assignment_functions(id,assignment_id,draft_id,function,started_at,start_cause)
 SELECT gen_random_uuid(),id,draft_id,'responsible',started_at,'backfill' FROM vacancy_assignments;
ALTER TABLE job_drafts DROP COLUMN principal_recruiter_id;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
 LOCK TABLE job_drafts IN ACCESS EXCLUSIVE MODE;
 LOCK TABLE vacancy_teams, vacancy_assignments, vacancy_assignment_functions,
  vacancy_reassignments, vacancy_commitment_changes, vacancy_team_mode_changes,
  placement_credits, placement_credit_recipients IN ACCESS EXCLUSIVE MODE;
 IF EXISTS (SELECT 1 FROM job_drafts d WHERE NOT EXISTS (
  SELECT 1 FROM vacancy_assignments a JOIN vacancy_assignment_functions f ON f.assignment_id=a.id
  WHERE a.draft_id=d.id AND a.ended_at IS NULL AND f.ended_at IS NULL AND f.function='responsible'
 )) THEN
  RAISE EXCEPTION 'cannot remove vacancy teams: draft without an open responsible';
 END IF;
 IF EXISTS (SELECT 1 FROM placement_credits) OR EXISTS (SELECT 1 FROM vacancy_reassignments)
  OR EXISTS (SELECT 1 FROM vacancy_commitment_changes) OR EXISTS (SELECT 1 FROM vacancy_team_mode_changes) THEN
  RAISE EXCEPTION 'cannot remove vacancy teams: placement credits or team/commitment history exists';
 END IF;
END;
$$;
ALTER TABLE job_drafts ADD COLUMN principal_recruiter_id uuid;
UPDATE job_drafts d SET principal_recruiter_id=a.user_id
 FROM vacancy_assignments a JOIN vacancy_assignment_functions f ON f.assignment_id=a.id
 WHERE a.draft_id=d.id AND a.ended_at IS NULL AND f.ended_at IS NULL AND f.function='responsible';
ALTER TABLE job_drafts ALTER COLUMN principal_recruiter_id SET NOT NULL,
 ADD CONSTRAINT job_drafts_principal_recruiter_id_fkey FOREIGN KEY (principal_recruiter_id) REFERENCES users(id);
DROP TABLE placement_credit_recipients;
DROP TABLE placement_credits;
DROP TABLE vacancy_commitment_changes;
DROP TABLE vacancy_team_mode_changes;
DROP TABLE vacancy_reassignments;
DROP TABLE vacancy_assignment_functions;
DROP TABLE vacancy_assignments;
DROP TABLE vacancy_teams;
-- +goose StatementEnd
