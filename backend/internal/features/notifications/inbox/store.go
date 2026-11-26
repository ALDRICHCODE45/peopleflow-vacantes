package inbox

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Scope is the member scope of a request (§Data model): the session user's
// rows with recipient_kind member in the current company. Owner grants
// access to every vacancy of the company (D19).
type Scope struct {
	UserID    uuid.UUID
	CompanyID uuid.UUID
	Owner     bool
}

// Page is the GET B response. Attention and AttentionTotal are null on pages
// after the first.
type Page struct {
	Attention           *[]Item `json:"attention"`
	AttentionTotal      *int    `json:"attention_total"`
	Items               []Item  `json:"items"`
	NextCursor          *string `json:"next_cursor"`
	UnreadCount         int     `json:"unread_count"`
	UnreadNotifications int     `json:"unread_notifications"`
}

// Counts is the GET B/unread-count response (D14).
type Counts struct {
	UnreadCount         int `json:"unread_count"`
	UnreadNotifications int `json:"unread_notifications"`
}

// Item is one group (§Grouping).
type Item struct {
	GroupKey    string         `json:"group_key"`
	Type        domain.Type    `json:"type"`
	Kind        domain.Kind    `json:"kind"`
	Urgency     domain.Urgency `json:"urgency"`
	Count       int            `json:"count"`
	UnreadCount int            `json:"unread_count"`
	Read        bool           `json:"read"`
	Resolved    bool           `json:"resolved"`
	LatestAt    time.Time      `json:"latest_at"`
	FirstAt     time.Time      `json:"first_at"`
	Job         Job            `json:"job"`
	Latest      Latest         `json:"latest"`
	Sample      []Subject      `json:"sample"`
	Link        *Link          `json:"link"`
	FromUser    *Person        `json:"from_user,omitempty"`
	ToUser      *Person        `json:"to_user,omitempty"`
}

// Job carries the current draft title; null when the job is gone.
type Job struct {
	ID    string  `json:"id"`
	Title *string `json:"title"`
}

// Latest is the newest notification of a group.
type Latest struct {
	ID        string          `json:"id"`
	CreatedAt time.Time       `json:"created_at"`
	Actor     *Person         `json:"actor"`
	Payload   json.RawMessage `json:"payload"`
}

// Person is a user resolved at read time.
type Person struct {
	UserID string  `json:"user_id"`
	Name   *string `json:"name"`
}

// Subject is one sample participation; name is null without vacancy access.
type Subject struct {
	ParticipationID string  `json:"participation_id"`
	Name            *string `json:"name"`
}

// Store reads the member scope through sqlc in one read-only snapshot.
type Store struct{ pool *pgxpool.Pool }

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

var readOnly = pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}

// UnreadCount returns unread groups (attention included) and unread rows.
func (s *Store) UnreadCount(ctx context.Context, scope Scope) (Counts, error) {
	row, err := db.New(s.pool).CountMemberUnreadNotifications(ctx, db.CountMemberUnreadNotificationsParams{UserID: scope.UserID, CompanyID: scope.CompanyID})
	if err != nil {
		return Counts{}, fmt.Errorf("count unread notifications: %w", err)
	}
	return Counts{UnreadCount: int(row.UnreadGroups), UnreadNotifications: int(row.UnreadNotifications)}, nil
}

// raw is one group before read-time resolution.
type raw struct {
	item          Item
	jobID         uuid.UUID
	actor         *uuid.UUID
	participation *uuid.UUID
	payload       map[string]any
}

// List returns one page of groups, the attention section on the first page
// and the scope's counters, all from the same snapshot.
func (s *Store) List(ctx context.Context, scope Scope, q Query) (Page, error) {
	tx, err := s.pool.BeginTx(ctx, readOnly)
	if err != nil {
		return Page{}, fmt.Errorf("begin notifications read: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qs := db.New(tx)
	types, jobs := q.Types, q.JobIDs
	if types == nil {
		types = []string{}
	}
	if jobs == nil {
		jobs = []uuid.UUID{}
	}

	var page Page
	var attention []raw
	if q.After == nil {
		rows, err := qs.ListMemberNotificationAttention(ctx, db.ListMemberNotificationAttentionParams{
			UserID: scope.UserID, CompanyID: scope.CompanyID, Types: types, JobIds: jobs, AttentionLimit: AttentionLimit})
		if err != nil {
			return Page{}, fmt.Errorf("list notification attention: %w", err)
		}
		total := 0
		for _, r := range rows {
			total = int(r.Total)
			at := r.CreatedAt.Time.UTC()
			attention = append(attention, newRaw(r.GroupKey, r.Type, r.JobID, 1, 1, false, at, at, r.ID, at, r.ActorUserID, r.ParticipationID, r.Payload))
		}
		page.AttentionTotal = &total
	}

	params := db.ListMemberNotificationGroupsParams{
		UserID: scope.UserID, CompanyID: scope.CompanyID, Types: types, JobIds: jobs, AttentionLimit: AttentionLimit,
		UnreadOnly: q.State == StateUnread, PageLimit: int32(q.Limit + 1)}
	if q.After != nil {
		params.AfterAt = pgtype.Timestamptz{Time: q.After.At, Valid: true}
		params.AfterKey = pgtype.Text{String: q.After.GroupKey, Valid: true}
	}
	rows, err := qs.ListMemberNotificationGroups(ctx, params)
	if err != nil {
		return Page{}, fmt.Errorf("list notification groups: %w", err)
	}
	if len(rows) > q.Limit {
		rows = rows[:q.Limit]
		last := rows[len(rows)-1]
		cursor := EncodeCursor(q, Position{At: last.LatestAt.Time, GroupKey: last.GroupKey})
		page.NextCursor = &cursor
	}
	groups := make([]raw, 0, len(rows))
	for _, r := range rows {
		groups = append(groups, newRaw(r.GroupKey, r.Type, r.JobID, int(r.Total), int(r.Unread), r.Resolved,
			r.LatestAt.Time.UTC(), r.FirstAt.Time.UTC(), r.LatestID, r.LatestCreatedAt.Time.UTC(), r.LatestActorUserID, r.LatestParticipationID, r.LatestPayload))
	}

	if err := resolve(ctx, qs, scope, append(append([]raw{}, attention...), groups...), func(resolved []Item) {
		if q.After == nil {
			items := resolved[:len(attention)]
			page.Attention = &items
		}
		page.Items = resolved[len(attention):]
	}); err != nil {
		return Page{}, err
	}

	counts, err := qs.CountMemberUnreadNotifications(ctx, db.CountMemberUnreadNotificationsParams{UserID: scope.UserID, CompanyID: scope.CompanyID})
	if err != nil {
		return Page{}, fmt.Errorf("count unread notifications: %w", err)
	}
	page.UnreadCount, page.UnreadNotifications = int(counts.UnreadGroups), int(counts.UnreadNotifications)
	return page, nil
}

func newRaw(key, typ string, job uuid.UUID, count, unread int, resolved bool, latestAt, firstAt time.Time,
	latestID uuid.UUID, latestCreated time.Time, actor, participation pgtype.UUID, payload []byte) raw {
	spec, _ := domain.Lookup(domain.Type(typ))
	if len(payload) == 0 {
		payload = []byte(`{}`)
	}
	var decoded map[string]any
	_ = json.Unmarshal(payload, &decoded)
	return raw{
		item: Item{GroupKey: key, Type: domain.Type(typ), Kind: spec.Kind, Urgency: spec.Urgency, Count: count, UnreadCount: unread,
			Read: unread == 0, Resolved: resolved, LatestAt: latestAt, FirstAt: firstAt, Job: Job{ID: job.String()},
			Latest: Latest{ID: latestID.String(), CreatedAt: latestCreated, Payload: json.RawMessage(payload)}, Sample: []Subject{}},
		jobID: job, actor: optional(actor), participation: optional(participation), payload: decoded,
	}
}

func optional(v pgtype.UUID) *uuid.UUID {
	if !v.Valid {
		return nil
	}
	id := uuid.UUID(v.Bytes)
	return &id
}

// personRef is the payload key holding the from/to user of a type (§Endpoints).
var personRef = map[domain.Type]string{domain.TypeVacancyReassigned: "from_user_id", domain.TypeVacancyUnassigned: "to_user_id"}

// resolve fills titles, access-gated candidate names, actors, from/to users,
// samples and links at read time (D19) and hands the items to done in order.
func resolve(ctx context.Context, qs *db.Queries, scope Scope, groups []raw, done func([]Item)) error {
	jobIDs, userIDs, keys := []uuid.UUID{}, []uuid.UUID{}, []string{}
	people := make([]*uuid.UUID, len(groups))
	for i, g := range groups {
		jobIDs = append(jobIDs, g.jobID)
		if g.actor != nil {
			userIDs = append(userIDs, *g.actor)
		}
		if key, ok := personRef[g.item.Type]; ok {
			if raw, _ := g.payload[key].(string); raw != "" {
				if id, err := uuid.Parse(raw); err == nil {
					people[i] = &id
					userIDs = append(userIDs, id)
				}
			}
		}
		if g.participation != nil || g.item.Count > 1 {
			keys = append(keys, g.item.GroupKey)
		}
	}
	if len(groups) == 0 {
		done([]Item{})
		return nil
	}

	jobRows, err := qs.ListNotificationJobs(ctx, db.ListNotificationJobsParams{IsOwner: scope.Owner, UserID: scope.UserID, CompanyID: scope.CompanyID, JobIds: jobIDs})
	if err != nil {
		return fmt.Errorf("list notification jobs: %w", err)
	}
	type jobInfo struct {
		title   *string
		canOpen bool
	}
	jobsByID := map[uuid.UUID]jobInfo{}
	for _, j := range jobRows {
		info := jobInfo{canOpen: j.CanOpen}
		if j.HasTitle {
			title := j.Title
			info.title = &title
		}
		jobsByID[j.ID] = info
	}

	samples := map[string][]uuid.UUID{}
	participationIDs := []uuid.UUID{}
	if len(keys) > 0 {
		rows, err := qs.ListMemberNotificationSamples(ctx, db.ListMemberNotificationSamplesParams{UserID: scope.UserID, CompanyID: scope.CompanyID, GroupKeys: keys})
		if err != nil {
			return fmt.Errorf("list notification samples: %w", err)
		}
		for _, r := range rows {
			samples[r.GroupKey] = append(samples[r.GroupKey], r.ParticipationID)
			participationIDs = append(participationIDs, r.ParticipationID)
		}
	}
	type candidate struct {
		job  uuid.UUID
		name string
	}
	candidates := map[uuid.UUID]candidate{}
	if len(participationIDs) > 0 {
		rows, err := qs.ListNotificationCandidateNames(ctx, db.ListNotificationCandidateNamesParams{CompanyID: scope.CompanyID, ParticipationIds: participationIDs})
		if err != nil {
			return fmt.Errorf("list notification candidate names: %w", err)
		}
		for _, r := range rows {
			candidates[r.ID] = candidate{job: r.ProcessID, name: r.Name}
		}
	}
	type user struct {
		candidate bool
		name      string
	}
	users := map[uuid.UUID]user{}
	if len(userIDs) > 0 {
		rows, err := qs.ListNotificationUserNames(ctx, db.ListNotificationUserNamesParams{CompanyID: scope.CompanyID, UserIds: userIDs})
		if err != nil {
			return fmt.Errorf("list notification user names: %w", err)
		}
		for _, r := range rows {
			users[r.ID] = user{candidate: r.IsCandidate, name: r.Name}
		}
	}

	name := func(v string, visible bool) *string {
		if !visible || v == "" {
			return nil
		}
		return &v
	}
	person := func(id uuid.UUID, canOpen bool) *Person {
		u, ok := users[id]
		// A candidate account's name is a candidate name: gated like the sample.
		return &Person{UserID: id.String(), Name: name(u.name, ok && (!u.candidate || canOpen))}
	}
	items := make([]Item, len(groups))
	for i, g := range groups {
		item := g.item
		job := jobsByID[g.jobID]
		item.Job.Title = job.title
		for _, pid := range samples[item.GroupKey] {
			c, ok := candidates[pid]
			item.Sample = append(item.Sample, Subject{ParticipationID: pid.String(), Name: name(c.name, ok && job.canOpen && c.job == g.jobID)})
		}
		if g.actor != nil {
			item.Latest.Actor = person(*g.actor, job.canOpen)
		}
		if people[i] != nil {
			p := person(*people[i], job.canOpen)
			if item.Type == domain.TypeVacancyReassigned {
				item.FromUser = p
			} else {
				item.ToUser = p
			}
		}
		item.Link = linkFor(item.Type, g.jobID, item.Count, g.participation, g.payload, job.canOpen)
		items[i] = item
	}
	done(items)
	return nil
}
