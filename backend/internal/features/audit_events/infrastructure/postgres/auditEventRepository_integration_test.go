//go:build integration

package postgres

import (
	"context"
	"net/netip"
	"os"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres/audittest"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/requestmeta"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func auditAdapterPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("DRAFT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("DRAFT_TEST_DATABASE_URL not set; isolated database execution skipped")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

type auditRow struct {
	companyID, vacancyID    *uuid.UUID
	ip, userAgent, ipSource *string
	metadata                string
}

// appendAndRead appends one event on its own committed transaction and reads the
// row back through plain SQL, then removes it with the test cleanup helper.
func appendAndRead(t *testing.T, pool *pgxpool.Pool, ctx context.Context, event entities.AuditEvent) auditRow {
	t.Helper()
	t.Cleanup(func() {
		if err := audittest.Delete(context.Background(), pool, `DELETE FROM audit_events WHERE id = $1`, event.ID); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	})
	if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		return NewAuditEventRepository().Append(ctx, tx, event)
	}); err != nil {
		t.Fatalf("append: %v", err)
	}
	var row auditRow
	if err := pool.QueryRow(context.Background(),
		`SELECT company_id, vacancy_id, host(ip), user_agent, ip_source, metadata::text FROM audit_events WHERE id = $1`, event.ID,
	).Scan(&row.companyID, &row.vacancyID, &row.ip, &row.userAgent, &row.ipSource, &row.metadata); err != nil {
		t.Fatalf("read back: %v", err)
	}
	return row
}

func newAuditEvent(company, vacancy *uuid.UUID) entities.AuditEvent {
	return entities.AuditEvent{
		ID: uuid.Must(uuid.NewV7()), ActorType: entities.ActorTypeSystem,
		EventType: "AuditAdapterTest", EntityType: entities.EntityCompany, EntityID: uuid.Must(uuid.NewV7()),
		Metadata: map[string]string{"k": "v"}, CompanyID: company, VacancyID: vacancy,
	}
}

func TestAppendPersistsCompanyVacancyAndRequestMetadata(t *testing.T) {
	pool := auditAdapterPool(t)
	company, vacancy := uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())
	for name, tc := range map[string]struct{ ip, want string }{
		"ipv4": {"201.141.12.7", "201.141.12.7"},
		"ipv6": {"2001:db8::7", "2001:db8::7"},
	} {
		t.Run(name, func(t *testing.T) {
			ip := mustAddr(tc.ip)
			ua := "Mozilla/5.0 (Macintosh)"
			ctx := requestmeta.NewContext(context.Background(), requestmeta.Meta{IP: &ip, UserAgent: &ua, IPSource: requestmeta.SourceBFF})
			row := appendAndRead(t, pool, ctx, newAuditEvent(&company, &vacancy))
			if row.companyID == nil || *row.companyID != company || row.vacancyID == nil || *row.vacancyID != vacancy {
				t.Fatalf("company/vacancy: %+v", row)
			}
			if row.ip == nil || *row.ip != tc.want || row.userAgent == nil || *row.userAgent != ua || row.ipSource == nil || *row.ipSource != "bff" {
				t.Fatalf("request metadata: ip=%v ua=%v source=%v", deref(row.ip), deref(row.userAgent), deref(row.ipSource))
			}
			if row.metadata != `{"k": "v"}` {
				t.Fatalf("metadata changed: %s", row.metadata)
			}
		})
	}
}

func TestAppendWithBareContextPersistsNulls(t *testing.T) {
	pool := auditAdapterPool(t)
	row := appendAndRead(t, pool, context.Background(), newAuditEvent(nil, nil))
	if row.companyID != nil || row.vacancyID != nil || row.ip != nil || row.userAgent != nil || row.ipSource != nil {
		t.Fatalf("want all five columns NULL: %+v", row)
	}
}

func TestAppendPeerWithoutIPKeepsSourceAndNullIP(t *testing.T) {
	pool := auditAdapterPool(t)
	ctx := requestmeta.NewContext(context.Background(), requestmeta.Meta{IPSource: requestmeta.SourcePeer})
	row := appendAndRead(t, pool, ctx, newAuditEvent(nil, nil))
	if row.ip != nil || row.userAgent != nil || row.ipSource == nil || *row.ipSource != "peer" {
		t.Fatalf("ip=%v ua=%v source=%v", deref(row.ip), deref(row.userAgent), deref(row.ipSource))
	}
}

func deref(s *string) string {
	if s == nil {
		return "<null>"
	}
	return *s
}

func mustAddr(s string) netip.Addr { return netip.MustParseAddr(s) }
