package sender

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/inbox"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/preferences"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// prepare is the D11 re-check followed by the §Content view, read-only and
// outside any transaction (each read is its own autocommit statement). It
// returns either a skip reason or the view; an error is a read failure
// (transient). The address is read from users.email here and only travels in
// the view to the Mailer (D19).
func (s *Sender) prepare(ctx context.Context, c claimed) (email.View, string, error) {
	q := db.New(s.pool)
	company := pgtype.UUID{}
	if c.company != uuid.Nil {
		company = pgtype.UUID{Bytes: c.company, Valid: true}
	}
	rec, err := q.GetNotificationEmailRecipient(ctx, db.GetNotificationEmailRecipientParams{UserID: c.user, CompanyID: company})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return email.View{}, SkipRecipientGone, nil
	case err != nil:
		return email.View{}, "", stepErr(stepRecheck, err)
	case !rec.Live || !rec.InCompany:
		return email.View{}, SkipRecipientGone, nil
	case strings.TrimSpace(rec.Email) == "":
		return email.View{}, SkipNoAddress, nil
	case rec.Suppressed:
		return email.View{}, SkipSuppressed, nil
	}
	key := domain.PreferenceKey{User: c.user, Company: c.company, Type: c.typ}
	prefs, err := preferences.ReadOverrides(ctx, q, domain.ChannelEmail, []domain.PreferenceKey{key})
	if err != nil {
		return email.View{}, "", stepErr(stepRecheck, err)
	}
	if !prefs.Effective(key) {
		return email.View{}, SkipPreferenceOff, nil
	}
	rows, err := q.ListNotificationEmailDeliveryRows(ctx, c.id)
	if err != nil {
		return email.View{}, "", stepErr(stepRecheck, err)
	}
	// No linked row left (purged or removed) counts as resolved: there is
	// nothing to tell.
	resolved, read := true, true
	for _, r := range rows {
		resolved = resolved && r.IsResolved
		read = read && r.IsRead
	}
	if resolved {
		return email.View{}, SkipResolved, nil
	}
	if read && !domain.Locked(c.typ) {
		return email.View{}, SkipRead, nil
	}

	latest := rows[len(rows)-1]
	payload := map[string]any{}
	if len(latest.Payload) > 0 {
		if err := json.Unmarshal(latest.Payload, &payload); err != nil {
			return email.View{}, "", stepErr(stepView, err)
		}
	}
	text := func(k string) string { v, _ := payload[k].(string); return v }
	v := email.View{
		DeliveryID: c.id,
		Type:       c.typ,
		To:         strings.TrimSpace(rec.Email),
		User:       c.user,
		Company:    c.company,
		Count:      len(rows),
		Day:        rows[0].CreatedAt.Time,
		Function:   text("function"),
		Reason:     text("reason"),
		Status:     text("status"),
	}
	if latest.CommitmentDate.Valid {
		v.CommitmentDate = latest.CommitmentDate.Time
	}
	var participation *uuid.UUID
	if latest.ParticipationID.Valid {
		p := uuid.UUID(latest.ParticipationID.Bytes)
		participation = &p
	}

	var link *inbox.Link
	if c.company != uuid.Nil {
		job, err := q.GetNotificationEmailMemberJob(ctx, db.GetNotificationEmailMemberJobParams{UserID: c.user, JobID: c.job, CompanyID: c.company})
		if errors.Is(err, pgx.ErrNoRows) {
			return email.View{}, SkipRecipientGone, nil // company removed since the re-check
		}
		if err != nil {
			return email.View{}, "", stepErr(stepView, err)
		}
		name := job.CompanyName
		v.CompanyName = &name
		if job.HasTitle {
			title := job.Title
			v.JobTitle = &title
		}
		link = inbox.LinkFor(c.typ, c.job, v.Count, participation, payload, job.CanOpen)
	} else {
		// Candidates: the public title and hiring company they see in
		// /v2/me/applications, and a link only while they still participate
		// (as the candidate inbox).
		jobs, err := q.ListCandidateNotificationJobs(ctx, db.ListCandidateNotificationJobsParams{UserID: c.user, JobIds: []uuid.UUID{c.job}})
		if err != nil {
			return email.View{}, "", stepErr(stepView, err)
		}
		if len(jobs) == 1 {
			name := jobs[0].CompanyName
			v.CompanyName = &name
			if jobs[0].HasTitle {
				title := jobs[0].Title
				v.JobTitle = &title
			}
			link = inbox.LinkFor(c.typ, c.job, v.Count, participation, payload, true)
		}
	}
	v.Link, err = emailLink(link)
	if err != nil {
		return email.View{}, "", stepErr(stepView, err)
	}
	return v, "", nil
}

// emailLink converts the inbox descriptor (string ids) to the renderer's.
func emailLink(l *inbox.Link) (*email.Link, error) {
	if l == nil {
		return nil, nil
	}
	out := &email.Link{Kind: email.LinkKind(l.Kind)}
	for _, f := range []struct {
		raw string
		dst *uuid.UUID
	}{{l.JobID, &out.JobID}, {l.ParticipationID, &out.ParticipationID}, {l.InvitationID, &out.InvitationID}} {
		if f.raw == "" {
			continue
		}
		id, err := uuid.Parse(f.raw)
		if err != nil {
			return nil, err
		}
		*f.dst = id
	}
	return out, nil
}
