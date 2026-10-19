//go:build integration

package draftstore

import (
	"bytes"
	"context"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftversion"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Behavior goes through the public V2Saver capability. SQL is used only for
// fixture preparation and side-effect/counter inspection, because there is no
// public audit or idempotency counter.
func saveV2(t *testing.T, s drafts.V2Saver, p principal, id uuid.UUID, tag string, present bool, body []byte) drafts.Result {
	t.Helper()
	got, err := s.SaveV2(context.Background(), p.companyID, p.ownerID, id, tag, present, body)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func ifMatchV2For(t *testing.T, id uuid.UUID, version int64) string {
	t.Helper()
	tag, err := draftversion.FormatETagV2(id.String(), version)
	if err != nil {
		t.Fatalf("FormatETagV2: %v", err)
	}
	return tag
}

// createV2Draft seeds a canonical schema-2 draft holding the full 17-field
// document (including private evaluated answer keys) through CreateV2.
func createV2Draft(t *testing.T, pool *pgxpool.Pool) (*Store, principal, drafts.Result) {
	t.Helper()
	p := newPrincipal(t, pool)
	s := newStore(t, pool)
	return s, p, createV2(t, s, p, uuid.NewString(), createV2Body(t))
}

// assertSaveV2Reject proves one rejected save: the exact sentinel (or a
// non-client invariant failure when want is nil), a zero Result and an
// unchanged storage snapshot.
func assertSaveV2Reject(t *testing.T, pool *pgxpool.Pool, s drafts.V2Saver, p principal, id uuid.UUID, tag string, present bool, body []byte, want error) {
	t.Helper()
	before := readV2Snapshot(t, pool, p)
	got, err := s.SaveV2(context.Background(), p.companyID, p.ownerID, id, tag, present, body)
	if want != nil {
		if !errors.Is(err, want) {
			t.Fatalf("err=%v want=%v", err, want)
		}
	} else if err == nil || errors.Is(err, drafts.ErrNotFound) || errors.Is(err, drafts.ErrValidation) || errors.Is(err, drafts.ErrInvalidRequest) || errors.Is(err, drafts.ErrVersionConflict) || errors.Is(err, drafts.ErrPreconditionRequired) {
		t.Fatalf("want internal invariant error, got %v", err)
	}
	if got.Body != nil || got.ETag != "" || got.Replayed {
		t.Fatalf("rejection returned a partial result: %+v", got)
	}
	if after := readV2Snapshot(t, pool, p); after != before {
		t.Fatal("rejection changed stored state")
	}
}

func TestSaveV2_ReplacesGroupsAndPreservesOthers(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	original := envelopeOf(t, created.Body)["fields"].(map[string]any)

	got := saveV2(t, s, p, id, ifMatchV2For(t, id, 1), true,
		[]byte(`{"fields":{"title":"Backend Rust","skills":["rust","go"]}}`))
	if got.ETag != ifMatchV2For(t, id, 2) || got.Replayed {
		t.Fatalf("save result: %+v", got)
	}
	doc := envelopeOf(t, got.Body)
	fields := doc["fields"].(map[string]any)
	if doc["schema_version"] != int64(2) || doc["version"] != "2" {
		t.Fatalf("envelope: %s", got.Body)
	}
	if fields["title"] != "Backend Rust" {
		t.Fatalf("title: %#v", fields["title"])
	}
	if skills := fields["skills"].([]any); len(skills) != 2 || skills[0] != "rust" || skills[1] != "go" {
		t.Fatalf("skills must be fully replaced: %#v", fields["skills"])
	}
	// Every original envelope key except the patched groups is preserved,
	// derived description_plain included.
	for key, originalValue := range original {
		if key == "title" || key == "skills" {
			continue
		}
		if !reflect.DeepEqual(fields[key], originalValue) {
			t.Fatalf("unchanged field %s altered: %#v -> %#v", key, originalValue, fields[key])
		}
	}
	// The stored merged document is a canonical schema-2 full-17 document with
	// exactly the expected fields; derivations are envelope-only, never stored.
	var stored []byte
	if err := pool.QueryRow(context.Background(), `SELECT fields FROM job_drafts WHERE id=$1`, id).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if err := draftinput.ValidatePersistedDraftV2(stored); err != nil {
		t.Fatalf("stored merged document: %v", err)
	}
	wantStored := map[string]any{}
	for key, value := range original {
		if key == "description_plain" {
			continue
		}
		wantStored[key] = value
	}
	wantStored["title"], wantStored["skills"] = "Backend Rust", []any{"rust", "go"}
	if storedFields := envelopeOf(t, stored)["fields"].(map[string]any); !reflect.DeepEqual(storedFields, wantStored) {
		t.Fatalf("stored fields mismatch:\n got: %#v\nwant: %#v", storedFields, wantStored)
	}
	if !bytes.Equal(mustCanonical(t, fields["screening_questions"]), mustCanonical(t, original["screening_questions"])) {
		t.Fatal("private question keys changed")
	}
	if description := fields["description"].(map[string]any); description["schema_version"] != int64(1) {
		t.Fatalf("description schema: %#v", description["schema_version"])
	}
	if !bytes.Equal(mustCanonical(t, fields["description"]), mustCanonical(t, original["description"])) {
		t.Fatal("description changed")
	}
	for _, key := range []string{"location", "work_mode", "languages", "compensation", "required_requirements"} {
		if _, ok := fields[key]; !ok {
			t.Fatalf("expected preserved field %s missing from envelope", key)
		}
	}
	if version, _, _ := draftRow(t, pool, id); version != 2 {
		t.Fatalf("version: want 2, got %d", version)
	}
	if got := auditCount(t, pool, id, entities.EventJobDraftSaved); got != 1 {
		t.Fatalf("saved audits: want 1, got %d", got)
	}
}

func TestSaveV2_ScreeningOmittedVersusEmpty(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	questions := envelopeFields(t, created.Body)["screening_questions"]

	kept := saveV2(t, s, p, id, ifMatchV2For(t, id, 1), true, []byte(`{"fields":{"title":"Backend Zig"}}`))
	if !reflect.DeepEqual(envelopeFields(t, kept.Body)["screening_questions"], questions) {
		t.Fatal("omitted screening_questions must be preserved")
	}
	cleared := saveV2(t, s, p, id, ifMatchV2For(t, id, 2), true, []byte(`{"fields":{"screening_questions":[]}}`))
	if empty := envelopeFields(t, cleared.Body)["screening_questions"].([]any); len(empty) != 0 {
		t.Fatalf("empty array must clear: %#v", empty)
	}
	if !bytes.Equal(mustCanonical(t, envelopeFields(t, cleared.Body)["description"]), mustCanonical(t, envelopeFields(t, created.Body)["description"])) {
		t.Fatal("cleared screening altered other fields")
	}
}

func TestSaveV2_NoOpIsByteExact(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)

	before := readV2Snapshot(t, pool, p)
	got := saveV2(t, s, p, id, ifMatchV2For(t, id, 1), true,
		[]byte(`{"fields":{"title":"  Backend Go  ","skills":["Go"]}}`))
	if !bytes.Equal(got.Body, created.Body) || got.ETag != created.ETag || got.Replayed {
		t.Fatalf("normalized no-op must be byte-exact: %+v", got)
	}
	if version, _, _ := draftRow(t, pool, id); version != 1 {
		t.Fatalf("no-op bumped version: %d", version)
	}
	if got := auditCount(t, pool, id, entities.EventJobDraftSaved); got != 0 {
		t.Fatalf("no-op audited: %d", got)
	}
	if after := readV2Snapshot(t, pool, p); after != before {
		t.Fatal("no-op mutated storage (timestamps/audit/idempotency)")
	}
}

func TestSaveV2_AuthorizationAndSchemaPrecedence(t *testing.T) {
	pool := requireDraftPool(t)
	s := newStore(t, pool)
	validPatch := []byte(`{"fields":{"title":"Changed"}}`)

	// Resource authorization precedes schema and precondition evaluation.
	p := newPrincipal(t, pool)
	created := createV2(t, s, p, uuid.NewString(), createV2Body(t))
	member := principal{companyID: p.companyID, ownerID: addMember(t, pool, p.companyID, "recruiter")}
	assertSaveV2Reject(t, pool, s, member, draftIDOf(t, created), ifMatchV2For(t, draftIDOf(t, created), 1), true, validPatch, drafts.ErrNotFound)

	// General gates precede body decoding.
	p = newPrincipal(t, pool)
	created = createV2(t, s, p, uuid.NewString(), createV2Body(t))
	id := draftIDOf(t, created)
	if _, err := pool.Exec(context.Background(), `UPDATE users SET deleted_at=now() WHERE id=$1`, p.ownerID); err != nil {
		t.Fatal(err)
	}
	assertSaveV2Reject(t, pool, s, p, id, ifMatchV2For(t, id, 1), true, []byte(`{`), drafts.ErrUnauthenticated)

	// A known schema-1 row is hidden after authorization, before any tag or
	// body error: even a foreign stale r2 tag stays ErrNotFound.
	p = newPrincipal(t, pool)
	v1Created := create(t, s, p, uuid.NewString(), minimalCreateBody())
	v1ID := draftIDOf(t, v1Created)
	assertSaveV2Reject(t, pool, s, p, v1ID, ifMatchV2For(t, v1ID, 1), true, validPatch, drafts.ErrNotFound)
	assertSaveV2Reject(t, pool, s, p, v1ID, ifMatchV2For(t, uuid.New(), 9), true, []byte(`{`), drafts.ErrNotFound)

	// Corrupt/unknown schema is an invariant failure, never a client error.
	p = newPrincipal(t, pool)
	created = createV2(t, s, p, uuid.NewString(), createV2Body(t))
	id = draftIDOf(t, created)
	if _, err := pool.Exec(context.Background(), `UPDATE job_drafts SET fields=$1 WHERE id=$2`, []byte(`{"schema_version":3,"fields":{}}`), id); err != nil {
		t.Fatal(err)
	}
	assertSaveV2Reject(t, pool, s, p, id, ifMatchV2For(t, id, 1), true, validPatch, nil)
}

func TestSaveV2_FrozenCreateReplaySurvivesSave(t *testing.T) {
	pool := requireDraftPool(t)
	p := newPrincipal(t, pool)
	s := newStore(t, pool)
	key := uuid.NewString()
	created := createV2(t, s, p, key, createV2Body(t))
	id := draftIDOf(t, created)

	saveV2(t, s, p, id, ifMatchV2For(t, id, 1), true, []byte(`{"fields":{"title":"Backend Rust"}}`))
	before := readV2Snapshot(t, pool, p)
	replay := createV2(t, s, p, key, createV2Body(t))
	if !replay.Replayed || !bytes.Equal(replay.Body, created.Body) || replay.ETag != created.ETag {
		t.Fatalf("frozen replay after save must be byte-original: %+v", replay)
	}
	if version, _, _ := draftRow(t, pool, id); version != 2 {
		t.Fatalf("replay reverted the saved version: %d", version)
	}
	if after := readV2Snapshot(t, pool, p); after != before {
		t.Fatal("replay added effects after the save")
	}
}

func TestSaveV2_InvariantPrecedesPreconditionAndBody(t *testing.T) {
	pool := requireDraftPool(t)
	s := newStore(t, pool)
	for _, kind := range []string{"corrupt_json", "invalid_schema2"} {
		t.Run(kind, func(t *testing.T) {
			p := newPrincipal(t, pool)
			created := createV2(t, s, p, uuid.NewString(), createV2Body(t))
			id := draftIDOf(t, created)
			document := []byte(`{`)
			if kind == "invalid_schema2" {
				document = []byte(`{"schema_version":2,"fields":{}}`)
			}
			if _, err := pool.Exec(context.Background(), `UPDATE job_drafts SET fields=$1 WHERE id=$2`, document, id); err != nil {
				t.Fatal(err)
			}
			// The stored-document invariant wins over a missing precondition
			// with a malformed body and over a malformed tag with a malformed
			// body.
			assertSaveV2Reject(t, pool, s, p, id, "", false, []byte(`{`), nil)
			assertSaveV2Reject(t, pool, s, p, id, `W/"jd-r2-`+id.String()+`-v1"`, true, []byte(`{`), nil)
			// An unauthorized caller keeps the hidden 404 on the same corrupt
			// row, never the invariant or any client classification. The fixture
			// demotes the creator and reassigns the principal, since
			// owner-or-principal must both fail.
			if _, err := pool.Exec(context.Background(), `UPDATE company_members SET role='recruiter' WHERE company_id=$1 AND user_id=$2`, p.companyID, p.ownerID); err != nil {
				t.Fatal(err)
			}
			member := principal{companyID: p.companyID, ownerID: addMember(t, pool, p.companyID, "recruiter")}
			if _, err := pool.Exec(context.Background(), `UPDATE job_drafts SET principal_recruiter_id=$1 WHERE id=$2`, member.ownerID, id); err != nil {
				t.Fatal(err)
			}
			assertSaveV2Reject(t, pool, s, p, id, ifMatchV2For(t, id, 1), true, []byte(`{"fields":{"title":"X"}}`), drafts.ErrNotFound)
		})
	}
}

func TestSaveV2_PreconditionClassification(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	patch := titlePatchBody("Backend Rust")
	for _, tc := range []struct {
		name    string
		tag     string
		present bool
		want    error
	}{
		{"missing", "", false, drafts.ErrPreconditionRequired},
		{"malformed_weak", `W/"jd-r2-` + id.String() + `-v1"`, true, drafts.ErrInvalidRequest},
		{"r1_tag", ifMatchFor(t, id, 1), true, drafts.ErrInvalidRequest},
		{"wrong_id", ifMatchV2For(t, uuid.New(), 1), true, drafts.ErrVersionConflict},
		{"stale", ifMatchV2For(t, id, 2), true, drafts.ErrVersionConflict},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assertSaveV2Reject(t, pool, s, p, id, tc.tag, tc.present, patch, tc.want)
		})
	}
	if version, _, _ := draftRow(t, pool, id); version != 1 {
		t.Fatalf("rejected saves bumped version: %d", version)
	}
}

func TestSaveV2_InputClassification(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	tag := ifMatchV2For(t, id, 1)
	for _, tc := range []struct {
		name string
		body []byte
		want error
	}{
		{"structural", []byte(`{"fields":{},"schema_version":2}`), drafts.ErrInvalidRequest},
		{"value", []byte(`{"fields":{"title":42}}`), drafts.ErrValidation},
		{"empty", []byte(`{"fields":{}}`), drafts.ErrEmptyPatch},
		{"body_budget", bytes.Repeat([]byte(" "), draftinput.MaxBodyBytes+1), drafts.ErrPayloadTooLarge},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assertSaveV2Reject(t, pool, s, p, id, tag, true, tc.body, tc.want)
		})
	}
}

func TestSaveV2_RequesterRejectionLeavesState(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	own := insertRequester(t, pool, p.companyID, "client", "Acme Client")
	other := newPrincipal(t, pool)
	foreign := insertRequester(t, pool, other.companyID, "client", "Other Client")

	saved := saveV2(t, s, p, id, ifMatchV2For(t, id, 1), true, requesterBody("client", own.String()))
	requester := envelopeFields(t, saved.Body)["requester"].(map[string]any)
	if requester["name"] != "Acme Client" {
		t.Fatalf("requester.name: %#v", requester["name"])
	}
	tag := ifMatchV2For(t, id, 2)
	for _, tc := range []struct {
		name string
		body []byte
	}{
		{"wrong_kind", requesterBody("internal_area", own.String())},
		{"cross_company", requesterBody("client", foreign.String())},
		{"missing", requesterBody("client", uuid.NewString())},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assertSaveV2Reject(t, pool, s, p, id, tag, true, tc.body, drafts.ErrValidation)
		})
	}
}

func TestSaveV2_VersionOverflowFailsSafely(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	if _, err := pool.Exec(context.Background(), `UPDATE job_drafts SET version=$1 WHERE id=$2`, int64(^uint64(0)>>1), id); err != nil {
		t.Fatal(err)
	}
	assertSaveV2Reject(t, pool, s, p, id, ifMatchV2For(t, id, int64(^uint64(0)>>1)), true, titlePatchBody("Backend Rust"), drafts.ErrVersionOverflow)
}

func TestSaveV2_AuditRollback(t *testing.T) {
	pool := requireDraftPool(t)
	p := newPrincipal(t, pool)
	created := createV2(t, newStore(t, pool), p, uuid.NewString(), createV2Body(t))
	id := draftIDOf(t, created)
	before := readV2Snapshot(t, pool, p)

	failing := NewStore(pool, failingAudit{})
	got, err := failing.SaveV2(context.Background(), p.companyID, p.ownerID, id, ifMatchV2For(t, id, 1), true, titlePatchBody("Backend Rust"))
	if err == nil || !strings.Contains(err.Error(), "forced audit failure") {
		t.Fatalf("want forced audit failure, got %v", err)
	}
	if got.Body != nil || got.ETag != "" || got.Replayed {
		t.Fatalf("rollback returned a partial result: %+v", got)
	}
	if after := readV2Snapshot(t, pool, p); after != before {
		t.Fatal("audit failure left writes")
	}
}

func TestSaveV2_ConcurrentSameTagOneWinner(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	tag := ifMatchV2For(t, id, 1)
	idemBefore := countRows(t, pool, `SELECT count(*) FROM job_draft_idempotency WHERE company_id=$1`, p.companyID)

	type outcome struct {
		result drafts.Result
		err    error
	}
	var wg sync.WaitGroup
	outcomes := make(chan outcome, 2)
	start := make(chan struct{})
	for _, title := range []string{"Backend Rust", "Backend Zig"} {
		wg.Add(1)
		go func(title string) {
			defer wg.Done()
			<-start
			result, err := s.SaveV2(context.Background(), p.companyID, p.ownerID, id, tag, true, titlePatchBody(title))
			outcomes <- outcome{result: result, err: err}
		}(title)
	}
	close(start)
	wg.Wait()
	close(outcomes)

	var winner drafts.Result
	conflicts := 0
	for got := range outcomes {
		switch {
		case got.err == nil:
			if winner.Body != nil {
				t.Fatal("two winners")
			}
			winner = got.result
		case errors.Is(got.err, drafts.ErrVersionConflict):
			conflicts++
			if got.result.Body != nil || got.result.ETag != "" || got.result.Replayed {
				t.Fatalf("conflict returned a partial result: %+v", got.result)
			}
		default:
			t.Fatalf("unexpected save error: %v", got.err)
		}
	}
	if conflicts != 1 || winner.Body == nil {
		t.Fatalf("same-tag concurrent save: want 1 winner + 1 conflict, got conflicts=%d", conflicts)
	}
	title := envelopeFields(t, winner.Body)["title"].(string)
	if title != "Backend Rust" && title != "Backend Zig" {
		t.Fatalf("winner title: %q", title)
	}
	// The winner's response is exactly the current read projection.
	current, err := s.GetV2(context.Background(), p.companyID, p.ownerID, id)
	if err != nil || !bytes.Equal(current.Body, winner.Body) || current.ETag != winner.ETag {
		t.Fatalf("winner response != GetV2: current=%+v err=%v", current, err)
	}
	if winner.ETag != ifMatchV2For(t, id, 2) {
		t.Fatalf("winner etag: %s", winner.ETag)
	}
	// The final stored document is the canonical schema-2 full-17 document
	// carrying the winning title.
	var stored []byte
	if err := pool.QueryRow(context.Background(), `SELECT fields FROM job_drafts WHERE id=$1`, id).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if err := draftinput.ValidatePersistedDraftV2(stored); err != nil {
		t.Fatalf("final stored document: %v", err)
	}
	storedFields := envelopeOf(t, stored)["fields"].(map[string]any)
	if storedFields["title"] != title {
		t.Fatalf("stored title: %#v want %q", storedFields["title"], title)
	}
	if got := len(storedFields); got != 18 {
		t.Fatalf("stored fields: want 18 keys (remote_scope added in G2), got %d", got)
	}
	if got := auditCount(t, pool, id, entities.EventJobDraftSaved); got != 1 {
		t.Fatalf("concurrent save must audit exactly once, got %d", got)
	}
	if got := countRows(t, pool, `SELECT count(*) FROM job_draft_idempotency WHERE company_id=$1`, p.companyID); got != idemBefore {
		t.Fatalf("concurrent saves changed idempotency rows: before %d, after %d", idemBefore, got)
	}
}
