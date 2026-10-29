package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/profile"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// JobContext is supplied by the composition root, keeping sibling feature
// internals out of psychometrics. Its guard holds the shared parent draft lock.
type JobContext interface {
	PsychometricProfileContext(context.Context, pgx.Tx, uuid.UUID, uuid.UUID, uuid.UUID, bool) ([]string, error)
	PsychometricProfileCheckIfMatch(string, string, bool) error
	AuditPsychometricProfile(context.Context, pgx.Tx, uuid.UUID, uuid.UUID, int64, []byte, []byte) error
}
type Store struct {
	pool *pgxpool.Pool
	jobs JobContext
}

func NewStore(pool *pgxpool.Pool, jobs JobContext) *Store { return &Store{pool: pool, jobs: jobs} }

var _ profile.Store = (*Store)(nil)

func (s *Store) GetProfile(ctx context.Context, company, actor, id uuid.UUID) (profile.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return profile.Result{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	stages, err := s.jobs.PsychometricProfileContext(ctx, tx, company, actor, id, false)
	if err != nil {
		return profile.Result{}, err
	}
	p, v, err := read(ctx, tx, id)
	if err != nil {
		return profile.Result{}, err
	}
	return render(id, p.Visible(stages), v)
}
func (s *Store) PutProfile(ctx context.Context, company, actor, id uuid.UUID, tag string, present bool, body []byte) (profile.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return profile.Result{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	stages, err := s.jobs.PsychometricProfileContext(ctx, tx, company, actor, id, true)
	if err != nil {
		return profile.Result{}, err
	}
	previous, v, err := read(ctx, tx, id)
	if err != nil {
		return profile.Result{}, err
	}
	if err = s.jobs.PsychometricProfileCheckIfMatch(profile.ETag(id, v), tag, present); err != nil {
		return profile.Result{}, err
	}
	next, err := profile.Replace(body, stages)
	if err != nil {
		return profile.Result{}, err
	}
	if next.Confirmed {
		if previous.Confirmed && previous.RequirementsEqual(next) {
			next.ConfirmedAt = previous.ConfirmedAt
		} else {
			at := time.Now().UTC().Format(time.RFC3339Nano)
			next.ConfirmedAt = &at
		}
	}
	if previous.Equal(next) {
		return render(id, previous.Visible(stages), v)
	}
	if v == math.MaxInt64 {
		return profile.Result{}, errors.New("profile version overflow")
	}
	encoded, err := json.Marshal(next)
	if err != nil {
		return profile.Result{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO job_draft_psychometric_profiles(draft_id,version,profile) VALUES($1,$2,$3)
 ON CONFLICT(draft_id) DO UPDATE SET version=EXCLUDED.version,profile=EXCLUDED.profile`, id, v+1, encoded); err != nil {
		return profile.Result{}, fmt.Errorf("write psychometric profile: %w", err)
	}
	old, err := json.Marshal(previous)
	if err != nil {
		return profile.Result{}, err
	}
	if err = s.jobs.AuditPsychometricProfile(ctx, tx, actor, id, v+1, old, encoded); err != nil {
		return profile.Result{}, fmt.Errorf("co-write profile audit: %w", err)
	}
	result, err := render(id, next, v+1)
	if err != nil {
		return profile.Result{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return profile.Result{}, err
	}
	return result, nil
}
func read(ctx context.Context, tx pgx.Tx, id uuid.UUID) (profile.Profile, int64, error) {
	var raw []byte
	var version int64
	err := tx.QueryRow(ctx, `SELECT profile,version FROM job_draft_psychometric_profiles WHERE draft_id=$1`, id).Scan(&raw, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return profile.Empty(), 0, nil
	}
	if err != nil {
		return profile.Profile{}, 0, err
	}
	var p profile.Profile
	err = json.Unmarshal(raw, &p)
	return p, version, err
}
func render(id uuid.UUID, p profile.Profile, v int64) (profile.Result, error) {
	b, e := json.Marshal(struct {
		Version string `json:"version"`
		profile.Profile
	}{strconv.FormatInt(v, 10), p})
	return profile.Result{Body: b, ETag: profile.ETag(id, v)}, e
}
