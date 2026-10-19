package board

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// All callers hold the authoring draft lock, also taken by catalog PUT. Reading
// inside that boundary prevents assigning an id concurrently removed from JSON.
func readSubstates(ctx context.Context, tx pgx.Tx, id uuid.UUID) ([]app.Substate, error) {
	var raw []byte
	err := tx.QueryRow(ctx, `SELECT catalog FROM job_draft_substate_catalogs WHERE draft_id=$1`, id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return []app.Substate{}, nil
	}
	if err != nil {
		return nil, err
	}
	var c struct {
		Substates []app.Substate `json:"substates"`
	}
	if err = json.Unmarshal(raw, &c); err != nil {
		return nil, err
	}
	if c.Substates == nil {
		return nil, errors.New("invalid stored substate catalog")
	}
	return c.Substates, nil
}
func substateName(c []app.Substate, id *string) (*string, error) {
	if id == nil {
		return nil, nil
	}
	for _, s := range c {
		if s.ID == *id {
			name := s.Name
			return &name, nil
		}
	}
	return nil, errors.New("unknown stored participation substate")
}
func sameSubstate(a, b *string) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func (s *Store) SetSubstate(ctx context.Context, company, actor, id, pid uuid.UUID, tag string, present bool, body []byte) (app.Moved, error) {
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
	target, err := app.DecodeSubstate(body, s.decode)
	if err != nil {
		return app.Moved{}, err
	}
	if err = app.RequiresInProcess(p, item.StageID); err != nil {
		return app.Moved{}, err
	}
	c, err := readSubstates(ctx, tx, id)
	if err != nil {
		return app.Moved{}, err
	}
	if target != nil {
		found := false
		for _, sub := range c {
			if sub.ID == *target {
				found = true
				break
			}
		}
		if !found {
			return app.Moved{}, app.ErrValidation
		}
	}
	cov, err := coverage(ctx, tx, id, p)
	if err != nil {
		return app.Moved{}, err
	}
	if sameSubstate(item.SubstateID, target) {
		delivery, err := s.delivery(ctx, tx, id)
		if err != nil {
			return app.Moved{}, err
		}
		return app.Moved{Item: item, Coverage: cov, Delivery: delivery}, nil
	}
	if version == math.MaxInt64 {
		return app.Moved{}, app.ErrVersionOverflow
	}
	at := nextEventAt(item.MovedAt)
	if err = s.substateHistory(ctx, tx, actor, id, item, target, c, at, version+1); err != nil {
		return app.Moved{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE process_participations SET substate_id=$3,version=version+1 WHERE process_id=$1 AND id=$2`, id, pid, target); err != nil {
		return app.Moved{}, err
	}
	item.MovedAt = at
	item.SubstateID = target
	item.Version = strconv.FormatInt(version+1, 10)
	item.ETag = app.ETag(pid, version+1)
	delivery, err := s.delivery(ctx, tx, id)
	if err != nil {
		return app.Moved{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return app.Moved{}, err
	}
	return app.Moved{Item: item, Coverage: cov, Delivery: delivery}, nil
}

func (s *Store) substateHistory(ctx context.Context, tx pgx.Tx, actor, id uuid.UUID, item app.Item, target *string, c []app.Substate, at time.Time, version int64) error {
	fromName, err := substateName(c, item.SubstateID)
	if err != nil {
		return err
	}
	toName, err := substateName(c, target)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at,actor_kind,event_kind,from_substate_id,from_substate_name,to_substate_id,to_substate_name) VALUES($1,$2,$3,$4,$5,'recruiter','substate',$6,$7,$8,$9)`, uuid.New(), item.ID, item.StageID, actor, at, item.SubstateID, fromName, target, toName); err != nil {
		return err
	}
	from, to := "", ""
	if item.SubstateID != nil {
		from = *item.SubstateID
	}
	if target != nil {
		to = *target
	}
	return s.audit.Append(ctx, tx, audit.AuditEvent{ID: uuid.New(), ActorType: audit.ActorTypeUser, ActorID: &actor, EventType: "ParticipationSubstateChanged", EntityType: "process_participation", EntityID: item.ID, Metadata: map[string]string{"vacancy_id": id.String(), "from_substate_id": from, "to_substate_id": to, "version": strconv.FormatInt(version, 10)}})
}

// Reserve two database-precision instants after the previous event even if the
// wall clock stalls or moves backward; the first is available for implicit clear.
func nextEventAt(previous time.Time) time.Time {
	at := time.Now().UTC().Truncate(time.Microsecond)
	minimum := previous.Add(2 * time.Microsecond)
	if at.Before(minimum) {
		return minimum.UTC()
	}
	return at
}

// Clearing shares the caller's single version bump. Give the clear event a
// distinct preceding timestamp: history's existing (created_at,id) order cannot
// otherwise order two UUIDv4 rows written at the same instant deterministically.
func (s *Store) clearSubstate(ctx context.Context, tx pgx.Tx, actor, id uuid.UUID, item *app.Item, at time.Time, version int64) error {
	if item.SubstateID == nil {
		return nil
	}
	c, err := readSubstates(ctx, tx, id)
	if err != nil {
		return err
	}
	if err = s.substateHistory(ctx, tx, actor, id, *item, nil, c, at.Add(-time.Microsecond), version); err != nil {
		return err
	}
	item.SubstateID = nil
	return nil
}
