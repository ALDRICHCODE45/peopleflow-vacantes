package postgres

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/assessment"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/invitations"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/content"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AssessmentStore struct{ invitations *InvitationsStore }

func NewAssessmentStore(pool *pgxpool.Pool, jobs InvitationJobContext) *AssessmentStore {
	return &AssessmentStore{NewInvitationsStore(pool, jobs)}
}

var _ assessment.Store = (*AssessmentStore)(nil)

type candidateInvitation struct {
	i                      invitations.Invitation
	process, participation uuid.UUID
	company, title         string
	revoked                *time.Time
	tokenHash              []byte
}

func assessmentResult(v any, status int) (assessment.Result, error) {
	b, e := json.Marshal(v)
	return assessment.Result{Status: status, Body: b}, e
}
func candidateNotFound(a assessment.Access) error {
	if a.Public {
		return assessment.ErrUnavailable
	}
	return assessment.ErrNotFound
}

// Candidate writes acquire the same parent-first locks as recruiter creation,
// rotation, revocation and board entry. No recruiter lifecycle gate applies.
func (s *AssessmentStore) load(ctx context.Context, tx pgx.Tx, a assessment.Access, write bool) (candidateInvitation, error) {
	var v candidateInvitation
	id := a.ID
	err := tx.QueryRow(ctx, `SELECT p.process_id,p.id FROM psychometric_invitations i JOIN process_participations p ON p.id=i.participation_id WHERE i.id=$1 AND ($2::boolean OR p.candidate_id=(SELECT id FROM users WHERE cognito_sub=$3 AND user_type='candidate' AND deleted_at IS NULL))`, id, a.Public, a.Subject).Scan(&v.process, &v.participation)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, candidateNotFound(a)
	}
	if err != nil {
		return v, err
	}
	if write {
		for _, q := range []string{`SELECT id FROM job_drafts WHERE id=$1 FOR UPDATE`, `SELECT id FROM vacancy_processes WHERE id=$1 FOR UPDATE`} {
			var locked uuid.UUID
			if err = tx.QueryRow(ctx, q, v.process).Scan(&locked); err != nil {
				return v, err
			}
		}
		if _, _, err = lockParticipation(ctx, tx, v.process, v.participation); err != nil {
			return v, err
		}
		var locked uuid.UUID
		if err = tx.QueryRow(ctx, `SELECT id FROM psychometric_invitations WHERE id=$1 FOR UPDATE`, id).Scan(&locked); err != nil {
			return v, err
		}
	}
	now, err := invitationNow(ctx, tx)
	if err != nil {
		return v, err
	}
	v.i, err = scanInvitation(tx.QueryRow(ctx, invitationProjection+`WHERE i.id=$1`, id), now)
	if err != nil {
		return v, err
	}
	// Revalidate ownership and the token digest after waiting for all locks. A
	// concurrent rotation/revoke/expiry must invalidate the original resolution.
	err = tx.QueryRow(ctx, `SELECT c.name,v.title,i.revoked_at,i.token_hash FROM psychometric_invitations i JOIN process_participations p ON p.id=i.participation_id JOIN vacancy_public_projections v ON v.id=p.process_id JOIN companies c ON c.id=v.company_id WHERE i.id=$1 AND ($2::boolean OR p.candidate_id=(SELECT id FROM users WHERE cognito_sub=$3 AND user_type='candidate' AND deleted_at IS NULL))`, id, a.Public, a.Subject).Scan(&v.company, &v.title, &v.revoked, &v.tokenHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, candidateNotFound(a)
	}
	if err != nil {
		return v, err
	}
	if a.Public {
		hash := sha256.Sum256([]byte(a.Token))
		if !bytes.Equal(hash[:], v.tokenHash) || v.revoked != nil || !now.Before(v.i.ExpiresAt) {
			return v, assessment.ErrUnavailable
		}
	}
	if write {
		if v.i.FinishedAt != nil {
			return v, assessment.ErrFinished
		}
		if !v.i.Active() {
			return v, assessment.ErrClosed
		}
	}
	return v, nil
}
func (s *AssessmentStore) Execute(ctx context.Context, a assessment.Access, action string, position int, c assessment.Command) (assessment.Result, error) {
	// Resolve before borrowing a transaction connection: a pool lookup while
	// holding a connection can deadlock when concurrent requests exhaust the pool.
	if a.Public {
		id, err := s.invitations.LookupToken(ctx, a.Token)
		if errors.Is(err, invitations.ErrUnavailable) {
			return assessment.Result{}, assessment.ErrUnavailable
		}
		if err != nil {
			return assessment.Result{}, err
		}
		a.ID = id
	}
	tx, err := s.invitations.pool.Begin(ctx)
	if err != nil {
		return assessment.Result{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	write := action != "get" && action != "items"
	v, err := s.load(ctx, tx, a, write)
	if err != nil {
		return assessment.Result{}, err
	}
	artifact, err := content.Load(v.i.ContentVersion)
	if err != nil {
		return assessment.Result{}, err
	}
	d := artifact.Snapshot()
	if v.i.ScoringVersion != d.ScoringVersion || v.i.TotalCount != len(d.Order) {
		return assessment.Result{}, errors.New("unsupported assessment pin")
	}
	if action == "get" {
		var notice any
		if v.i.ConsentedAt == nil {
			notice = struct {
				Version string `json:"notice_version"`
				Text    string `json:"text"`
				Hash    string `json:"text_sha256"`
			}{d.Notice.Version, d.Notice.Text, d.Notice.SHA256}
		}
		return assessmentResult(struct {
			Company  string    `json:"company_name"`
			Title    string    `json:"vacancy_title"`
			Minutes  int       `json:"estimated_minutes"`
			Status   string    `json:"status"`
			Answered int       `json:"answered_count"`
			Total    int       `json:"total_count"`
			Expires  time.Time `json:"expires_at"`
			Consent  any       `json:"consent"`
		}{v.company, v.title, 10, v.i.Status, v.i.AnsweredCount, v.i.TotalCount, v.i.ExpiresAt, notice}, 200)
	}
	if action == "consent" {
		if c.NoticeVersion != d.Notice.Version || c.TextSHA256 != d.Notice.SHA256 {
			return assessment.Result{}, assessment.ErrNoticeChanged
		}
		if v.i.ConsentedAt == nil {
			now, e := invitationNow(ctx, tx)
			if e != nil {
				return assessment.Result{}, e
			}
			if _, err = tx.Exec(ctx, `INSERT INTO psychometric_consents(invitation_id,notice_version,text_sha256,consented_at) VALUES($1,$2,$3,$4)`, v.i.ID, d.Notice.Version, d.Notice.SHA256, now); err != nil {
				return assessment.Result{}, err
			}
			if _, err = tx.Exec(ctx, `UPDATE psychometric_invitations SET consented_at=$2 WHERE id=$1`, v.i.ID, now); err != nil {
				return assessment.Result{}, err
			}
			actor, err := assessmentActor(ctx, tx, a, v.participation)
			if err != nil {
				return assessment.Result{}, err
			}
			if err = s.invitations.jobs.AuditPsychometricInvitation(ctx, tx, actor, v.process, v.participation, v.i.ID, "PsychometricConsentGiven"); err != nil {
				return assessment.Result{}, err
			}
		}
	} else {
		if v.i.ConsentedAt == nil {
			return assessment.Result{}, assessment.ErrConsentRequired
		}
		if action == "items" {
			return assessmentItems(ctx, tx, v.i.ID, d)
		}
		if action == "finish" {
			return s.finishAssessment(ctx, tx, a, v, artifact)
		}
		if position < 1 || position > len(d.Order) {
			return assessment.Result{}, assessment.ErrNotFound
		}
		if err = acceptAnswer(ctx, tx, v.i.ID, position, action, c); err != nil {
			return assessment.Result{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return assessment.Result{}, err
	}
	return assessment.Result{Status: 204}, nil
}
func assessmentItems(ctx context.Context, tx pgx.Tx, id uuid.UUID, d content.Document) (assessment.Result, error) {
	rows, err := tx.Query(ctx, `SELECT position,value FROM psychometric_answers WHERE invitation_id=$1`, id)
	if err != nil {
		return assessment.Result{}, err
	}
	defer rows.Close()
	values := map[int]*int{}
	for rows.Next() {
		var p int
		var v *int
		if err = rows.Scan(&p, &v); err != nil {
			return assessment.Result{}, err
		}
		values[p] = v
	}
	if err = rows.Err(); err != nil {
		return assessment.Result{}, err
	}
	texts := map[string]string{}
	for _, i := range d.Items {
		texts[i.ID] = i.Text
	}
	for _, i := range d.Attention {
		texts[i.ID] = i.Text
	}
	type item struct {
		Position int    `json:"position"`
		Text     string `json:"text"`
		Value    *int   `json:"value"`
	}
	items := make([]item, 0, len(d.Order))
	for _, p := range d.Order {
		items = append(items, item{p.Position, texts[p.ID], values[p.Position]})
	}
	return assessmentResult(struct {
		Scale []content.Option `json:"scale"`
		Items []item           `json:"items"`
	}{d.Scale, items}, 200)
}

// acceptAnswer is the sole answer/event/counter protocol. Caller owns the
// invitation lock, so order allocation, retry checks and latest value serialize.
func acceptAnswer(ctx context.Context, tx pgx.Tx, id uuid.UUID, position int, action string, c assessment.Command) error {
	var replay bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM psychometric_answer_events WHERE invitation_id=$1 AND event_id=$2)`, id, c.EventID).Scan(&replay); err != nil {
		return err
	}
	if replay {
		return nil
	}
	var old *int
	err := tx.QueryRow(ctx, `SELECT value FROM psychometric_answers WHERE invitation_id=$1 AND position=$2`, id, position).Scan(&old)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	now, err := invitationNow(ctx, tx)
	if err != nil {
		return err
	}
	kind := "put"
	if action == "delete" {
		kind = "delete"
		c.Value = nil
		c.ElapsedMS = nil
	}
	if _, err = tx.Exec(ctx, `INSERT INTO psychometric_answer_events(invitation_id,event_id,position,kind,value,client_elapsed_ms,received_at,server_sequence) SELECT $1,$2,$3,$4,$5,$6,$7,COALESCE(MAX(server_sequence),0)+1 FROM psychometric_answer_events WHERE invitation_id=$1`, id, c.EventID, position, kind, c.Value, c.ElapsedMS, now); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO psychometric_answers(invitation_id,position,value,client_elapsed_ms,received_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(invitation_id,position) DO UPDATE SET value=EXCLUDED.value,client_elapsed_ms=EXCLUDED.client_elapsed_ms,received_at=EXCLUDED.received_at`, id, position, c.Value, c.ElapsedMS, now); err != nil {
		return err
	}
	delta := 0
	if old == nil && c.Value != nil {
		delta = 1
	}
	if old != nil && c.Value == nil {
		delta = -1
	}
	if delta != 0 {
		_, err = tx.Exec(ctx, `UPDATE psychometric_invitations SET answered_count=answered_count+$2 WHERE id=$1`, id, delta)
	}
	return err
}

type accountAssessment struct {
	ID            uuid.UUID  `json:"id"`
	ApplicationID *uuid.UUID `json:"application_id"`
	Vacancy       struct {
		ID    uuid.UUID `json:"id"`
		Title string    `json:"title"`
	} `json:"vacancy"`
	Company struct {
		ID   uuid.UUID `json:"id"`
		Name string    `json:"name"`
	} `json:"company"`
	Status        string     `json:"status"`
	CreatedAt     time.Time  `json:"created_at"`
	ExpiresAt     time.Time  `json:"expires_at"`
	FinishedAt    *time.Time `json:"finished_at"`
	AnsweredCount int        `json:"answered_count"`
	TotalCount    int        `json:"total_count"`
	Minutes       int        `json:"estimated_minutes"`
}

func (s *AssessmentStore) List(ctx context.Context, subject string) (assessment.Result, error) {
	rows, err := s.invitations.pool.Query(ctx, `SELECT i.id,CASE WHEN p.source='organic' THEN p.id ELSE NULL END,v.id,v.title,c.id,c.name,i.created_at,i.expires_at,i.finished_at,i.consented_at,i.revoked_at,i.answered_count,i.total_count,clock_timestamp() FROM psychometric_invitations i JOIN process_participations p ON p.id=i.participation_id JOIN vacancy_public_projections v ON v.id=p.process_id JOIN companies c ON c.id=v.company_id WHERE p.candidate_id=(SELECT id FROM users WHERE cognito_sub=$1 AND user_type='candidate' AND deleted_at IS NULL) AND i.superseded_at IS NULL AND i.id=(SELECT n.id FROM psychometric_invitations n WHERE n.participation_id=i.participation_id AND n.test=i.test ORDER BY n.created_at DESC,n.id DESC LIMIT 1)`, subject)
	if err != nil {
		return assessment.Result{}, err
	}
	defer rows.Close()
	items := []accountAssessment{}
	for rows.Next() {
		var i accountAssessment
		var consent, revoked *time.Time
		var now time.Time
		if err = rows.Scan(&i.ID, &i.ApplicationID, &i.Vacancy.ID, &i.Vacancy.Title, &i.Company.ID, &i.Company.Name, &i.CreatedAt, &i.ExpiresAt, &i.FinishedAt, &consent, &revoked, &i.AnsweredCount, &i.TotalCount, &now); err != nil {
			return assessment.Result{}, err
		}
		i.CreatedAt = i.CreatedAt.UTC()
		i.ExpiresAt = i.ExpiresAt.UTC()
		if i.FinishedAt != nil {
			*i.FinishedAt = i.FinishedAt.UTC()
		}
		i.Status = invitations.StatusAt(now, i.ExpiresAt, consent, i.FinishedAt, revoked)
		i.Minutes = 10
		items = append(items, i)
	}
	if err = rows.Err(); err != nil {
		return assessment.Result{}, err
	}
	active := func(i accountAssessment) bool { return i.Status == "created" || i.Status == "in_progress" }
	sort.Slice(items, func(a, b int) bool {
		x, y := items[a], items[b]
		if active(x) != active(y) {
			return active(x)
		}
		if active(x) {
			if !x.ExpiresAt.Equal(y.ExpiresAt) {
				return x.ExpiresAt.Before(y.ExpiresAt)
			}
			return x.ID.String() < y.ID.String()
		}
		if !x.CreatedAt.Equal(y.CreatedAt) {
			return x.CreatedAt.After(y.CreatedAt)
		}
		return x.ID.String() > y.ID.String()
	})
	return assessmentResult(struct {
		Items []accountAssessment `json:"items"`
	}{items}, 200)
}
