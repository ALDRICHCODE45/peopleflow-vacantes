//go:build integration

package draftstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancymanagement"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestLifecycleConfigurationWritesWhilePausedOrClosedActive(t *testing.T) {
	pool := requireDraftPool(t)
	for _, state := range []string{"paused", "closed active"} {
		t.Run(state, func(t *testing.T) {
			for _, resource := range lifecycleConfigResources() {
				t.Run(resource.name, func(t *testing.T) {
					s, p, id, current := lifecycleFixture(t, pool, state)
					assertLifecycleConfigActiveState(t, current, state)
					ctx := context.Background()
					before, err := resource.get(s, ctx, p.companyID, p.ownerID, id)
					if err != nil {
						t.Fatal(err)
					}
					body, valid := lifecycleConfigProposal(t, resource.name, before)
					version := strconv.FormatInt(lifecycleConfigNextVersion(t, before), 10)
					unaffected := lifecycleConfigEffects(t, pool, p, id, resource.name, resource.event, version, "")
					var historyBefore string
					if err = pool.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(e) ORDER BY lifecycle_version)::text FROM vacancy_lifecycle_events e WHERE process_id=$1`, id).Scan(&historyBefore); err != nil {
						t.Fatal(err)
					}
					got, err := resource.put(s, ctx, p.companyID, p.ownerID, id, before.ETag, true, body)
					if err != nil {
						t.Fatal("active hidden configuration write rejected", err)
					}
					assertLifecycleConfigPersisted(t, s, p, id, resource, before, got, valid)
					if after := lifecycleConfigEffects(t, pool, p, id, resource.name, resource.event, version, ""); after != unaffected {
						t.Fatalf("configuration wrote unrelated effects: before=%s after=%s", unaffected, after)
					}
					after, err := s.GetLifecycle(ctx, p.companyID, p.ownerID, id)
					if err != nil || !reflect.DeepEqual(current, after) {
						t.Fatalf("configuration changed lifecycle: before=%s after=%s error=%v", current.Body, after.Body, err)
					}
					var historyAfter string
					if err = pool.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(e) ORDER BY lifecycle_version)::text FROM vacancy_lifecycle_events e WHERE process_id=$1`, id).Scan(&historyAfter); err != nil || historyAfter != historyBefore {
						t.Fatal("configuration changed lifecycle history", err)
					}
				})
			}
			t.Run("pipeline preview", func(t *testing.T) {
				s, p, id, current := lifecycleFixture(t, pool, state)
				assertLifecycleConfigActiveState(t, current, state)
				ctx := context.Background()
				before, err := s.GetPipeline(ctx, p.companyID, p.ownerID, id)
				if err != nil {
					t.Fatal(err)
				}
				want := pipelineConfigOf(t, before.Body)
				want.Stages[1].Name = "Lifecycle preview"
				snapshot := lifecycleSnapshot(t, pool, id)
				preview, err := s.PreviewPipeline(ctx, p.companyID, p.ownerID, id, pipelineWriteBody(t, want))
				if err != nil || !reflect.DeepEqual(preview.Stages, want.Stages) || preview.HasImpact || len(preview.NotApplicable) != 0 || len(preview.RecoveryReassigned) != 0 {
					t.Fatalf("hidden active preview: %+v %v", preview, err)
				}
				after, err := s.GetPipeline(ctx, p.companyID, p.ownerID, id)
				if err != nil || !reflect.DeepEqual(before, after) || snapshot != lifecycleSnapshot(t, pool, id) {
					t.Fatal("preview mutated configuration/version/ETag or persisted effects", err)
				}
				after, err = s.GetLifecycle(ctx, p.companyID, p.ownerID, id)
				if err != nil || !reflect.DeepEqual(current, after) {
					t.Fatal("preview changed lifecycle", err)
				}
				raw, err := json.Marshal(preview)
				if err != nil {
					t.Fatal(err)
				}
				var wire map[string]json.RawMessage
				if err = json.Unmarshal(raw, &wire); err != nil {
					t.Fatal(err)
				}
				if len(wire) != 4 || wire["lifecycle"] != nil || wire["version"] != nil {
					t.Fatal("preview gained write/read-only keys", string(raw))
				}
			})
		})
	}
}

func assertLifecycleConfigActiveState(t *testing.T, current drafts.Result, state string) {
	t.Helper()
	publication := state
	if state == "closed active" {
		publication = "closed"
	}
	view := lifecycleViewOf(t, current)
	if view.Publication == nil || *view.Publication != publication || view.Process == nil || *view.Process != "active" {
		t.Fatalf("expected %s/active fixture, got %s", publication, current.Body)
	}
}

type lifecycleConfigResource struct {
	name, event, versionSQL string
	get                     func(*Store, context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (drafts.Result, error)
	put                     func(*Store, context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, bool, []byte) (drafts.Result, error)
	etag                    func(uuid.UUID, int64) string
}

func lifecycleConfigResources() []lifecycleConfigResource {
	return []lifecycleConfigResource{
		{"pipeline", pipelineConfiguredEvent, `SELECT version FROM job_draft_pipeline_configs WHERE draft_id=$1`, (*Store).GetPipeline, (*Store).PutPipeline, pipelineconfig.ETag},
		{"substates", substatesConfiguredEvent, `SELECT version FROM job_draft_substate_catalogs WHERE draft_id=$1`, (*Store).GetSubstates, (*Store).PutSubstates, substatecatalog.ETag},
		{"delivery", deliveryConfiguredEvent, `SELECT version FROM job_draft_delivery_configs WHERE draft_id=$1`, (*Store).GetDelivery, (*Store).PutDelivery, deliveryconfig.ETag},
		{"management", managementConfiguredEvent, `SELECT version FROM job_draft_management_configs WHERE draft_id=$1`, (*Store).GetManagement, (*Store).PutManagement, vacancymanagement.ETag},
	}
}

// Every proposal is changing, complete, and valid for the ready-publication
// fixture. In particular delivery retains its cutoff/date and cannot fulfill.
func lifecycleConfigProposal(t *testing.T, name string, before drafts.Result) ([]byte, func([]byte) bool) {
	t.Helper()
	switch name {
	case "pipeline":
		want := pipelineConfigOf(t, before.Body)
		want.Stages[1].Name = "Lifecycle review"
		return pipelineWriteBody(t, want), func(raw []byte) bool { return pipelineConfigOf(t, raw).Equal(want) }
	case "substates":
		return []byte(`{"substates":[{"name":"Lifecycle review"}]}`), func(raw []byte) bool {
			got := substateCatalogOf(t, raw)
			if len(got.Substates) != 1 || got.Substates[0].Name != "Lifecycle review" {
				return false
			}
			id, err := uuid.Parse(got.Substates[0].ID)
			return err == nil && id != uuid.Nil
		}
	case "delivery":
		want := deliveryOf(t, before.Body)
		target := int64(6)
		want.TargetQuantity = &target
		return deliveryBody(t, want), func(raw []byte) bool { return deliveryOf(t, raw).Equal(want) }
	case "management":
		var want vacancymanagement.Configuration
		if err := json.Unmarshal(before.Body, &want); err != nil {
			t.Fatal(err)
		}
		headcount := int64(3)
		want.HiringHeadcount = &headcount
		body, err := json.Marshal(want)
		if err != nil {
			t.Fatal(err)
		}
		return body, func(raw []byte) bool {
			var got vacancymanagement.Configuration
			if err := json.Unmarshal(raw, &got); err != nil {
				t.Fatal(err)
			}
			return got.Equal(want)
		}
	default:
		t.Fatalf("unknown resource %q", name)
		return nil, nil
	}
}

func lifecycleConfigNextVersion(t *testing.T, before drafts.Result) int64 {
	t.Helper()
	var root struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(before.Body, &root); err != nil {
		t.Fatal(err)
	}
	version, err := strconv.ParseInt(root.Version, 10, 64)
	if err != nil || version < 0 {
		t.Fatal("invalid initial version", root.Version, err)
	}
	return version + 1
}

func assertLifecycleConfigPersisted(t *testing.T, s *Store, p principal, id uuid.UUID, r lifecycleConfigResource, before, result drafts.Result, valid func([]byte) bool) {
	t.Helper()
	next := lifecycleConfigNextVersion(t, before)
	wantTag := r.etag(id, next)
	stored, err := r.get(s, context.Background(), p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal("read persisted configuration", err)
	}
	for _, got := range []drafts.Result{result, stored} {
		var root map[string]json.RawMessage
		if err = json.Unmarshal(got.Body, &root); err != nil {
			t.Fatal(err)
		}
		if got.ETag != wantTag || got.ETag == before.ETag || string(root["version"]) != strconv.Quote(strconv.FormatInt(next, 10)) || got.Replayed || !valid(got.Body) {
			t.Fatalf("configuration did not advance/persist: tag=%s body=%s", got.ETag, got.Body)
		}
	}
	if r.name == "substates" && !substateCatalogOf(t, result.Body).Equal(substateCatalogOf(t, stored.Body)) {
		t.Fatal("generated substate IDs did not persist")
	}
	var persistedVersion int64
	if err = s.pool.QueryRow(context.Background(), r.versionSQL, id).Scan(&persistedVersion); err != nil || persistedVersion != next {
		t.Fatal("stored version", persistedVersion, err)
	}
	var audits int
	if err = s.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type=$2 AND actor_id=$3 AND metadata->>'version'=$4`, id, r.event, p.ownerID, strconv.FormatInt(next, 10)).Scan(&audits); err != nil || audits != 1 {
		t.Fatal("expected exactly one configuration audit", audits, err)
	}
	// GET pipeline alone embeds lifecycle. No write response gains that key.
	var root map[string]json.RawMessage
	if err = json.Unmarshal(result.Body, &root); err != nil {
		t.Fatal(err)
	}
	if _, present := root["lifecycle"]; present {
		t.Fatal("write response leaked lifecycle")
	}
}

// Snapshot everything except the deliberately changed config row/new audit and
// the single expected finish transition. All other rows remain byte-for-byte
// comparable, including previous lifecycle events and prior audit/idempotency.
// Passing empty exclusions checks that a rejected configuration wrote nothing.
func lifecycleConfigEffects(t *testing.T, pool *pgxpool.Pool, p principal, id uuid.UUID, resource, event, version, finishKey string) string {
	t.Helper()
	var raw string
	err := pool.QueryRow(context.Background(), `SELECT jsonb_build_object(
 'draft',(SELECT to_jsonb(d) FROM job_drafts d WHERE id=$1),
 'pipeline',CASE WHEN $3::text='pipeline' THEN NULL ELSE (SELECT to_jsonb(c) FROM job_draft_pipeline_configs c WHERE draft_id=$1) END,
 'substates',CASE WHEN $3::text='substates' THEN NULL ELSE (SELECT to_jsonb(c) FROM job_draft_substate_catalogs c WHERE draft_id=$1) END,
 'delivery',CASE WHEN $3::text='delivery' THEN NULL ELSE (SELECT to_jsonb(c) FROM job_draft_delivery_configs c WHERE draft_id=$1) END,
 'management',CASE WHEN $3::text='management' THEN NULL ELSE (SELECT to_jsonb(c) FROM job_draft_management_configs c WHERE draft_id=$1) END,
 'projection',(SELECT to_jsonb(v) FROM vacancy_public_projections v WHERE id=$1),
 'process_identity',(SELECT to_jsonb(v)-ARRAY['status','process_status','lifecycle_version','published_at','paused_at','closed_at','process_finished_at'] FROM vacancy_processes v WHERE id=$1),
 'participations',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM process_participations v WHERE process_id=$1),
 'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM participation_stage_history h JOIN process_participations v ON v.id=h.participation_id WHERE v.process_id=$1),
 'coverage',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM process_coverage_milestones v WHERE process_id=$1),
 'fulfillment',(SELECT to_jsonb(v) FROM process_delivery_fulfillments v WHERE process_id=$1),
 'lifecycle_history',(SELECT jsonb_agg(to_jsonb(v) ORDER BY lifecycle_version) FROM vacancy_lifecycle_events v WHERE process_id=$1 AND action<>'finish_process'),
 'idempotency',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM job_draft_idempotency v WHERE company_id=$2 AND NOT (operation='vacancy-lifecycle:r1' AND idem_key=$6)),
 'audits',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM audit_events v WHERE (entity_id=$1 OR metadata->>'vacancy_id'=$1::text) AND event_type<>'VacancyProcessFinished' AND NOT (event_type=$4 AND metadata->>'version'=$5))
 )::text`, id, p.companyID, resource, event, version, finishKey).Scan(&raw)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// Like applications' movement race tests, use one identifiable backend per
// operation. pg_blocking_pids, not sleeps or scheduler timing, orders writers.
func lifecycleConfigOperationPool(t *testing.T, ctx context.Context, base *pgxpool.Pool) (*pgxpool.Pool, int) {
	t.Helper()
	config := base.Config()
	config.MaxConns, config.MinConns = 1, 0
	config.ConnConfig.RuntimeParams["application_name"] = "lifecycle-config-test-" + uuid.NewString()
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	var pid int
	if err = pool.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&pid); err != nil {
		t.Fatal(err)
	}
	return pool, pid
}

func waitLifecycleConfigBlockedBy(t *testing.T, ctx context.Context, pool *pgxpool.Pool, waiter, blocker int) {
	t.Helper()
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	for {
		var blocked bool
		if err := pool.QueryRow(ctx, `SELECT $2::int=ANY(pg_blocking_pids($1))`, waiter, blocker).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("expected configuration/finish lock ordering not observed", ctx.Err())
		case <-tick.C:
		}
	}
}

func assertLifecycleConfigFinishedConflict(t *testing.T, result drafts.Result, err error, current drafts.Result) {
	t.Helper()
	var finished *lifecycle.ProcessFinished
	if !errors.As(err, &finished) || !reflect.DeepEqual(result, drafts.Result{}) {
		t.Fatal("expected process_finished without a partial result", result, err)
	}
	if !reflect.DeepEqual(finished.Lifecycle, lifecycleViewOf(t, current)) {
		t.Fatal("conflict carried a stale lifecycle", finished.Lifecycle, string(current.Body))
	}
	response := httptest.NewRecorder()
	httpjson.WriteLifecycleError(response, httpjson.Resolve(httpjson.CodeProcessFinished), finished)
	var wire map[string]json.RawMessage
	if err = json.Unmarshal(response.Body.Bytes(), &wire); err != nil {
		t.Fatal(err)
	}
	var data struct {
		Lifecycle json.RawMessage `json:"lifecycle"`
	}
	if err = json.Unmarshal(wire["data"], &data); err != nil {
		t.Fatal(err)
	}
	if response.Code != 409 || len(wire) != 3 || string(wire["code"]) != `"process_finished"` || !bytes.Equal(data.Lifecycle, current.Body) {
		t.Fatalf("finished conflict wire: %d %s", response.Code, response.Body.String())
	}
}
