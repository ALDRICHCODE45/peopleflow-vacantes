//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/google/uuid"
)

// The writer uses the same draft-then-projection order as SaveV2/Publish.
// pg_blocking_pids establishes that Apply's original statement snapshot was
// taken before the writer committed; scheduler timing alone cannot prove that.
func TestGeoApplyCountryScopeAfterWaitingForDraftSave(t *testing.T) {
	for _, tc := range []struct {
		name, oldScope, newScope string
		reject                   bool
	}{
		{"tighten anywhere to CO", `{"kind":"anywhere"}`, `{"kind":"countries","countries":["CO"]}`, true},
		{"tighten MX to CO", `{"kind":"countries","countries":["MX"]}`, `{"kind":"countries","countries":["CO"]}`, true},
		{"relax CO to anywhere", `{"kind":"countries","countries":["CO"]}`, `{"kind":"anywhere"}`, false},
		{"relax CO to MX", `{"kind":"countries","countries":["CO"]}`, `{"kind":"countries","countries":["MX"]}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := setup(t)
			seedApplyGeo(t, f)
			applyProfileCountry(t, f, "MX")
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			scopeFields := func(raw string) ([]byte, string, []string) {
				t.Helper()
				fields, err := draftinput.DecodeCreateV2([]byte(`{"fields":{"title":"Engineer","work_mode":"remote","remote_scope":` + raw + `,"screening_questions":[{"id":"11111111-1111-4111-8111-111111111111","type":"open","prompt":"Why?"}]}}`))
				if err != nil {
					t.Fatal(err)
				}
				var scope struct {
					Kind      string   `json:"kind"`
					Countries []string `json:"countries"`
				}
				if err = json.Unmarshal([]byte(raw), &scope); err != nil {
					t.Fatal(err)
				}
				return fields.Fingerprint(), scope.Kind, scope.Countries
			}
			oldFields, oldKind, oldCountries := scopeFields(tc.oldScope)
			newFields, newKind, newCountries := scopeFields(tc.newScope)
			if _, err := f.pool.Exec(ctx, `UPDATE job_drafts SET fields=$2 WHERE id=$1`, f.vacancy, oldFields); err != nil {
				t.Fatal(err)
			}
			if _, err := f.pool.Exec(ctx, `UPDATE vacancy_public_projections SET work_mode='remote',remote_scope_kind=$2,remote_countries=$3 WHERE id=$1`, f.vacancy, oldKind, oldCountries); err != nil {
				t.Fatal(err)
			}
			cv, err := f.library.Upload(ctx, f.sub, "CV", "cv.pdf", []byte("%PDF-1"))
			if err != nil {
				t.Fatal(err)
			}
			before := f.geoApplyEffects(t)
			applyPool, applyPID := operationPool(t, ctx, f.pool)
			intake := NewStore(applyPool, f.store.audit, f.store.rules, f.store.delivery)
			writer, err := f.pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer writer.Rollback(context.Background())
			var writerPID int
			if err = writer.QueryRow(ctx, `SELECT pg_backend_pid() FROM job_drafts WHERE id=$1 FOR UPDATE`, f.vacancy).Scan(&writerPID); err != nil {
				t.Fatal(err)
			}
			if _, err = writer.Exec(ctx, `UPDATE job_drafts SET fields=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1`, f.vacancy, newFields); err != nil {
				t.Fatal(err)
			}
			if _, err = writer.Exec(ctx, `UPDATE vacancy_public_projections SET remote_scope_kind=$2,remote_countries=$3,source_draft_version=source_draft_version+1 WHERE id=$1`, f.vacancy, newKind, newCountries); err != nil {
				t.Fatal(err)
			}
			type outcome struct {
				result app.Result
				err    error
			}
			done := make(chan outcome, 1)
			go func() {
				result, err := intake.Apply(ctx, f.sub, f.vacancy, uuid.New(), f.request(cv.ID))
				done <- outcome{result, err}
			}()
			waitBlockedBy(t, ctx, f.pool, applyPID, writerPID)
			if err = writer.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			var got outcome
			select {
			case got = <-done:
			case <-ctx.Done():
				t.Fatal("Apply did not finish after draft save committed", ctx.Err())
			}
			if tc.reject {
				var restriction *app.CountryRestriction
				if !errors.Is(got.err, app.ErrApplicantCountryNotAllowed) || !errors.As(got.err, &restriction) || !reflect.DeepEqual(restriction.Allowed, newCountries) {
					t.Fatalf("Apply must use committed scope %s: result=%s error=%v", tc.newScope, got.result.Body, got.err)
				}
				if after := f.geoApplyEffects(t); after != before {
					t.Fatalf("rejected Apply changed participation/delivery/coverage effects: before=%s after=%s", before, after)
				}
			} else {
				if got.err != nil || got.result.Replayed {
					t.Fatalf("Apply must accept committed scope %s, not old scope %s: %v", tc.newScope, tc.oldScope, got.err)
				}
				f.assertSingleEffects(t)
			}
		})
	}
}
