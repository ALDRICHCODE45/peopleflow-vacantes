package http

import (
	"context"
	"time"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/google/uuid"
)

// Existing deterministic fakes expose their programmed post-write row through
// GetCompanyForUpdate. Adapt that fixture data to the atomic editor-write port;
// the service itself must never perform a second, post-commit company read.
func programmedEditorWrite(ctx context.Context, repo repositories.CompanyRepository, id uuid.UUID, patch repositories.UpdateCompanyPatch, cas time.Time, event audit.AuditEvent) (*entities.Company, error) {
	if err := repo.UpdateCompany(ctx, id, patch, cas, event); err != nil {
		return nil, err
	}
	return repo.GetCompanyForUpdate(ctx, id)
}
func (r *stubRepo) UpdateCompanyReturning(ctx context.Context, id uuid.UUID, patch repositories.UpdateCompanyPatch, cas time.Time, event audit.AuditEvent) (*entities.Company, error) {
	return programmedEditorWrite(ctx, r, id, patch, cas, event)
}
func (r *stubUpdateServiceRepo) UpdateCompanyReturning(ctx context.Context, id uuid.UUID, patch repositories.UpdateCompanyPatch, cas time.Time, event audit.AuditEvent) (*entities.Company, error) {
	return programmedEditorWrite(ctx, r, id, patch, cas, event)
}
func (r *sequentialUpdateRepo) UpdateCompanyReturning(ctx context.Context, id uuid.UUID, patch repositories.UpdateCompanyPatch, cas time.Time, event audit.AuditEvent) (*entities.Company, error) {
	return programmedEditorWrite(ctx, r, id, patch, cas, event)
}
func (r *membershipCASRepo) UpdateCompanyReturning(ctx context.Context, id uuid.UUID, patch repositories.UpdateCompanyPatch, cas time.Time, event audit.AuditEvent) (*entities.Company, error) {
	return programmedEditorWrite(ctx, r, id, patch, cas, event)
}
