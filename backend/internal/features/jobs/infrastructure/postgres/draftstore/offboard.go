package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	companies "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancyteam"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const offboardOperation = "company-member-offboard:r1"

// readOffboardPreview reads the projection in one statement snapshot. Drafts
// without a process are non-finished. Closed publication is not finished process.
func readOffboardPreview(ctx context.Context, tx pgx.Tx, company, membership uuid.UUID) (vacancyteam.OffboardPreview, error) {
	out := vacancyteam.OffboardPreview{Vacancies: []vacancyteam.OffboardVacancy{}}
	err := tx.QueryRow(ctx, `SELECT m.user_id,u.full_name FROM company_members m JOIN users u ON u.id=m.user_id WHERE m.id=$1 AND m.company_id=$2`, membership, company).Scan(&out.User.ID, &out.User.FullName)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, companies.ErrMemberNotFound
	}
	if err != nil {
		return out, err
	}
	rows, err := tx.Query(ctx, `SELECT d.id,COALESCE(convert_from(d.fields,'UTF8')::jsonb->'fields'->>'title',''),COALESCE(p.status,'draft'),
 CASE WHEN COALESCE(p.process_status,'active')='finished' THEN ''
 WHEN t.mode='with_responsible' AND f.function='responsible' THEN 'responsible'
 WHEN t.mode='shared' AND (SELECT count(*) FROM vacancy_assignments b WHERE b.draft_id=d.id AND b.ended_at IS NULL)=1 THEN 'last_member' ELSE '' END,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id',b.user_id,'name',u.full_name,'function',bf.function) ORDER BY b.started_at,b.id)
 FROM vacancy_assignments b JOIN users u ON u.id=b.user_id JOIN vacancy_assignment_functions bf ON bf.assignment_id=b.id AND bf.ended_at IS NULL
 WHERE b.draft_id=d.id AND b.ended_at IS NULL AND b.user_id<>$2),'[]'::jsonb)
 FROM vacancy_assignments a JOIN job_drafts d ON d.id=a.draft_id JOIN vacancy_teams t ON t.draft_id=d.id
 JOIN vacancy_assignment_functions f ON f.assignment_id=a.id AND f.ended_at IS NULL
 LEFT JOIN vacancy_processes p ON p.id=d.id WHERE a.company_id=$1 AND a.user_id=$2 AND a.ended_at IS NULL ORDER BY d.id`, company, out.User.ID)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var v vacancyteam.OffboardVacancy
		var team []byte
		if err := rows.Scan(&v.DraftID, &v.Title, &v.Lifecycle, &v.HandOver, &team); err != nil {
			return out, err
		}
		if v.HandOver == "" {
			out.OtherTramos++
			continue
		}
		if err := json.Unmarshal(team, &v.Team); err != nil {
			return out, err
		}
		out.Vacancies = append(out.Vacancies, v)
	}
	return out, rows.Err()
}

func (s *Store) PreviewOffboard(ctx context.Context, company, actor, membership uuid.UUID) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, err
	}
	defer tx.Rollback(ctx)
	auth, err := s.lockGates(ctx, tx, company, actor)
	if err != nil {
		return drafts.Result{}, err
	}
	if auth.role != roleOwner {
		return drafts.Result{}, drafts.ErrForbidden
	}
	preview, err := readOffboardPreview(ctx, tx, company, membership)
	if err != nil {
		return drafts.Result{}, err
	}
	body, err := json.Marshal(preview)
	return drafts.Result{Body: body}, err
}

func (s *Store) RemoveCompanyMember(ctx context.Context, company, actor, membership uuid.UUID) error {
	_, err := s.departCompanyMember(ctx, company, actor, membership, "", false, nil, false)
	return err
}
func (s *Store) OffboardCompanyMember(ctx context.Context, company, actor, membership uuid.UUID, key string, present bool, body []byte) (drafts.Result, error) {
	return s.departCompanyMember(ctx, company, actor, membership, key, present, body, true)
}

type offboardInput struct {
	Default uuid.UUID
	Targets map[uuid.UUID]uuid.UUID
}

func decodeOffboard(body []byte) (offboardInput, error) {
	out := offboardInput{Targets: map[uuid.UUID]uuid.UUID{}}
	value, err := draftjson.Decode(body)
	if err != nil {
		return out, drafts.ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok {
		return out, drafts.ErrInvalidRequest
	}
	parse := func(raw any) (uuid.UUID, error) {
		s, ok := raw.(string)
		if !ok {
			return uuid.Nil, drafts.ErrInvalidRequest
		}
		id, err := uuid.Parse(s)
		if err != nil || id == uuid.Nil {
			return uuid.Nil, drafts.ErrInvalidRequest
		}
		return id, nil
	}
	for key, raw := range root {
		switch key {
		case "default_to_user_id":
			out.Default, err = parse(raw)
			if err != nil {
				return out, err
			}
		case "reassignments":
			items, ok := raw.([]any)
			if !ok {
				return out, drafts.ErrInvalidRequest
			}
			for _, item := range items {
				obj, ok := item.(map[string]any)
				if !ok || len(obj) != 2 {
					return out, drafts.ErrInvalidRequest
				}
				id, err := parse(obj["draft_id"])
				if err != nil {
					return out, err
				}
				target, err := parse(obj["to_user_id"])
				if err != nil {
					return out, err
				}
				if _, duplicate := out.Targets[id]; duplicate {
					return out, drafts.ErrInvalidRequest
				}
				out.Targets[id] = target
			}
		default:
			return out, drafts.ErrInvalidRequest
		}
	}
	return out, nil
}

func (s *Store) departCompanyMember(ctx context.Context, company, actor, membership uuid.UUID, key string, present bool, body []byte, offboard bool) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, err
	}
	defer tx.Rollback(ctx)
	// Match the existing membership mutator's company serialization lock BEFORE
	// lockGates takes FOR SHARE. This avoids concurrent lock-upgrade deadlocks and
	// prevents new team assignments while the affected vacancy set is collected.
	if _, err := db.New(tx).LockCompanyForMemberMutation(ctx, company); err != nil {
		return drafts.Result{}, err
	}
	auth, err := s.lockGates(ctx, tx, company, actor)
	if err != nil {
		return drafts.Result{}, err
	}
	if auth.role != roleOwner {
		return drafts.Result{}, drafts.ErrForbidden
	}
	var fingerprint []byte
	if offboard {
		if !present {
			return drafts.Result{}, drafts.ErrIdempotencyKeyRequired
		}
		parsed, err := uuid.Parse(key)
		if err != nil {
			return drafts.Result{}, drafts.ErrInvalidIdempotencyKey
		}
		key = parsed.String()
		value, err := draftjson.Decode(body)
		if err != nil {
			return drafts.Result{}, drafts.ErrInvalidRequest
		}
		fingerprint, err = draftjson.EncodeValidatedValue(map[string]any{"membership": membership.String(), "body": value})
		if err != nil {
			return drafts.Result{}, err
		}
		replay, err := replayTeamWrite(ctx, tx, company, actor, offboardOperation, key, fingerprint)
		if err != nil || replay.Replayed {
			return replay, err
		}
	}
	if s.memberMutationGuard == nil {
		return drafts.Result{}, errors.New("member mutation guard not configured")
	}
	if err := s.memberMutationGuard(ctx, tx, membership, company, false); err != nil {
		return drafts.Result{}, err
	}
	preview, err := readOffboardPreview(ctx, tx, company, membership)
	if err != nil {
		return drafts.Result{}, err
	}
	// Every affected vacancy is locked, not just those needing a handover. The
	// following projection is re-read after the locks using a fresh snapshot.
	rows, err := tx.Query(ctx, `SELECT d.id FROM job_drafts d WHERE d.company_id=$1 AND EXISTS(SELECT 1 FROM vacancy_assignments a WHERE a.draft_id=d.id AND a.user_id=$2 AND a.ended_at IS NULL) ORDER BY d.id FOR UPDATE OF d`, company, preview.User.ID)
	if err != nil {
		return drafts.Result{}, err
	}
	ids := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return drafts.Result{}, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if rows.Err() != nil {
		return drafts.Result{}, rows.Err()
	}
	preview, err = readOffboardPreview(ctx, tx, company, membership)
	if err != nil {
		return drafts.Result{}, err
	}
	if !offboard && len(preview.Vacancies) > 0 {
		return drafts.Result{}, &vacancyteam.OffboardVacanciesError{Code: "member_is_responsible", Vacancies: preview.Vacancies}
	}
	input := offboardInput{Targets: map[uuid.UUID]uuid.UUID{}}
	handovers := map[uuid.UUID]vacancyteam.OffboardVacancy{}
	for _, v := range preview.Vacancies {
		handovers[v.DraftID] = v
	}
	if offboard {
		input, err = decodeOffboard(body)
		if err != nil {
			return drafts.Result{}, err
		}
		for id := range input.Targets {
			if _, ok := handovers[id]; !ok {
				return drafts.Result{}, vacancyteam.RuleError("offboard_reassignment_not_applicable")
			}
		}
		unresolved := []vacancyteam.OffboardVacancy{}
		for _, v := range preview.Vacancies {
			if input.Targets[v.DraftID] == uuid.Nil {
				input.Targets[v.DraftID] = input.Default
			}
			if input.Targets[v.DraftID] == uuid.Nil {
				unresolved = append(unresolved, v)
			}
		}
		if len(unresolved) > 0 {
			return drafts.Result{}, &vacancyteam.OffboardVacanciesError{Code: "offboard_unresolved_vacancies", Vacancies: unresolved}
		}
		// Validate even an explicitly supplied unused default: every supplied target
		// must be a current member, never the departing person.
		targets := []uuid.UUID{}
		if input.Default != uuid.Nil {
			targets = append(targets, input.Default)
		}
		for _, target := range input.Targets {
			targets = append(targets, target)
		}
		for _, target := range targets {
			var valid bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM company_members WHERE company_id=$1 AND user_id=$2)`, company, target).Scan(&valid); err != nil {
				return drafts.Result{}, err
			}
			if !valid || target == preview.User.ID {
				return drafts.Result{}, vacancyteam.ErrNotCompanyMember
			}
		}
	}
	type handover struct {
		DraftID      uuid.UUID `json:"draft_id"`
		HandOver     string    `json:"hand_over"`
		To           uuid.UUID `json:"to_user_id"`
		Reassignment *string   `json:"reassignment_id"`
	}
	response := struct {
		User       uuid.UUID  `json:"user_id"`
		HandedOver []handover `json:"handed_over"`
		Ended      []string   `json:"ended_assignment_ids"`
	}{User: preview.User.ID, HandedOver: []handover{}, Ended: []string{}}
	reassignmentIDs := []string{}
	now := s.clock().UTC().Truncate(time.Microsecond)
	for _, id := range ids {
		var version int64
		if err := tx.QueryRow(ctx, `SELECT version FROM vacancy_teams WHERE draft_id=$1`, id).Scan(&version); err != nil {
			return drafts.Result{}, err
		}
		if version == math.MaxInt64 {
			return drafts.Result{}, drafts.ErrVersionOverflow
		}
		assignments, err := teamAssignments(ctx, tx, id)
		if err != nil {
			return drafts.Result{}, err
		}
		var leaving activeAssignment
		for _, a := range assignments {
			if a.User == preview.User.ID {
				leaving = a
			}
		}
		v, needsHandover := handovers[id]
		if needsHandover && v.HandOver == "responsible" {
			meta, err := s.reassignResponsible(ctx, tx, id, company, actor, leaving, assignments, vacancyteam.Input{UserID: input.Targets[id], Reason: "recruiter_departure", Previous: "remove"}, now)
			if err != nil {
				return drafts.Result{}, err
			}
			if err := s.appendOffboardVacancyAudit(ctx, tx, company, actor, id, audit.EventVacancyResponsibleReassigned, meta); err != nil {
				return drafts.Result{}, err
			}
			rid := meta["reassignment_id"]
			reassignmentIDs = append(reassignmentIDs, rid)
			response.HandedOver = append(response.HandedOver, handover{id, v.HandOver, input.Targets[id], &rid})
		} else {
			if needsHandover {
				assignment := uuid.Must(uuid.NewV7())
				target := input.Targets[id]
				if err := openTeamAssignment(ctx, tx, id, company, target, actor, assignment, "member", "added", nil, now); err != nil {
					return drafts.Result{}, err
				}
				if err := s.appendOffboardVacancyAudit(ctx, tx, company, actor, id, audit.EventVacancyTeamMemberAdded, map[string]string{"company_id": company.String(), "assignment_id": assignment.String(), "user_id": target.String(), "function": "member", "recruiter_deadline": ""}); err != nil {
					return drafts.Result{}, err
				}
				response.HandedOver = append(response.HandedOver, handover{id, v.HandOver, target, nil})
			}
			if err := endTeamAssignment(ctx, tx, leaving, actor, "membership_ended", nil, now); err != nil {
				return drafts.Result{}, err
			}
			response.Ended = append(response.Ended, leaving.ID.String())
			if err := s.appendOffboardVacancyAudit(ctx, tx, company, actor, id, audit.EventVacancyAssignmentEndedByMembership, map[string]string{"company_id": company.String(), "assignment_id": leaving.ID.String(), "user_id": leaving.User.String()}); err != nil {
				return drafts.Result{}, err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE vacancy_teams SET version=version+1,updated_at=$2 WHERE draft_id=$1`, id, now); err != nil {
			return drafts.Result{}, err
		}
	}
	// The talent base viewer row goes with the membership, so it can be audited.
	viewerRemoved, err := tx.Exec(ctx, `DELETE FROM company_talent_base_viewers WHERE company_id=$1 AND user_id=$2`, company, preview.User.ID)
	if err != nil {
		return drafts.Result{}, err
	}
	if _, err := db.New(tx).RemoveCompanyMember(ctx, db.RemoveCompanyMemberParams{ID: membership, CompanyID: company}); err != nil {
		return drafts.Result{}, err
	}
	result := drafts.Result{}
	if offboard {
		if err := s.audit.Append(ctx, tx, audit.AuditEvent{ID: uuid.Must(uuid.NewV7()), ActorType: audit.ActorTypeUser, ActorID: &actor, EventType: audit.EventCompanyMemberOffboarded, EntityType: "company_member", EntityID: membership, CompanyID: &company, StructuredMetadata: map[string]any{"company_id": company.String(), "user_id": preview.User.ID.String(), "reassignment_ids": reassignmentIDs, "ended_assignment_ids": response.Ended, "talent_base_viewer_removed": viewerRemoved.RowsAffected() > 0}}); err != nil {
			return drafts.Result{}, err
		}
		result.Body, err = json.Marshal(response)
		if err != nil {
			return drafts.Result{}, err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO job_draft_idempotency(id,company_id,actor_id,operation,idem_key,fingerprint,fingerprint_algorithm,response_body,response_etag) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'')`, uuid.Must(uuid.NewV7()), company, actor, offboardOperation, key, fingerprintDigest(fingerprint), FingerprintAlgorithmSHA256, result.Body); err != nil {
			return drafts.Result{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return drafts.Result{}, err
	}
	return result, nil
}
func (s *Store) appendOffboardVacancyAudit(ctx context.Context, tx pgx.Tx, company, actor, id uuid.UUID, event string, metadata map[string]string) error {
	return s.audit.Append(ctx, tx, audit.AuditEvent{ID: uuid.Must(uuid.NewV7()), ActorType: audit.ActorTypeUser, ActorID: &actor, EventType: event, EntityType: "vacancy", EntityID: id, CompanyID: &company, VacancyID: &id, Metadata: metadata})
}
