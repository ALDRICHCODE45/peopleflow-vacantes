package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancyteam"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"math"
	"time"
)

type activeAssignment struct {
	ID, User uuid.UUID
	Function string
	Started  time.Time
	Deadline *string
}

func teamAssignments(ctx context.Context, tx pgx.Tx, id uuid.UUID) ([]activeAssignment, error) {
	rows, err := tx.Query(ctx, `SELECT a.id,a.user_id,f.function,a.started_at,a.recruiter_deadline::text FROM vacancy_assignments a JOIN vacancy_assignment_functions f ON f.assignment_id=a.id AND f.ended_at IS NULL WHERE a.draft_id=$1 AND a.ended_at IS NULL ORDER BY a.started_at,a.id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []activeAssignment{}
	for rows.Next() {
		var a activeAssignment
		if err := rows.Scan(&a.ID, &a.User, &a.Function, &a.Started, &a.Deadline); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
func openTeamFunction(ctx context.Context, tx pgx.Tx, id, assignment uuid.UUID, fn, cause string, at time.Time) error {
	_, err := tx.Exec(ctx, `INSERT INTO vacancy_assignment_functions(id,assignment_id,draft_id,function,started_at,start_cause) VALUES($1,$2,$3,$4,$5,$6)`, uuid.Must(uuid.NewV7()), assignment, id, fn, at, cause)
	return err
}
func openTeamAssignment(ctx context.Context, tx pgx.Tx, id, company, user, actor, assignment uuid.UUID, fn, cause string, deadline *string, at time.Time) error {
	if _, err := tx.Exec(ctx, `INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,started_by,start_cause,recruiter_deadline) VALUES($1,$2,$3,$4,$5,$6,$7,$8::date)`, assignment, id, company, user, at, actor, cause, deadline); err != nil {
		return err
	}
	return openTeamFunction(ctx, tx, id, assignment, fn, cause, at)
}
func closeTeamFunction(ctx context.Context, tx pgx.Tx, assignment uuid.UUID, cause string, at time.Time) error {
	_, err := tx.Exec(ctx, `UPDATE vacancy_assignment_functions SET ended_at=$2,end_cause=$3 WHERE assignment_id=$1 AND ended_at IS NULL`, assignment, at, cause)
	return err
}
func endTeamAssignment(ctx context.Context, tx pgx.Tx, a activeAssignment, actor uuid.UUID, cause string, reassignment *uuid.UUID, at time.Time) error {
	if err := closeTeamFunction(ctx, tx, a.ID, "tramo_ended", at); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE vacancy_assignments a SET ended_at=$2,ended_by=$3,end_cause=$4,reassignment_id=$5,closing_deadline=COALESCE(a.recruiter_deadline,(SELECT commitment_date FROM job_draft_delivery_configs WHERE draft_id=a.draft_id)) WHERE a.id=$1`, a.ID, at, actor, cause, reassignment)
	return err
}
func teamFingerprint(id uuid.UUID, w vacancyteam.Write) ([]byte, error) {
	value, err := draftjson.Decode(w.Body)
	if err != nil {
		return nil, drafts.ErrInvalidRequest
	}
	if input, err := vacancyteam.DecodeWrite(w.Action, w.Body); err == nil {
		raw, err := json.Marshal(input)
		if err != nil {
			return nil, err
		}
		value, err = draftjson.Decode(raw)
		if err != nil {
			return nil, err
		}
	}
	return draftjson.EncodeValidatedValue(map[string]any{"id": id.String(), "target": w.Target.String(), "body": value})
}

// replayTeamWrite is shared by the ordinary post-authorization lookup and the
// leave-only pre-authorization lookup. Fingerprints include the addressed draft.
func replayTeamWrite(ctx context.Context, tx pgx.Tx, company, actor uuid.UUID, operation, key string, fingerprint []byte) (drafts.Result, error) {
	if err := lockIdempotencyKey(ctx, tx, company, actor, operation, key); err != nil {
		return drafts.Result{}, err
	}
	existing, found, err := findIdempotency(ctx, tx, company, actor, operation, key)
	if err != nil {
		return drafts.Result{}, err
	}
	if !found {
		return drafts.Result{}, nil
	}
	match, err := fingerprintsMatch(existing.algorithm, existing.fingerprint, fingerprint)
	if err != nil {
		return drafts.Result{}, err
	}
	if !match {
		return drafts.Result{}, drafts.ErrIdempotencyConflict
	}
	return drafts.Result{Body: existing.body, ETag: existing.etag, Replayed: true}, nil
}

func (s *Store) WriteTeam(ctx context.Context, company, actor, id uuid.UUID, w vacancyteam.Write) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, err
	}
	defer tx.Rollback(ctx)
	auth, err := s.lockGates(ctx, tx, company, actor)
	if err != nil {
		return drafts.Result{}, err
	}
	record, found, err := readDraft(ctx, tx, company, id, true, actor)
	if err != nil {
		return drafts.Result{}, err
	}
	post := w.Action != vacancyteam.Mode && w.Action != vacancyteam.Deadline
	operation := "vacancy-team:" + w.Action + ":r1"
	var fingerprint []byte
	// A successful leave revokes vacancy access, but must not revoke its own
	// frozen retry while the caller still passes the locked company gates.
	// Only a matching draft+actor+action+key+body may bypass the team guard.
	// Nonmatching or malformed attempts retain the normal guard/error order.
	if w.Action == vacancyteam.Leave && w.KeyPresent {
		if key, keyErr := uuid.Parse(w.Key); keyErr == nil {
			if fp, fpErr := teamFingerprint(id, w); fpErr == nil {
				replay, replayErr := replayTeamWrite(ctx, tx, company, actor, operation, key.String(), fp)
				if replayErr != nil && !errors.Is(replayErr, drafts.ErrIdempotencyConflict) {
					return drafts.Result{}, replayErr
				}
				if replay.Replayed {
					return replay, nil
				}
			}
		}
	}
	if !found || !authorized(auth, actor, record) {
		return drafts.Result{}, draftAccessError(ctx, tx, actor, record, found)
	}
	if err := requireV2ReadDocument(record.fields); err != nil {
		return drafts.Result{}, err
	}
	if post {
		if !w.KeyPresent {
			return drafts.Result{}, drafts.ErrIdempotencyKeyRequired
		}
		key, err := uuid.Parse(w.Key)
		if err != nil {
			return drafts.Result{}, drafts.ErrInvalidIdempotencyKey
		}
		w.Key = key.String()
		fingerprint, err = teamFingerprint(id, w)
		if err != nil {
			return drafts.Result{}, err
		}
		replay, err := replayTeamWrite(ctx, tx, company, actor, operation, w.Key, fingerprint)
		if err != nil {
			return drafts.Result{}, err
		}
		if replay.Replayed {
			return replay, nil
		}
	}
	var mode string
	var version int64
	if err := tx.QueryRow(ctx, `SELECT mode,version FROM vacancy_teams WHERE draft_id=$1`, id).Scan(&mode, &version); err != nil {
		return drafts.Result{}, err
	}
	if err := pipelineconfig.CheckIfMatch(vacancyteam.ETag(id, version), w.IfMatch, w.MatchPresent); err != nil {
		if errors.Is(err, drafts.ErrVersionConflict) {
			err = vacancyteam.ErrVersionConflict
		}
		return drafts.Result{}, err
	}
	members, err := teamAssignments(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	var self, target, responsible *activeAssignment
	for i := range members {
		a := &members[i]
		if a.User == actor {
			self = a
		}
		if a.User == w.Target {
			target = a
		}
		if a.Function == "responsible" {
			responsible = a
		}
	}
	fn := ""
	if self != nil {
		fn = self.Function
	}
	can := vacancyteam.Can(mode, fn, auth.role == roleOwner, len(members))
	allowed := false
	switch w.Action {
	case vacancyteam.Add:
		allowed = can.AddMember
	case vacancyteam.Remove:
		allowed = can.RemoveMember
	case vacancyteam.Leave:
		allowed = self != nil
	case vacancyteam.Deadline:
		allowed = can.EditDeadline
	case vacancyteam.Reassign:
		allowed = auth.role == roleOwner
	case vacancyteam.Mode:
		allowed = can.ChangeMode
	}
	if !allowed {
		return drafts.Result{}, vacancyteam.ErrForbidden
	}
	input, err := vacancyteam.DecodeWrite(w.Action, w.Body)
	if err != nil {
		return drafts.Result{}, err
	}
	if version == math.MaxInt64 {
		return drafts.Result{}, drafts.ErrVersionOverflow
	}
	now := s.clock().UTC().Truncate(time.Microsecond)
	meta := map[string]string{"company_id": company.String()}
	event := ""
	isMember := func(user uuid.UUID) error {
		var ok bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM company_members WHERE company_id=$1 AND user_id=$2)`, company, user).Scan(&ok); err != nil {
			return err
		}
		if !ok {
			return vacancyteam.ErrNotCompanyMember
		}
		return nil
	}
	switch w.Action {
	case vacancyteam.Add:
		if err := isMember(input.UserID); err != nil {
			return drafts.Result{}, err
		}
		for _, a := range members {
			if a.User == input.UserID {
				return drafts.Result{}, vacancyteam.ErrAlreadyActive
			}
		}
		fn := "collaborator"
		if mode == "shared" {
			fn = "member"
		}
		assignment := uuid.Must(uuid.NewV7())
		if err := openTeamAssignment(ctx, tx, id, company, input.UserID, actor, assignment, fn, "added", input.Deadline, now); err != nil {
			return drafts.Result{}, err
		}
		event = audit.EventVacancyTeamMemberAdded
		meta["assignment_id"] = assignment.String()
		meta["user_id"] = input.UserID.String()
		meta["function"] = fn
		meta["recruiter_deadline"] = dateValue(input.Deadline)
	case vacancyteam.Remove, vacancyteam.Leave:
		cause := "removed"
		event = audit.EventVacancyTeamMemberRemoved
		if w.Action == vacancyteam.Leave {
			target = self
			cause = "left"
			event = audit.EventVacancyTeamMemberLeft
		}
		if target == nil {
			return drafts.Result{}, vacancyteam.ErrMemberNotFound
		}
		if target.Function == "responsible" {
			if w.Action == vacancyteam.Leave {
				return drafts.Result{}, vacancyteam.ErrResponsibleCannotLeave
			}
			return drafts.Result{}, vacancyteam.ErrUseReassign
		}
		if mode == "shared" && len(members) == 1 {
			return drafts.Result{}, vacancyteam.ErrLastMember
		}
		if err := endTeamAssignment(ctx, tx, *target, actor, cause, nil, now); err != nil {
			return drafts.Result{}, err
		}
		meta["assignment_id"] = target.ID.String()
		meta["user_id"] = target.User.String()
		meta["function"] = target.Function
	case vacancyteam.Deadline:
		if target == nil {
			return drafts.Result{}, vacancyteam.ErrMemberNotFound
		}
		if _, err := tx.Exec(ctx, `UPDATE vacancy_assignments SET recruiter_deadline=$2::date WHERE id=$1`, target.ID, input.Deadline); err != nil {
			return drafts.Result{}, err
		}
		event = audit.EventVacancyAssignmentDeadlineChanged
		meta["assignment_id"] = target.ID.String()
		meta["user_id"] = target.User.String()
		meta["previous"] = dateValue(target.Deadline)
		meta["new"] = dateValue(input.Deadline)
	case vacancyteam.Mode:
		if mode == input.Mode {
			return drafts.Result{}, vacancyteam.ErrModeUnchanged
		}
		var user *uuid.UUID
		if input.Mode == "with_responsible" {
			for _, a := range members {
				if a.User == input.UserID {
					u := a.User
					user = &u
				}
			}
			if user == nil {
				return drafts.Result{}, vacancyteam.ErrResponsibleNotOnTeam
			}
		}
		// Close all before opening: the responsible partial index is immediate.
		for _, a := range members {
			if err := closeTeamFunction(ctx, tx, a.ID, "mode_change", now); err != nil {
				return drafts.Result{}, err
			}
		}
		for _, a := range members {
			fn := "member"
			if input.Mode == "with_responsible" {
				fn = "collaborator"
				if a.User == input.UserID {
					fn = "responsible"
				}
			}
			if err := openTeamFunction(ctx, tx, id, a.ID, fn, "mode_change", now); err != nil {
				return drafts.Result{}, err
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO vacancy_team_mode_changes(id,draft_id,company_id,from_mode,to_mode,responsible_user_id,performed_by,performed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, uuid.Must(uuid.NewV7()), id, company, mode, input.Mode, user, actor, now); err != nil {
			return drafts.Result{}, err
		}
		event = audit.EventVacancyTeamModeChanged
		meta["from_mode"] = mode
		meta["to_mode"] = input.Mode
		meta["responsible_user_id"] = ""
		if user != nil {
			meta["responsible_user_id"] = user.String()
		}
		mode = input.Mode
	case vacancyteam.Reassign:
		if mode != "with_responsible" {
			return drafts.Result{}, vacancyteam.ErrModeMismatch
		}
		if responsible == nil {
			return drafts.Result{}, fmt.Errorf("team invariant: missing responsible")
		}
		if input.UserID == responsible.User {
			return drafts.Result{}, vacancyteam.ErrTargetResponsible
		}
		if err := isMember(input.UserID); err != nil {
			return drafts.Result{}, err
		}
		if input.Deadline != nil {
			for _, a := range members {
				if a.User == input.UserID {
					return drafts.Result{}, vacancyteam.ErrDeadlineNotApplicable
				}
			}
		}
		meta, err = s.reassignResponsible(ctx, tx, id, company, actor, *responsible, members, input, now)
		if err != nil {
			return drafts.Result{}, err
		}
		event = audit.EventVacancyResponsibleReassigned
	}
	if _, err := tx.Exec(ctx, `UPDATE vacancy_teams SET mode=$2,version=version+1,updated_at=$3 WHERE draft_id=$1`, id, mode, now); err != nil {
		return drafts.Result{}, err
	}
	if err := s.audit.Append(ctx, tx, audit.AuditEvent{ID: uuid.Must(uuid.NewV7()), ActorType: audit.ActorTypeUser, ActorID: &actor, EventType: event, EntityType: "vacancy", EntityID: id, CompanyID: &company, VacancyID: &id, Metadata: meta}); err != nil {
		return drafts.Result{}, err
	}
	result, err := renderTeam(ctx, tx, id, actor, auth)
	if err != nil {
		return drafts.Result{}, err
	}
	if post {
		if _, err := tx.Exec(ctx, `INSERT INTO job_draft_idempotency(id,company_id,actor_id,operation,idem_key,fingerprint,fingerprint_algorithm,response_body,response_etag) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, uuid.Must(uuid.NewV7()), company, actor, operation, w.Key, fingerprintDigest(fingerprint), FingerprintAlgorithmSHA256, result.Body, result.ETag); err != nil {
			return drafts.Result{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return drafts.Result{}, err
	}
	return result, nil
}
func dateValue(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
