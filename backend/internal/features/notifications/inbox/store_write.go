package inbox

import (
	"context"
	"fmt"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// MarkResult is the read / unread / read-all response (§Endpoints): affected
// rows and distinct groups, the statement timestamp of the operation and the
// caller's counters after it.
type MarkResult struct {
	AffectedNotifications int       `json:"affected_notifications"`
	AffectedGroups        int       `json:"affected_groups"`
	MarkedAt              time.Time `json:"marked_at"`
	UnreadCount           int       `json:"unread_count"`
	UnreadNotifications   int       `json:"unread_notifications"`
}

// Facets is the GET B/facets response (D17).
type Facets struct {
	State     string      `json:"state"`
	Types     []TypeCount `json:"types"`
	Jobs      []JobCount  `json:"jobs"`
	JobsTotal int         `json:"jobs_total"`
}

// TypeCount is the number of groups of one type.
type TypeCount struct {
	Type  domain.Type `json:"type"`
	Count int         `json:"count"`
}

// JobCount is the number of groups of one job with its current title.
type JobCount struct {
	JobID string  `json:"job_id"`
	Title *string `json:"title"`
	Count int     `json:"count"`
}

// markRow is the common result of the three mark statements.
type markRow struct {
	at              pgtype.Timestamptz
	affected, group int32
}

// mark runs one mark statement and the counters in one transaction, so the
// returned counters include the caller's own change. Reads and marks are not
// audited (D23).
func (s *Store) mark(ctx context.Context, scope Scope, run func(*db.Queries) (markRow, error)) (MarkResult, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return MarkResult{}, fmt.Errorf("begin notifications mark: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qs := db.New(tx)
	row, err := run(qs)
	if err != nil {
		return MarkResult{}, fmt.Errorf("mark notifications: %w", err)
	}
	counts, err := qs.CountUnreadNotifications(ctx, countParams(scope))
	if err != nil {
		return MarkResult{}, fmt.Errorf("count unread notifications: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return MarkResult{}, fmt.Errorf("commit notifications mark: %w", err)
	}
	return MarkResult{AffectedNotifications: int(row.affected), AffectedGroups: int(row.group), MarkedAt: row.at.Time.UTC(),
		UnreadCount: int(counts.UnreadGroups), UnreadNotifications: int(counts.UnreadNotifications)}, nil
}

func orEmpty[T any](v []T) []T {
	if v == nil {
		return []T{}
	}
	return v
}

// Read marks the selected unread rows of the caller read (D15, D26).
func (s *Store) Read(ctx context.Context, scope Scope, req MarkRequest) (MarkResult, error) {
	return s.mark(ctx, scope, func(qs *db.Queries) (markRow, error) {
		r, err := qs.MarkNotificationsRead(ctx, db.MarkNotificationsReadParams{
			UserID: scope.UserID, RecipientKind: scope.kind(), CompanyID: scope.company(), GroupKeys: orEmpty(req.GroupKeys), Ids: orEmpty(req.IDs)})
		return markRow{r.MarkedAt, r.AffectedNotifications, r.AffectedGroups}, err
	})
}

// Unread marks the selected read rows of the caller unread; MarkedAt reverts
// exactly the rows an earlier mark stamped (D15, D26).
func (s *Store) Unread(ctx context.Context, scope Scope, req MarkRequest) (MarkResult, error) {
	var markedAt pgtype.Timestamptz
	if req.MarkedAt != nil {
		markedAt = pgtype.Timestamptz{Time: *req.MarkedAt, Valid: true}
	}
	return s.mark(ctx, scope, func(qs *db.Queries) (markRow, error) {
		r, err := qs.MarkNotificationsUnread(ctx, db.MarkNotificationsUnreadParams{
			UserID: scope.UserID, RecipientKind: scope.kind(), CompanyID: scope.company(), GroupKeys: orEmpty(req.GroupKeys), Ids: orEmpty(req.IDs), MarkedAt: markedAt})
		return markRow{r.MarkedAt, r.AffectedNotifications, r.AffectedGroups}, err
	})
}

// ReadAll marks every unread row of the caller matching the filters and
// created at or before Before (default: the statement timestamp), attention
// included (D16).
func (s *Store) ReadAll(ctx context.Context, scope Scope, req ReadAllRequest) (MarkResult, error) {
	var before pgtype.Timestamptz
	if req.Before != nil {
		before = pgtype.Timestamptz{Time: *req.Before, Valid: true}
	}
	return s.mark(ctx, scope, func(qs *db.Queries) (markRow, error) {
		r, err := qs.MarkAllNotificationsRead(ctx, db.MarkAllNotificationsReadParams{
			UserID: scope.UserID, RecipientKind: scope.kind(), CompanyID: scope.company(), Types: orEmpty(req.Types), JobIds: orEmpty(req.JobIDs), Before: before})
		return markRow{r.MarkedAt, r.AffectedNotifications, r.AffectedGroups}, err
	})
}

// Facets counts the caller's groups (attention included) per type and per job
// in the given state, from one read-only snapshot (D17).
func (s *Store) Facets(ctx context.Context, scope Scope, state string) (Facets, error) {
	tx, err := s.pool.BeginTx(ctx, readOnly)
	if err != nil {
		return Facets{}, fmt.Errorf("begin notifications facets: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qs := db.New(tx)
	unreadOnly := state == StateUnread
	typeRows, err := qs.ListNotificationFacetTypes(ctx, db.ListNotificationFacetTypesParams{UserID: scope.UserID, RecipientKind: scope.kind(), CompanyID: scope.company(), UnreadOnly: unreadOnly})
	if err != nil {
		return Facets{}, fmt.Errorf("list notification facet types: %w", err)
	}
	jobRows, err := qs.ListNotificationFacetJobs(ctx, db.ListNotificationFacetJobsParams{UserID: scope.UserID, RecipientKind: scope.kind(), CompanyID: scope.company(), UnreadOnly: unreadOnly, JobsLimit: FacetJobsLimit})
	if err != nil {
		return Facets{}, fmt.Errorf("list notification facet jobs: %w", err)
	}
	out := Facets{State: state, Types: make([]TypeCount, 0, len(typeRows)), Jobs: make([]JobCount, 0, len(jobRows))}
	for _, r := range typeRows {
		out.Types = append(out.Types, TypeCount{Type: domain.Type(r.Type), Count: int(r.Count)})
	}
	for _, r := range jobRows {
		job := JobCount{JobID: r.JobID.String(), Count: int(r.Count)}
		if r.HasTitle {
			title := r.Title
			job.Title = &title
		}
		out.Jobs = append(out.Jobs, job)
		out.JobsTotal = int(r.Total)
	}
	return out, nil
}
