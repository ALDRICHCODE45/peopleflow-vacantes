//go:build integration

package main

import (
	"context"
	"io"
	"testing"

	movementpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/board"
	poolpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/pool"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
)

// The CV row is committed before a store hands the stream to its handler
// (audit-log-v1 §2), so a download interrupted mid-stream stays recorded. Each
// check reads the row from ANOTHER connection before touching the returned reader.
func TestAuditSensitiveReads_CVRowCommittedBeforeFirstByte(t *testing.T) {
	f := newCandidateCVFixture(t, "manual")
	auditCleanupCompany(t, f)
	company := f.company.companyID
	ctx := context.Background()
	audit := auditpostgres.NewAuditEventRepository()

	poolStore := poolpostgres.NewStore(f.h.pool, audit, poolStageNames).WithStorage(f.local)
	for _, original := range []bool{false, true} {
		before := len(auditRowsOf(t, f.h.pool, company, "CompanyCandidateCVDownloaded"))
		read := poolStore.File
		if original {
			read = poolStore.OriginalFile
		}
		file, err := read(ctx, company, f.recruiter.userID, "manual", f.id, f.pid)
		if err != nil {
			t.Fatal(err)
		}
		if got := len(auditRowsOf(t, f.h.pool, company, "CompanyCandidateCVDownloaded")); got != before+1 {
			t.Fatalf("pool cv original=%v: row not committed before the first byte (%d new rows, want 1)", original, got-before)
		}
		if err := file.Reader.Close(); err != nil {
			t.Fatal(err)
		}
	}

	boardStore := movementpostgres.NewStore(f.h.pool, audit, movementContext{f.h.store}, f.local, draftjson.Decode)
	vacancy := f.vacancy(t)
	for _, original := range []bool{false, true} {
		before := len(auditRowsOf(t, f.h.pool, company, "ParticipationCVDownloaded"))
		read := boardStore.File
		if original {
			read = boardStore.OriginalFile
		}
		file, err := read(ctx, company, f.owner.userID, vacancy, f.pid)
		if err != nil {
			t.Fatal(err)
		}
		if got := len(auditRowsOf(t, f.h.pool, company, "ParticipationCVDownloaded")); got != before+1 {
			t.Fatalf("board cv original=%v: row not committed before the first byte (%d new rows, want 1)", original, got-before)
		}
		if _, err := io.Copy(io.Discard, file.Reader); err != nil {
			t.Fatal(err)
		}
		_ = file.Reader.Close()
	}
}
