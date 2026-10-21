//go:build integration

package draftstore

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
)

// Fixtures and side-effect snapshots use SQL because there is no public
// audit/idempotency counter. Behavior is exercised through public capabilities.
func createV2Body(t *testing.T) []byte {
	t.Helper()
	doc := envelopeOf(t, []byte(readV2Document))
	return mustCanonical(t, map[string]any{"fields": doc["fields"]})
}

func createV2(t *testing.T, s drafts.V2Writer, p principal, key string, body []byte) drafts.Result {
	t.Helper()
	got, err := s.CreateV2(context.Background(), p.companyID, p.ownerID, key, body)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func TestCreateV2_PersistsAndIsolates(t *testing.T) {
	pool := requireDraftPool(t)
	p := newPrincipal(t, pool)
	s := newStore(t, pool)
	body := createV2Body(t)
	input, err := draftinput.DecodeCreateV2(body)
	if err != nil {
		t.Fatal(err)
	}
	got := createV2(t, s, p, uuid.NewString(), body)
	if got.Replayed || !strings.HasPrefix(got.ETag, `"jd-r2-`) {
		t.Fatalf("create result: %+v", got)
	}
	id := draftIDOf(t, got)
	doc := envelopeOf(t, got.Body)
	if doc["schema_version"] != int64(2) || doc["version"] != "1" {
		t.Fatalf("envelope: %s", got.Body)
	}
	questions := doc["fields"].(map[string]any)["screening_questions"]
	want := envelopeOf(t, input.Fingerprint())["fields"].(map[string]any)["screening_questions"]
	if !bytes.Equal(mustCanonical(t, questions), mustCanonical(t, want)) {
		t.Fatal("private questions changed")
	}
	var stored []byte
	if err := pool.QueryRow(context.Background(), `SELECT fields FROM job_drafts WHERE id=$1`, id).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(stored, input.Fingerprint()) {
		t.Fatalf("stored canonical bytes differ: %s", stored)
	}
	if n := auditCount(t, pool, id, entities.EventJobDraftCreated); n != 1 {
		t.Fatalf("audit count %d", n)
	}
	before := readV2Snapshot(t, pool, p)
	read, err := s.GetV2(context.Background(), p.companyID, p.ownerID, id)
	if err != nil || !bytes.Equal(withoutLifecycle(t, read.Body), got.Body) || read.ETag != got.ETag {
		t.Fatalf("GetV2: %+v %v", read, err)
	}
	hidden, err := s.Get(context.Background(), p.companyID, p.ownerID, id)
	if !errors.Is(err, drafts.ErrNotFound) || len(hidden.Body) != 0 || hidden.ETag != "" {
		t.Fatalf("v1 isolation: %+v %v", hidden, err)
	}
	if readV2Snapshot(t, pool, p) != before {
		t.Fatal("reads mutated storage")
	}
}

func TestCreateV2_ReplayAndNamespace(t *testing.T) {
	pool := requireDraftPool(t)
	p := newPrincipal(t, pool)
	s := newStore(t, pool)
	key := uuid.NewString()
	v1 := create(t, s, p, key, minimalCreateBody())
	first := createV2(t, s, p, key, minimalCreateBody())
	if draftIDOf(t, first) == draftIDOf(t, v1) {
		t.Fatal("versions shared draft")
	}
	before := readV2Snapshot(t, pool, p)
	replay := createV2(t, s, p, strings.ToUpper(key), []byte(`{"fields":{"professional_area":"technology_systems","title":"  Backend Go  "}}`))
	if !replay.Replayed || replay.ETag != first.ETag || !bytes.Equal(replay.Body, first.Body) {
		t.Fatalf("frozen replay differs: %+v", replay)
	}
	got, err := s.CreateV2(context.Background(), p.companyID, p.ownerID, key, []byte(`{"fields":{"title":"Other","professional_area":"technology_systems"}}`))
	if !errors.Is(err, drafts.ErrIdempotencyConflict) || got.ETag != "" || len(got.Body) != 0 || got.Replayed {
		t.Fatalf("conflict: %+v %v", got, err)
	}
	if readV2Snapshot(t, pool, p) != before {
		t.Fatal("replay/conflict mutated storage")
	}
	v1Replay := create(t, s, p, key, minimalCreateBody())
	if !v1Replay.Replayed || !bytes.Equal(v1Replay.Body, v1.Body) || v1Replay.ETag != v1.ETag {
		t.Fatal("v1 replay changed")
	}
	if _, err := pool.Exec(context.Background(), `UPDATE job_draft_idempotency SET fingerprint_algorithm='unknown' WHERE company_id=$1 AND operation='create:v2'`, p.companyID); err != nil {
		t.Fatal(err)
	}
	before = readV2Snapshot(t, pool, p)
	got, err = s.CreateV2(context.Background(), p.companyID, p.ownerID, key, minimalCreateBody())
	if err == nil || errors.Is(err, drafts.ErrIdempotencyConflict) || len(got.Body) != 0 || got.ETag != "" || got.Replayed {
		t.Fatalf("unknown algorithm: %+v %v", got, err)
	}
	if readV2Snapshot(t, pool, p) != before {
		t.Fatal("unknown algorithm mutated storage")
	}
}

func TestCreateV2_InputAndGates(t *testing.T) {
	pool := requireDraftPool(t)
	for _, tc := range []struct {
		name, key string
		body      []byte
		want      error
	}{
		{"missing_key", "", minimalCreateBody(), drafts.ErrIdempotencyKeyRequired},
		{"invalid_key", "bad", minimalCreateBody(), drafts.ErrInvalidIdempotencyKey},
		{"structural", uuid.NewString(), []byte(`{"fields":{},"schema_version":2}`), drafts.ErrInvalidRequest},
		{"value", uuid.NewString(), []byte(`{"fields":{"title":42}}`), drafts.ErrValidation},
		{"oversized", uuid.NewString(), bytes.Repeat([]byte(" "), draftinput.MaxBodyBytes+1), drafts.ErrPayloadTooLarge},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := newPrincipal(t, pool)
			s := newStore(t, pool)
			before := readV2Snapshot(t, pool, p)
			got, err := s.CreateV2(context.Background(), p.companyID, p.ownerID, tc.key, tc.body)
			if !errors.Is(err, tc.want) || len(got.Body) != 0 || got.ETag != "" || got.Replayed {
				t.Fatalf("got %+v %v want %v", got, err, tc.want)
			}
			if readV2Snapshot(t, pool, p) != before {
				t.Fatal("rejected input mutated storage")
			}
		})
	}
	p := newPrincipal(t, pool)
	s := newStore(t, pool)
	before := readV2Snapshot(t, pool, p)
	outsider := newPrincipal(t, pool)
	got, err := s.CreateV2(context.Background(), p.companyID, outsider.ownerID, uuid.NewString(), []byte(`bad json`))
	if !errors.Is(err, drafts.ErrForbidden) || len(got.Body) != 0 || got.ETag != "" || got.Replayed {
		t.Fatalf("gates must precede decode: %+v %v", got, err)
	}
	if readV2Snapshot(t, pool, p) != before {
		t.Fatal("gate rejection mutated storage")
	}
}

func TestCreateV2_ReplayAuthorizationAndSchema(t *testing.T) {
	pool := requireDraftPool(t)
	for _, kind := range []string{"unauthorized", "v1", "corrupt"} {
		t.Run(kind, func(t *testing.T) {
			p := newPrincipal(t, pool)
			s := newStore(t, pool)
			key := uuid.NewString()
			first := createV2(t, s, p, key, minimalCreateBody())
			id := draftIDOf(t, first)
			if kind == "unauthorized" {
				if _, err := pool.Exec(context.Background(), `UPDATE company_members SET role='recruiter' WHERE company_id=$1 AND user_id=$2`, p.companyID, p.ownerID); err != nil {
					t.Fatal(err)
				}
				member := addMember(t, pool, p.companyID, "recruiter")
				if _, err := pool.Exec(context.Background(), `UPDATE job_drafts SET principal_recruiter_id=$1 WHERE id=$2`, member, id); err != nil {
					t.Fatal(err)
				}
			} else {
				document := []byte(`{"schema_version":2,"fields":{}}`)
				if kind == "v1" {
					v1, err := draftinput.DecodeCreate(minimalCreateBody())
					if err != nil {
						t.Fatal(err)
					}
					document = v1.Fingerprint()
				}
				if _, err := pool.Exec(context.Background(), `UPDATE job_drafts SET fields=$1 WHERE id=$2`, document, id); err != nil {
					t.Fatal(err)
				}
			}
			before := readV2Snapshot(t, pool, p)
			for _, body := range [][]byte{minimalCreateBody(), []byte(`{"fields":{"title":"Changed","professional_area":"technology_systems"}}`)} {
				got, err := s.CreateV2(context.Background(), p.companyID, p.ownerID, key, body)
				if err == nil || len(got.Body) != 0 || got.ETag != "" || got.Replayed {
					t.Fatalf("replay rejection: %+v %v", got, err)
				}
				if kind != "corrupt" && !errors.Is(err, drafts.ErrNotFound) {
					t.Fatalf("want hidden row, got %v", err)
				}
				if kind == "corrupt" && (errors.Is(err, drafts.ErrNotFound) || errors.Is(err, drafts.ErrValidation) || errors.Is(err, drafts.ErrInvalidRequest) || errors.Is(err, drafts.ErrIdempotencyConflict)) {
					t.Fatalf("invariant classified as client error: %v", err)
				}
			}
			if readV2Snapshot(t, pool, p) != before {
				t.Fatal("replay rejection mutated storage")
			}
		})
	}
}

func TestCreateV2_AuditRollback(t *testing.T) {
	pool := requireDraftPool(t)
	p := newPrincipal(t, pool)
	s := NewStore(pool, failingAudit{})
	before := readV2Snapshot(t, pool, p)
	got, err := s.CreateV2(context.Background(), p.companyID, p.ownerID, uuid.NewString(), minimalCreateBody())
	if err == nil || !strings.Contains(err.Error(), "forced audit failure") || len(got.Body) != 0 || got.ETag != "" || got.Replayed {
		t.Fatalf("rollback: %+v %v", got, err)
	}
	if readV2Snapshot(t, pool, p) != before {
		t.Fatal("audit failure left writes")
	}
}
