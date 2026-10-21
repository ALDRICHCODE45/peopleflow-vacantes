//go:build integration

package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestPublicationStoredPipelineAndSubstatesRetainVersionsAndFrozenNames(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, draft := readyPublication(t, pool)
	ctx := context.Background()
	id := draftIDOf(t, draft)
	config := pipelineconfig.Defaults(id)
	config.Stages[3].Name = "Entrevistas"
	if _, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, pipelineconfig.ETag(id, 0), true, pipelineWriteBody(t, config)); err != nil {
		t.Fatal(err)
	}
	sub, err := s.GetSubstates(ctx, p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.PutSubstates(ctx, p.companyID, p.ownerID, id, sub.ETag, true, []byte(`{"substates":[{"name":"Primera"}]}`)); err != nil {
		t.Fatal(err)
	}
	reads := []func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (drafts.Result, error){s.GetV2, s.GetPipeline, s.GetSubstates, s.GetDelivery, s.GetManagement}
	before := make([]drafts.Result, len(reads))
	for i, read := range reads {
		before[i], err = read(ctx, p.companyID, p.ownerID, id)
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Publish(ctx, p.companyID, p.ownerID, id, uuid.NewString(), true, draft.ETag, true, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	for i, read := range reads {
		after, err := read(ctx, p.companyID, p.ownerID, id)
		if err != nil {
			t.Fatalf("read resource %d after publication: %v", i, err)
		}
		assertPublicationResourceUnchanged(t, before[i], after, i < 2)
	}
	var raw []byte
	if err := pool.QueryRow(ctx, `SELECT metadata FROM audit_events WHERE entity_id=$1 AND event_type='VacancyPublished'`, id).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var meta map[string]string
	_ = json.Unmarshal(raw, &meta)
	var snapshot map[string]any
	_ = json.Unmarshal([]byte(meta["snapshot"]), &snapshot)
	if snapshot["cutoffStageName"] != "Entrevistas" {
		t.Fatalf("snapshot=%s", raw)
	}
	// Later renaming cannot rewrite the publication snapshot.
	config.Stages[3].Name = "Otra"
	if _, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, before[1].ETag, true, pipelineWriteBody(t, config)); err != nil {
		t.Fatal(err)
	}
	var after []byte
	if err := pool.QueryRow(ctx, `SELECT metadata FROM audit_events WHERE entity_id=$1 AND event_type='VacancyPublished'`, id).Scan(&after); err != nil || string(after) != string(raw) {
		t.Fatal("snapshot was not frozen")
	}
}
func TestPublicationIdempotencyNamespaceAddressAndLiveAuthorization(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, draft := readyPublication(t, pool)
	ctx := context.Background()
	id := draftIDOf(t, draft)
	key := uuid.NewString()
	// A create using the same key occupies another operation namespace.
	second := createV2(t, s, p, key, []byte(`{"fields":{}}`))
	otherID := draftIDOf(t, second)
	if _, err := s.Publish(ctx, p.companyID, p.ownerID, id, key, true, draft.ETag, true, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	before := publicationSnapshot(t, pool, otherID)
	got, err := s.Publish(ctx, p.companyID, p.ownerID, otherID, key, true, "", false, []byte(`{}`))
	if !errors.Is(err, drafts.ErrIdempotencyConflict) || !reflect.DeepEqual(got, drafts.Result{}) || before != publicationSnapshot(t, pool, otherID) {
		t.Fatalf("same key different path=%+v %v", got, err)
	}
	// Re-authorize before replay: owning the key does not bypass a revoked gate.
	if _, err := pool.Exec(ctx, `UPDATE companies SET status='suspended' WHERE id=$1`, p.companyID); err != nil {
		t.Fatal(err)
	}
	before = publicationSnapshot(t, pool, id)
	got, err = s.Publish(ctx, p.companyID, p.ownerID, id, key, true, "", false, []byte(`{}`))
	if !errors.Is(err, drafts.ErrCompanyNotActive) || !reflect.DeepEqual(got, drafts.Result{}) || before != publicationSnapshot(t, pool, id) {
		t.Fatalf("gate before replay=%+v %v", got, err)
	}
}
func TestPublicationUnknownFingerprintAlgorithmFailsClosed(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, draft := readyPublication(t, pool)
	ctx := context.Background()
	id := draftIDOf(t, draft)
	key := uuid.NewString()
	if _, err := s.Publish(ctx, p.companyID, p.ownerID, id, key, true, draft.ETag, true, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE job_draft_idempotency SET fingerprint_algorithm='future-unknown' WHERE company_id=$1 AND operation=$2 AND idem_key=$3`, p.companyID, publishOperation, key); err != nil {
		t.Fatal(err)
	}
	before := publicationSnapshot(t, pool, id)
	got, err := s.Publish(ctx, p.companyID, p.ownerID, id, key, true, "", false, []byte(`{}`))
	if !errors.Is(err, ErrUnknownFingerprintAlgorithm) || !reflect.DeepEqual(got, drafts.Result{}) || before != publicationSnapshot(t, pool, id) {
		t.Fatalf("unknown algorithm=%+v %v", got, err)
	}
}
