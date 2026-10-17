package board

import (
	"context"
	"errors"
	"math"
	"strconv"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
)

func (s *Store) Discard(ctx context.Context, company, actor, id, pid uuid.UUID, tag string, present bool, body []byte) (app.Moved, error) {
	return s.discardOrRecover(ctx, company, actor, id, pid, tag, present, body, false)
}
func (s *Store) Recover(ctx context.Context, company, actor, id, pid uuid.UUID, tag string, present bool, body []byte) (app.Moved, error) {
	return s.discardOrRecover(ctx, company, actor, id, pid, tag, present, body, true)
}

func (s *Store) discardOrRecover(ctx context.Context, company, actor, id, pid uuid.UUID, tag string, present bool, body []byte, recovering bool) (app.Moved, error) {
	// Same live authorization and fixed draft -> process -> participation lock order
	// as moves. Preconditions are checked against the locked item, before state guards.
	tx, p, err := s.begin(ctx, company, actor, id)
	if err != nil {
		return app.Moved{}, err
	}
	defer tx.Rollback(ctx)
	item, version, err := readItem(tx.QueryRow(ctx, itemSQL+`WHERE p.process_id=$1 AND p.id=$2 FOR UPDATE OF p`, id, pid))
	if err != nil {
		return app.Moved{}, err
	}
	if err = app.CheckIfMatch(item.ETag, tag, present); err != nil {
		return app.Moved{}, err
	}
	var req app.DiscardRequest
	var reentry bool
	kind, eventType, target := "discard", "ParticipationDiscarded", p.Exit.ID
	if recovering {
		request, err := app.DecodeRecover(body, s.decode)
		if err != nil {
			return app.Moved{}, err
		}
		if item.StageID != p.Exit.ID {
			return app.Moved{}, app.ErrNotDiscarded
		}
		if item.Discard == nil {
			return app.Moved{}, errors.New("missing stored discard")
		}
		reentry = request.ConfirmPlacementReentry
		kind, eventType, target = "recovery", "ParticipationRecovered", item.Discard.PreviousStageID
	} else {
		req, err = app.DecodeDiscard(body, s.decode)
		if err != nil {
			return app.Moved{}, err
		}
		if item.StageID == p.Exit.ID {
			return app.Moved{}, app.ErrAlreadyDiscarded
		}
	}
	progression := item.StageID
	if recovering {
		progression = target
	}
	stageKind := ""
	for _, stage := range p.Stages {
		if stage.ID == progression {
			stageKind = stage.Kind
			break
		}
	}
	// Cut-4 structure lock guarantees the stored previous stage still exists.
	if stageKind == "" {
		return app.Moved{}, errors.New("unknown stored progression stage")
	}
	hire, departure := false, false
	if stageKind == "placement" {
		if recovering {
			if !reentry {
				return app.Moved{}, app.ErrPlacementReentry
			}
			hire = true
		} else {
			if !req.ConfirmPlacementExit {
				return app.Moved{}, app.ErrPlacementExit
			}
			departure = true
		}
	}
	if version == math.MaxInt64 {
		return app.Moved{}, app.ErrVersionOverflow
	}
	previous, err := coverage(ctx, tx, id, p)
	if err != nil {
		return app.Moved{}, err
	}
	at := time.Now().UTC().Truncate(time.Microsecond)
	var group, code *string
	if recovering {
		_, err = tx.Exec(ctx, `UPDATE process_participations SET stage_id=$3,version=version+1,previous_stage_id=NULL,reason_group=NULL,reason_code=NULL,comment=NULL,candidate_message=NULL,discarded_at=NULL WHERE process_id=$1 AND id=$2`, id, pid, target)
	} else {
		group, code = &req.Reason.Group, &req.Reason.Key
		_, err = tx.Exec(ctx, `UPDATE process_participations SET stage_id=$3,version=version+1,previous_stage_id=$4,reason_group=$5,reason_code=$6,comment=$7,candidate_message=$8,discarded_at=$9 WHERE process_id=$1 AND id=$2`, id, pid, target, item.StageID, group, code, req.Comment, req.CandidateMessage, at)
	}
	if err != nil {
		return app.Moved{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at,from_stage_id,hire,departure,actor_kind,event_kind,reason_group,reason_code,comment,candidate_message) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'recruiter',$9,$10,$11,$12,$13)`, uuid.New(), pid, target, actor, at, item.StageID, hire, departure, kind, group, code, req.Comment, req.CandidateMessage); err != nil {
		return app.Moved{}, err
	}
	next, err := coverage(ctx, tx, id, p)
	if err != nil {
		return app.Moved{}, err
	}
	if app.RecordCoverageMilestone(hire, previous.Covered, next.Covered, p.Required, previous.FullCoverageReachedAt != nil) {
		if _, err = tx.Exec(ctx, `INSERT INTO process_coverage_milestones(id,process_id,reached_at,covered,required) VALUES($1,$2,$3,$4,$5)`, uuid.New(), id, at, next.Covered, *p.Required); err != nil {
			return app.Moved{}, err
		}
		if next.FullCoverageReachedAt == nil {
			next.FullCoverageReachedAt = &at
		}
	}
	// Private free text stays in the participation/history, never audit metadata.
	event := audit.AuditEvent{ID: uuid.New(), ActorType: audit.ActorTypeUser, ActorID: &actor, EventType: eventType, EntityType: "process_participation", EntityID: pid, Metadata: map[string]string{"vacancy_id": id.String(), "from_stage_id": item.StageID, "to_stage_id": target, "version": strconv.FormatInt(version+1, 10), "hire": strconv.FormatBool(hire), "departure": strconv.FormatBool(departure)}}
	if err = s.audit.Append(ctx, tx, event); err != nil {
		return app.Moved{}, err
	}
	if recovering {
		item.Discard = nil
	} else {
		item.Discard = &app.Discard{Reason: req.Reason, PreviousStageID: item.StageID, DiscardedAt: at}
	}
	item.StageID, item.Version, item.ETag, item.MovedAt = target, strconv.FormatInt(version+1, 10), app.ETag(pid, version+1), at
	if err = tx.Commit(ctx); err != nil {
		return app.Moved{}, err
	}
	return app.Moved{Item: item, Coverage: next}, nil
}
