//go:build integration

package v2

import (
	"context"
	"errors"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestGeoApplyCountryRejectionPreservesPopulatedDeliveryAndCoverage(t *testing.T) {
	m := setupMovement(t)
	seedApplyGeo(t, m.fixture)
	readyMovementConfiguration(t, m)
	ctx := context.Background()
	if _, err := m.pool.Exec(ctx, `UPDATE job_draft_delivery_configs SET target_quantity=1 WHERE draft_id=$1`, m.vacancy); err != nil {
		t.Fatal(err)
	}
	stages := pipelineconfig.Defaults(m.vacancy).Stages
	for _, stage := range stages[1:] {
		moved, err := m.move(t, m.item, stage.ID, false)
		if err != nil {
			t.Fatal(err)
		}
		m.item = moved.Item
	}
	view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil || view.Delivery.State != "fulfilled" || view.Delivery.Delivered != 1 || view.Coverage.Covered != 1 || view.Coverage.FullCoverageReachedAt == nil {
		t.Fatal("delivery/coverage fixture is vacuous", view, err)
	}
	if _, err = m.pool.Exec(ctx, `UPDATE vacancy_public_projections SET remote_scope_kind='countries',remote_countries=ARRAY['CO']::char(2)[] WHERE id=$1`, m.vacancy); err != nil {
		t.Fatal(err)
	}
	cv, err := m.library.Upload(ctx, m.other, "Other CV", "cv.pdf", []byte("%PDF-1"))
	if err != nil {
		t.Fatal(err)
	}
	var other uuid.UUID
	if err = m.pool.QueryRow(ctx, `SELECT id FROM users WHERE cognito_sub=$1`, m.other).Scan(&other); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := m.pool.Exec(context.Background(), `DELETE FROM candidate_profiles WHERE user_id=$1`, other); err != nil {
			t.Error(err)
		}
	})
	for _, want := range []error{app.ErrApplicantCountryRequired, app.ErrApplicantCountryNotAllowed} {
		if want == app.ErrApplicantCountryNotAllowed {
			if _, err = m.pool.Exec(ctx, `INSERT INTO candidate_profiles(user_id,country_code) VALUES($1,'US')`, other); err != nil {
				t.Fatal(err)
			}
		}
		before := m.geoApplyEffects(t)
		if _, err = m.store.Apply(ctx, m.other, m.vacancy, uuid.New(), m.request(cv.ID)); !errors.Is(err, want) {
			t.Fatal(err)
		}
		if after := m.geoApplyEffects(t); after != before {
			t.Fatalf("country rejection changed populated delivery/coverage: before=%s after=%s", before, after)
		}
	}
}

// Extend the intake effects allowlist with both computed counters and complete
// stored delivery/coverage rows. Counts alone miss changes to existing rows.
func (f fixture) geoApplyEffects(t *testing.T) string {
	t.Helper()
	var snapshot string
	err := f.pool.QueryRow(context.Background(), `SELECT jsonb_build_object(
 'intake',$3::jsonb,
 'delivered',(SELECT count(DISTINCT p.id) FROM process_participations p
   JOIN participation_stage_history h ON h.participation_id=p.id
   JOIN job_draft_delivery_configs c ON c.draft_id=p.process_id AND c.cutoff_stage_id=h.stage_id
   WHERE p.process_id=$1 AND h.event_kind IN ('intake','move','recovery')),
 'covered',(SELECT count(*) FROM process_participations WHERE process_id=$1 AND stage_id=$2::uuid),
 'delivery_config',(SELECT to_jsonb(c) FROM job_draft_delivery_configs c WHERE c.draft_id=$1),
 'management_config',(SELECT to_jsonb(c) FROM job_draft_management_configs c WHERE c.draft_id=$1),
 'fulfillment',(SELECT to_jsonb(f) FROM process_delivery_fulfillments f WHERE f.process_id=$1),
 'coverage_milestones',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM process_coverage_milestones m WHERE m.process_id=$1),'[]'::jsonb),
 'fulfillment_audits',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM audit_events a WHERE a.entity_id=$1 AND a.event_type='VacancyDeliveryFulfilled'),'[]'::jsonb)
 )::text`, f.vacancy, pipelineconfig.Defaults(f.vacancy).Stages[4].ID, f.effects(t)).Scan(&snapshot)
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}
