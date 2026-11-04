package draftstore

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// vacancyCompany returns the company that owns a vacancy (job draft). Emitters
// that are reached without the company in hand (stage entry, candidate-side
// psychometric steps, delivery recording) use it so every audit row carries
// company_id (audit-log-v1 §1).
func vacancyCompany(ctx context.Context, tx pgx.Tx, vacancy uuid.UUID) (uuid.UUID, error) {
	var company uuid.UUID
	err := tx.QueryRow(ctx, `SELECT company_id FROM job_drafts WHERE id=$1`, vacancy).Scan(&company)
	return company, err
}
