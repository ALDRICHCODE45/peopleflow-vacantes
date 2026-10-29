package postgres

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/invitations"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/content"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// InvitationJobContext is implemented by jobs and injected at the composition
// root. Transaction order is draft (in the adapter), process, participation,
// invitation. Future auto/candidate writers must use the participation lock too.
type InvitationJobContext interface {
	PsychometricInvitationsContext(context.Context, pgx.Tx, uuid.UUID, uuid.UUID, uuid.UUID, bool) (string, error)
	AuditPsychometricInvitation(context.Context, pgx.Tx, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, string) error
}
type InvitationsStore struct {
	pool *pgxpool.Pool
	jobs InvitationJobContext
}

func NewInvitationsStore(pool *pgxpool.Pool, jobs InvitationJobContext) *InvitationsStore {
	return &InvitationsStore{pool, jobs}
}

var _ invitations.Store = (*InvitationsStore)(nil)

func (s *InvitationsStore) begin(ctx context.Context, company, actor, id uuid.UUID, write bool) (pgx.Tx, string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, "", err
	}
	exit, err := s.jobs.PsychometricInvitationsContext(ctx, tx, company, actor, id, write)
	if err == nil {
		var process uuid.UUID
		err = tx.QueryRow(ctx, `SELECT id FROM vacancy_processes WHERE id=$1 AND company_id=$2 FOR UPDATE`, id, company).Scan(&process)
		// An unpublished vacancy has an empty list; writes cannot target a participation.
		if errors.Is(err, pgx.ErrNoRows) {
			if write {
				err = invitations.ErrNotFound
			} else {
				err = nil
			}
		}
	}
	if err != nil {
		_ = tx.Rollback(ctx)
		return nil, "", err
	}
	return tx, exit, nil
}

const invitationProjection = `SELECT i.id,i.participation_id,i.test,i.content_version,i.scoring_version,i.origin,i.created_by,u.full_name,i.trigger_stage_id,i.created_at,i.expires_at,i.consented_at,i.answered_count,i.total_count,i.finished_at,i.last_reminded_at,i.reminder_count,i.revoked_at
 FROM psychometric_invitations i LEFT JOIN users u ON u.id=i.created_by `

func scanInvitation(row pgx.Row, now time.Time) (invitations.Invitation, error) {
	var i invitations.Invitation
	var actor *uuid.UUID
	var name *string
	var revoked *time.Time
	err := row.Scan(&i.ID, &i.ParticipationID, &i.Test, &i.ContentVersion, &i.ScoringVersion, &i.Origin, &actor, &name, &i.TriggerStageID, &i.CreatedAt, &i.ExpiresAt, &i.ConsentedAt, &i.AnsweredCount, &i.TotalCount, &i.FinishedAt, &i.LastRemindedAt, &i.ReminderCount, &revoked)
	if errors.Is(err, pgx.ErrNoRows) {
		return i, invitations.ErrNotFound
	}
	if err != nil {
		return i, err
	}
	i.CreatedAt = i.CreatedAt.UTC()
	i.ExpiresAt = i.ExpiresAt.UTC()
	for _, at := range []*time.Time{i.ConsentedAt, i.FinishedAt, i.LastRemindedAt} {
		if at != nil {
			*at = at.UTC()
		}
	}
	if actor != nil {
		if name == nil {
			return i, errors.New("invitation actor missing")
		}
		i.CreatedBy = &invitations.Actor{ID: *actor, FullName: *name}
	}
	i.Status = invitations.StatusAt(now, i.ExpiresAt, i.ConsentedAt, i.FinishedAt, revoked)
	return i, nil
}

// Read the wall clock after locks, not PostgreSQL now() (transaction start can
// precede a long lock wait). Microseconds match PostgreSQL's storage precision.
func invitationNow(ctx context.Context, tx pgx.Tx) (time.Time, error) {
	var now time.Time
	err := tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now)
	return now.UTC(), err
}
func invitationResult(value any, status int) (invitations.Result, error) {
	b, err := json.Marshal(value)
	return invitations.Result{Body: b, Status: status}, err
}
func (s *InvitationsStore) ListInvitations(ctx context.Context, company, actor, id uuid.UUID) (invitations.Result, error) {
	tx, _, err := s.begin(ctx, company, actor, id, false)
	if err != nil {
		return invitations.Result{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	now, err := invitationNow(ctx, tx)
	if err != nil {
		return invitations.Result{}, err
	}
	rows, err := tx.Query(ctx, invitationProjection+`JOIN process_participations p ON p.id=i.participation_id WHERE p.process_id=$1 AND i.id=(SELECT newest.id FROM psychometric_invitations newest WHERE newest.participation_id=i.participation_id ORDER BY newest.created_at DESC,newest.id DESC LIMIT 1) ORDER BY i.participation_id`, id)
	if err != nil {
		return invitations.Result{}, err
	}
	defer rows.Close()
	items := []invitations.Invitation{}
	for rows.Next() {
		i, err := scanInvitation(rows, now)
		if err != nil {
			return invitations.Result{}, err
		}
		items = append(items, i)
	}
	if err := rows.Err(); err != nil {
		return invitations.Result{}, err
	}
	return invitationResult(struct {
		Items []invitations.Invitation `json:"items"`
	}{items}, 200)
}
func lockParticipation(ctx context.Context, tx pgx.Tx, id, pid uuid.UUID) (string, *time.Time, error) {
	var stage string
	var discarded *time.Time
	err := tx.QueryRow(ctx, `SELECT stage_id,discarded_at FROM process_participations WHERE process_id=$1 AND id=$2 FOR UPDATE`, id, pid).Scan(&stage, &discarded)
	if errors.Is(err, pgx.ErrNoRows) {
		err = invitations.ErrNotFound
	}
	return stage, discarded, err
}
func (s *InvitationsStore) CreateInvitation(ctx context.Context, company, actor, id, pid uuid.UUID) (invitations.Result, error) {
	tx, exit, err := s.begin(ctx, company, actor, id, true)
	if err != nil {
		return invitations.Result{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	stage, discarded, err := lockParticipation(ctx, tx, id, pid)
	if err != nil {
		return invitations.Result{}, err
	}
	if stage == exit || discarded != nil {
		return invitations.Result{}, invitations.ErrParticipationInactive
	}
	p, _, err := read(ctx, tx, id)
	if err != nil {
		return invitations.Result{}, err
	}
	if !p.Enabled {
		return invitations.Result{}, invitations.ErrProfileDisabled
	}
	now, err := invitationNow(ctx, tx)
	if err != nil {
		return invitations.Result{}, err
	}
	var finished bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM psychometric_invitations WHERE participation_id=$1 AND test=$2 AND finished_at IS NOT NULL AND revoked_at IS NULL)`, pid, p.Test).Scan(&finished); err != nil {
		return invitations.Result{}, err
	}
	if finished {
		return invitations.Result{}, invitations.ErrAlreadyFinished
	}
	current, err := scanInvitation(tx.QueryRow(ctx, invitationProjection+`WHERE i.participation_id=$1 AND i.test=$2 AND i.finished_at IS NULL AND i.revoked_at IS NULL AND i.superseded_at IS NULL FOR UPDATE OF i`, pid, p.Test), now)
	if err == nil && current.Active() {
		return invitationResult(current, 200)
	}
	if err != nil && !errors.Is(err, invitations.ErrNotFound) {
		return invitations.Result{}, err
	}
	// Release expired slots without changing their visible status or retention.
	if _, err = tx.Exec(ctx, `UPDATE psychometric_invitations SET superseded_at=$3 WHERE participation_id=$1 AND test=$2 AND finished_at IS NULL AND revoked_at IS NULL AND superseded_at IS NULL AND expires_at <= $3`, pid, p.Test, now); err != nil {
		return invitations.Result{}, err
	}
	artifact, err := content.Load(content.Version)
	if err != nil {
		return invitations.Result{}, err
	}
	catalog := artifact.Snapshot()
	iid := uuid.New()
	expires := now.AddDate(0, 0, p.ExpiresInDays)
	if _, err = tx.Exec(ctx, `INSERT INTO psychometric_invitations(id,participation_id,test,content_version,scoring_version,total_count,origin,created_by,created_at,expires_at,purge_after) VALUES($1,$2,$3,$4,$5,$6,'manual',$7,$8,$9,(($9::timestamptz AT TIME ZONE 'UTC')+interval '12 months') AT TIME ZONE 'UTC')`, iid, pid, catalog.Test, catalog.ContentVersion, catalog.ScoringVersion, len(catalog.Order), actor, now, expires); err != nil {
		return invitations.Result{}, err
	}
	i, err := scanInvitation(tx.QueryRow(ctx, invitationProjection+`WHERE i.id=$1`, iid), now)
	if err != nil {
		return invitations.Result{}, err
	}
	return s.commitInvitation(ctx, tx, actor, id, i, "PsychometricInvitationCreated", 201)
}
func (s *InvitationsStore) RemindInvitation(ctx context.Context, company, actor, id, iid uuid.UUID) (invitations.Result, error) {
	return s.mutateInvitation(ctx, company, actor, id, iid, "remind")
}
func (s *InvitationsStore) RevokeInvitation(ctx context.Context, company, actor, id, iid uuid.UUID) (invitations.Result, error) {
	return s.mutateInvitation(ctx, company, actor, id, iid, "revoke")
}
func (s *InvitationsStore) MintLink(ctx context.Context, company, actor, id, iid uuid.UUID) (invitations.Result, error) {
	return s.mutateInvitation(ctx, company, actor, id, iid, "link")
}
func (s *InvitationsStore) mutateInvitation(ctx context.Context, company, actor, id, iid uuid.UUID, action string) (invitations.Result, error) {
	tx, _, err := s.begin(ctx, company, actor, id, true)
	if err != nil {
		return invitations.Result{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// Find the parent, then acquire locks in the same order as create/board.
	var pid uuid.UUID
	err = tx.QueryRow(ctx, `SELECT i.participation_id FROM psychometric_invitations i JOIN process_participations p ON p.id=i.participation_id WHERE i.id=$1 AND p.process_id=$2`, iid, id).Scan(&pid)
	if errors.Is(err, pgx.ErrNoRows) {
		err = invitations.ErrNotFound
	}
	if err != nil {
		return invitations.Result{}, err
	}
	if _, _, err = lockParticipation(ctx, tx, id, pid); err != nil {
		return invitations.Result{}, err
	}
	// Lock before sampling time so expiry during a lock wait cannot sneak through.
	var locked uuid.UUID
	if err = tx.QueryRow(ctx, `SELECT id FROM psychometric_invitations WHERE id=$1 FOR UPDATE`, iid).Scan(&locked); err != nil {
		return invitations.Result{}, err
	}
	now, err := invitationNow(ctx, tx)
	if err != nil {
		return invitations.Result{}, err
	}
	i, err := scanInvitation(tx.QueryRow(ctx, invitationProjection+`WHERE i.id=$1`, iid), now)
	if err != nil {
		return invitations.Result{}, err
	}
	if action == "link" {
		if !i.Active() {
			return invitations.Result{}, invitations.ErrInvitationClosed
		}
		var entropy [32]byte
		if _, err = rand.Read(entropy[:]); err != nil {
			return invitations.Result{}, errors.New("psychometric link generation failed")
		}
		token := base64.RawURLEncoding.EncodeToString(entropy[:])
		// Hash the encoded wire bytes, never the decoded random bytes.
		hash := sha256.Sum256([]byte(token))
		if _, err = tx.Exec(ctx, `UPDATE psychometric_invitations SET token_hash=$2 WHERE id=$1`, iid, hash[:]); err != nil {
			return invitations.Result{}, err
		}
		return s.commitInvitationValue(ctx, tx, actor, id, i, "PsychometricLinkIssued", 200, invitations.Link{Token: token, ExpiresAt: i.ExpiresAt})
	}
	event := "PsychometricReminderRecorded"
	if action == "revoke" {
		if i.Status == "revoked" {
			return invitationResult(i, 200)
		}
		if _, err = tx.Exec(ctx, `UPDATE psychometric_invitations SET revoked_at=$2,purge_after=CASE WHEN finished_at IS NULL THEN (($2::timestamptz AT TIME ZONE 'UTC')+interval '12 months') AT TIME ZONE 'UTC' ELSE purge_after END WHERE id=$1`, iid, now); err != nil {
			return invitations.Result{}, err
		}
		i.Status = "revoked"
		event = "PsychometricInvitationRevoked"
	} else {
		if !i.Active() {
			return invitations.Result{}, invitations.ErrInvitationClosed
		}
		if _, err = tx.Exec(ctx, `UPDATE psychometric_invitations SET last_reminded_at=$2,reminder_count=reminder_count+1 WHERE id=$1`, iid, now); err != nil {
			return invitations.Result{}, err
		}
		i.LastRemindedAt = &now
		i.ReminderCount++
	}
	return s.commitInvitation(ctx, tx, actor, id, i, event, 200)
}
func (s *InvitationsStore) commitInvitation(ctx context.Context, tx pgx.Tx, actor, id uuid.UUID, i invitations.Invitation, event string, status int) (invitations.Result, error) {
	return s.commitInvitationValue(ctx, tx, actor, id, i, event, status, i)
}
func (s *InvitationsStore) commitInvitationValue(ctx context.Context, tx pgx.Tx, actor, id uuid.UUID, i invitations.Invitation, event string, status int, value any) (invitations.Result, error) {
	if err := s.jobs.AuditPsychometricInvitation(ctx, tx, actor, id, i.ParticipationID, i.ID, event); err != nil {
		return invitations.Result{}, err
	}
	result, err := invitationResult(value, status)
	if err != nil {
		return invitations.Result{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return invitations.Result{}, err
	}
	return result, nil
}
