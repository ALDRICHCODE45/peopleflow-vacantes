package capture_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/capture"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type fakeAudit struct {
	err   error
	calls int
}

func (f *fakeAudit) Append(context.Context, pgx.Tx, audit.AuditEvent) error {
	f.calls++
	return f.err
}

var _ auditrepositories.AuditEventRepository = (*capture.Decorator)(nil)

// The inner audit append runs first; its failure is returned untouched and
// nothing is captured (the nil tx would panic on any capture SQL).
func TestDecoratorReturnsInnerFailureWithoutCapture(t *testing.T) {
	inner := &fakeAudit{err: errors.New("refuse audit event")}
	company := uuid.New()
	event := audit.AuditEvent{ID: uuid.New(), EventType: audit.EventVacancyApplicationSubmitted, EntityID: uuid.New(), CompanyID: &company,
		Metadata: map[string]string{"vacancy_id": uuid.NewString()}}
	if err := capture.New(inner).Append(context.Background(), nil, event); !errors.Is(err, inner.err) || inner.calls != 1 {
		t.Fatalf("err=%v calls=%d", err, inner.calls)
	}
}

// Non-notifiable types never touch the transaction.
func TestDecoratorIgnoresNonNotifiableTypes(t *testing.T) {
	inner := &fakeAudit{}
	company := uuid.New()
	event := audit.AuditEvent{ID: uuid.New(), EventType: audit.EventParticipationSubstateChanged, EntityID: uuid.New(), CompanyID: &company}
	if err := capture.New(inner).Append(context.Background(), nil, event); err != nil || inner.calls != 1 {
		t.Fatalf("err=%v calls=%d", err, inner.calls)
	}
}

// A notifiable event without its ids fails the append (fail-closed) before any SQL.
func TestDecoratorFailsClosedOnMissingIDs(t *testing.T) {
	inner := &fakeAudit{}
	company := uuid.New()
	event := audit.AuditEvent{ID: uuid.New(), EventType: audit.EventVacancyApplicationSubmitted, EntityID: uuid.New(), CompanyID: &company}
	if err := capture.New(inner).Append(context.Background(), nil, event); !errors.Is(err, domain.ErrMissingID) {
		t.Fatalf("err=%v", err)
	}
}

// L9 follow-up: capture failures are counted and logged distinctly with the
// audit type and audit event id only (never metadata values); inner audit
// failures and non-notifiable types are not capture failures.
func TestDecoratorCountsAndLogsCaptureFailures(t *testing.T) {
	var logs bytes.Buffer
	inner := &fakeAudit{}
	d := capture.New(inner).WithLogger(slog.New(slog.NewJSONHandler(&logs, nil)))
	company := uuid.New()
	secret := "nope-" + uuid.NewString()
	event := audit.AuditEvent{ID: uuid.New(), EventType: audit.EventVacancyApplicationSubmitted, EntityID: uuid.New(), CompanyID: &company,
		Metadata: map[string]string{"vacancy_id": secret}}
	if err := d.Append(context.Background(), nil, event); !errors.Is(err, domain.ErrMissingID) {
		t.Fatalf("err=%v", err)
	}
	if got := d.Failures(); got != 1 {
		t.Fatalf("failures=%d", got)
	}
	line := logs.String()
	for _, want := range []string{"notification capture failed", event.EventType, event.ID.String()} {
		if !strings.Contains(line, want) {
			t.Fatalf("log %q lacks %q", line, want)
		}
	}
	if strings.Contains(line, secret) || strings.Contains(line, event.EntityID.String()) || strings.Contains(line, company.String()) {
		t.Fatalf("log leaks event values: %q", line)
	}

	logs.Reset()
	inner.err = errors.New("refuse audit event")
	_ = d.Append(context.Background(), nil, event)
	inner.err = nil
	_ = d.Append(context.Background(), nil, audit.AuditEvent{ID: uuid.New(), EventType: audit.EventParticipationSubstateChanged, CompanyID: &company})
	if got := d.Failures(); got != 1 || logs.Len() != 0 {
		t.Fatalf("failures=%d logs=%q", got, logs.String())
	}
}
