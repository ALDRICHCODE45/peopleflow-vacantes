package capture_test

import (
	"context"
	"errors"
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
