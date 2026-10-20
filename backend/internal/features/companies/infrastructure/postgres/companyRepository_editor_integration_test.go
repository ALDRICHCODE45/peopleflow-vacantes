//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	geo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
	shared "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type rejectEditorAudit struct{}

func (rejectEditorAudit) Append(context.Context, pgx.Tx, audit.AuditEvent) error {
	return errors.New("injected editor audit failure")
}

func TestCompanyEditorWriteReturnsOwnRowAndRollsBackErrors(t *testing.T) {
	pool := skipIfNoDatabase(t)
	t.Cleanup(pool.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	seedCompanyLocationCatalog(t, ctx, pool)
	if _, err := pool.Exec(ctx, `INSERT INTO geo_countries VALUES('US','Estados Unidos','United States') ON CONFLICT DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	id, token, _ := seedRaceCompany(t, ctx, pool, "editor-row")
	t.Cleanup(func() { cleanupRaceCompany(t, pool, id) })
	repo := newTestCompanyRepository(pool)
	event := func() audit.AuditEvent {
		return audit.AuditEvent{ID: uuid.New(), ActorType: audit.ActorTypeSystem, EventType: audit.EventCompanyUpdated, EntityType: audit.EntityCompany, EntityID: id, Metadata: map[string]string{}}
	}
	patch := func(country string) repositories.UpdateCompanyPatch {
		return repositories.UpdateCompanyPatch{Location: shared.Optional[geo.Value]{Set: true, Valid: true, Value: geo.Value{Country: country}}}
	}
	first, err := repo.UpdateCompanyReturning(ctx, id, patch("MX"), token, event())
	if err != nil || first == nil {
		t.Fatal("first editor write", err)
	}
	if first.Location == nil || first.Location.Country != "MX" || !first.UpdatedAt.After(token) {
		t.Fatal("first written row", first)
	}
	second, err := repo.UpdateCompanyReturning(ctx, id, patch("US"), first.UpdatedAt, event())
	if err != nil || second == nil {
		t.Fatal("second editor write", err)
	}
	if second.Location == nil || second.Location.Country != "US" || !second.UpdatedAt.After(first.UpdatedAt) {
		t.Fatal("second written row", second)
	}
	if first.Location.Country != "MX" {
		t.Fatal("later write mutated first response")
	}
	stale, err := repo.UpdateCompanyReturning(ctx, id, patch("MX"), first.UpdatedAt, event())
	if !errors.Is(err, entities.ErrCompanyNotFound) || stale != nil {
		t.Fatal("stale CAS returned a row", stale, err)
	}
	failed, err := NewCompanyRepository(pool, rejectEditorAudit{}).UpdateCompanyReturning(ctx, id, patch("MX"), second.UpdatedAt, event())
	if err == nil || failed != nil {
		t.Fatal("audit failure returned a success row", failed, err)
	}
	current, err := repo.GetCompanyForUpdate(ctx, id)
	if err != nil || current.Location == nil || current.Location.Country != "US" || !current.UpdatedAt.Equal(second.UpdatedAt) {
		t.Fatal("failed editor write committed company state", current, err)
	}
	if count := auditCount(t, ctx, pool, id); count != 2 {
		t.Fatal("stale/failed editor write appended audit", count)
	}
}
