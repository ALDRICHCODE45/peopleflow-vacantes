//go:build integration

package draftstore

import (
	"bytes"
	"context"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	"github.com/google/uuid"
)

func TestLifecycleConfigurationVersusFinishProcessBothLockOrders(t *testing.T) {
	pool := requireDraftPool(t)
	for _, resource := range lifecycleConfigResources() {
		t.Run(resource.name, func(t *testing.T) {
			for _, first := range []string{"finish", "configuration"} {
				t.Run(first+" first", func(t *testing.T) {
					s, p, id, current := lifecycleFixture(t, pool, "closed active")
					assertLifecycleConfigActiveState(t, current, "closed active")
					ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
					defer cancel()
					before, err := resource.get(s, ctx, p.companyID, p.ownerID, id)
					if err != nil {
						t.Fatal(err)
					}
					body, valid := lifecycleConfigProposal(t, resource.name, before)
					finishKey := uuid.NewString()
					ignoreResource, ignoreEvent, ignoreVersion := "", "", ""
					if first == "configuration" {
						ignoreResource, ignoreEvent = resource.name, resource.event
						ignoreVersion = strconv.FormatInt(lifecycleConfigNextVersion(t, before), 10)
					}
					effectsBefore := lifecycleConfigEffects(t, pool, p, id, ignoreResource, ignoreEvent, ignoreVersion, finishKey)
					configPool, configPID := lifecycleConfigOperationPool(t, ctx, pool)
					finishPool, finishPID := lifecycleConfigOperationPool(t, ctx, pool)
					writer, finisher := newStore(t, configPool), newStore(t, finishPool)
					writer.clock, finisher.clock = fixedDeliveryClock, fixedDeliveryClock
					blocker, err := pool.Begin(ctx)
					if err != nil {
						t.Fatal(err)
					}
					defer blocker.Rollback(context.Background())
					var blockerPID int
					if err = blocker.QueryRow(ctx, `SELECT pg_backend_pid() FROM job_drafts WHERE id=$1 FOR UPDATE`, id).Scan(&blockerPID); err != nil {
						t.Fatal(err)
					}
					type outcome struct {
						result drafts.Result
						err    error
					}
					configDone, finishDone := make(chan outcome, 1), make(chan outcome, 1)
					startConfig := func() {
						go func() {
							result, err := resource.put(writer, ctx, p.companyID, p.ownerID, id, before.ETag, true, body)
							configDone <- outcome{result, err}
						}()
					}
					startFinish := func() {
						go func() {
							result, err := finisher.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, "finish_process", finishKey, true, current.ETag, true, []byte(`{}`))
							finishDone <- outcome{result, err}
						}()
					}
					if first == "finish" {
						startFinish()
						waitLifecycleConfigBlockedBy(t, ctx, pool, finishPID, blockerPID)
						startConfig()
						waitLifecycleConfigBlockedBy(t, ctx, pool, configPID, finishPID)
					} else {
						startConfig()
						waitLifecycleConfigBlockedBy(t, ctx, pool, configPID, blockerPID)
						startFinish()
						waitLifecycleConfigBlockedBy(t, ctx, pool, finishPID, configPID)
					}
					if err = blocker.Commit(ctx); err != nil {
						t.Fatal(err)
					}
					var finished, configured outcome
					select {
					case finished = <-finishDone:
					case <-ctx.Done():
						t.Fatal("finish_process did not complete", ctx.Err())
					}
					select {
					case configured = <-configDone:
					case <-ctx.Done():
						t.Fatal("configuration did not complete", ctx.Err())
					}
					if finished.err != nil || finished.result.Replayed {
						t.Fatal("real finish_process failed", finished.err)
					}
					storedLifecycle, err := s.GetLifecycle(ctx, p.companyID, p.ownerID, id)
					if err != nil || !reflect.DeepEqual(storedLifecycle, finished.result) {
						t.Fatal("finish response was not persisted", err)
					}
					want, err := lifecycle.Transition(lifecycleViewOf(t, current), "finish_process", "", fixedDeliveryClock())
					if err != nil || !reflect.DeepEqual(lifecycleViewOf(t, storedLifecycle), want) {
						t.Fatal("wrong final lifecycle", string(storedLifecycle.Body), err)
					}
					version, err := strconv.ParseInt(want.Version, 10, 64)
					if err != nil || storedLifecycle.ETag != lifecycle.ETag(id, version) {
						t.Fatal("finish ETag/version", storedLifecycle.ETag, err)
					}
					if first == "finish" {
						assertLifecycleConfigFinishedConflict(t, configured.result, configured.err, storedLifecycle)
					} else {
						if configured.err != nil {
							t.Fatal("configuration acquired lock first but did not commit", configured.err)
						}
						assertLifecycleConfigPersisted(t, s, p, id, resource, before, configured.result, valid)
					}
					if effectsAfter := lifecycleConfigEffects(t, pool, p, id, ignoreResource, ignoreEvent, ignoreVersion, finishKey); effectsAfter != effectsBefore {
						t.Fatalf("unexpected persisted effects (%s first): before=%s after=%s", first, effectsBefore, effectsAfter)
					}
					// Only the real finish adds lifecycle history, its audit and the scoped
					// idempotency response. Rejected configuration cannot add an audit or row.
					var history, audits int
					if err = pool.QueryRow(ctx, `SELECT
      (SELECT count(*) FROM vacancy_lifecycle_events WHERE process_id=$1 AND action='finish_process'),
      (SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='VacancyProcessFinished')`, id).Scan(&history, &audits); err != nil || history != 1 || audits != 1 {
						t.Fatal("finish effects must occur exactly once", history, audits, err)
					}
					var cachedBody []byte
					var cachedTag string
					if err = pool.QueryRow(ctx, `SELECT response_body,response_etag FROM job_draft_idempotency WHERE company_id=$1 AND actor_id=$2 AND operation='vacancy-lifecycle:r1' AND idem_key=$3`, p.companyID, p.ownerID, finishKey).Scan(&cachedBody, &cachedTag); err != nil || !bytes.Equal(cachedBody, finished.result.Body) || cachedTag != finished.result.ETag {
						t.Fatal("finish response not atomically cached", err)
					}
				})
			}
		})
	}
}
