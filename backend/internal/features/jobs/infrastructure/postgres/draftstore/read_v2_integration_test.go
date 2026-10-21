//go:build integration

package draftstore

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftversion"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const readV2Document = `{"schema_version":2,"fields":{
"title":"Backend Go","location":null,"remote_scope":{"kind":"anywhere"},"work_mode":"remote","work_schedule":"full_time",
"contract_type":"indefinite","seniority":"senior","professional_area":"technology_systems",
"requester":null,"skills":["Go"],"languages":[{"language":"es","custom_name":null,"level":"native"}],
"benefits":["health_insurance"],"custom_benefits":["Travel"],
"required_requirements":"Go","preferred_requirements":"SQL",
"screening_questions":[
{"id":"D2B3C4D5-E6F7-4A8B-9C0D-1E2F3A4B5C6D","type":"open","prompt":"Describe a project."},
{"id":"c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c","type":"single_choice_informative","prompt":"Preferred mode?","options":[{"id":"3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f","label":"Remote"},{"id":"4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f70","label":"Hybrid"}]},
{"id":"b0f1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d","type":"single_choice_evaluated","prompt":"Go function keyword?","options":[{"id":"1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d","label":"func"},{"id":"2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e","label":"function"}],"correct_option_id":"1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"}],
"compensation":{"mode":"fixed","amount":"30000.00","min":null,"max":null,"currency":"MXN","pay_period":"monthly","basis":"gross","public_visible":false},
"description":{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}}
}}`

// Setup and side-effect inspection use SQL because v2 writes and public audit
// counters deliberately do not exist. All behavior under test goes through the
// public V2Reader or the unchanged public v1 Store methods.
func seedReadV2(t *testing.T, pool *pgxpool.Pool, p principal, body []byte) (*Store, drafts.Result, string) {
	t.Helper()
	store := newStore(t, pool)
	key := uuid.NewString()
	created := create(t, store, p, key, minimalCreateBody())
	if _, err := pool.Exec(context.Background(), `UPDATE job_drafts SET fields=$1 WHERE id=$2`, body, draftIDOf(t, created)); err != nil {
		t.Fatal(err)
	}
	return store, created, key
}

func readV2Snapshot(t *testing.T, pool *pgxpool.Pool, p principal) string {
	t.Helper()
	var snapshot string
	err := pool.QueryRow(context.Background(), `SELECT json_build_array(
		(SELECT json_agg(d ORDER BY id) FROM job_drafts d WHERE company_id=$1),
		(SELECT json_agg(i ORDER BY id) FROM job_draft_idempotency i WHERE company_id=$1),
		(SELECT json_agg(a ORDER BY id) FROM audit_events a WHERE entity_id IN
			(SELECT id FROM job_drafts WHERE company_id=$1)))::text`, p.companyID).Scan(&snapshot)
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestGetV2_CompleteEnvelopeAndNoMutation(t *testing.T) {
	pool := requireDraftPool(t)
	for _, shape := range []string{"populated", "nullable", "requester_without_id"} {
		t.Run(shape, func(t *testing.T) {
			p := newPrincipal(t, pool)
			doc := envelopeOf(t, []byte(readV2Document))
			fields := doc["fields"].(map[string]any)
			var plain, name any = "Hello", "Engineering"
			if shape == "nullable" {
				for k, v := range fields {
					if _, ok := v.(string); ok {
						fields[k] = nil
					}
				}
				fields["description"] = nil
				plain, name = nil, nil
			} else {
				var requesterID any
				if shape == "populated" {
					requesterID = insertRequester(t, pool, p.companyID, "internal_area", "Engineering").String()
				} else {
					name = nil
				}
				fields["requester"] = map[string]any{"kind": "internal_area", "id": requesterID}
			}
			canonical := mustCanonical(t, doc)
			if err := draftinput.ValidatePersistedDraftV2(canonical); err != nil {
				t.Fatalf("fixture: %v", err)
			}
			store, created, _ := seedReadV2(t, pool, p, canonical)
			id := draftIDOf(t, created)
			member := addMember(t, pool, p.companyID, "recruiter")
			if _, err := pool.Exec(context.Background(), `UPDATE job_drafts SET principal_recruiter_id=$1 WHERE id=$2`, member, id); err != nil {
				t.Fatal(err)
			}
			before := readV2Snapshot(t, pool, p)
			want := envelopeOf(t, created.Body)
			want["schema_version"], want["principal_recruiter_id"] = int64(2), member.String()
			fields["description_plain"] = plain
			if requester, ok := fields["requester"].(map[string]any); ok {
				requester["name"] = name
			}
			want["fields"] = fields
			want["lifecycle"] = map[string]any{"publication": nil, "process": nil, "version": "0", "published_at": nil, "paused_at": nil, "closed_at": nil, "process_finished_at": nil, "allowed_actions": []any{"publish"}, "close_reason": nil, "close_reason_note": nil}
			wantBody := mustCanonical(t, want)
			wantTag := `"jd-r2-` + id.String() + `-v1"`
			var reader drafts.V2Reader = store
			for _, actor := range []uuid.UUID{p.ownerID, member} {
				got, err := reader.GetV2(context.Background(), p.companyID, actor, id)
				if err != nil {
					t.Fatalf("GetV2: %v", err)
				}
				if !bytes.Equal(got.Body, wantBody) || got.ETag != wantTag || got.Replayed {
					t.Fatalf("GetV2 = %+v body=%s; want tag=%s body=%s", got, got.Body, wantTag, wantBody)
				}
				tag, err := draftversion.ParseIfMatchV2(got.ETag, true)
				if err != nil || tag.ID != id.String() || tag.Version != 1 {
					t.Fatalf("tag=%+v err=%v", tag, err)
				}
			}
			if after := readV2Snapshot(t, pool, p); after != before {
				t.Fatal("read changed stored state")
			}
		})
	}
}

func TestGetV2_RejectsWithoutDataOrMutation(t *testing.T) {
	pool := requireDraftPool(t)
	cases := []struct {
		name string
		want error
	}{
		{"v1", drafts.ErrNotFound}, {"unknown_version", nil}, {"string_version", nil},
		{"malformed", nil}, {"noncanonical", nil}, {"missing_field", nil},
		{"foreign_requester", nil}, {"wrong_requester_kind", nil},
		{"nonprincipal", drafts.ErrNotFound}, {"other_company", drafts.ErrNotFound},
		{"missing", drafts.ErrNotFound}, {"dead_user", drafts.ErrUnauthenticated},
		{"no_membership", drafts.ErrForbidden}, {"inactive_company", drafts.ErrCompanyNotActive},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := newPrincipal(t, pool)
			doc := envelopeOf(t, []byte(readV2Document))
			fields := doc["fields"].(map[string]any)
			switch tc.name {
			case "v1":
				doc["schema_version"] = int64(1)
			case "unknown_version":
				doc["schema_version"] = int64(3)
			case "string_version":
				doc["schema_version"] = "2"
			case "noncanonical":
				fields["title"] = " padded "
			case "missing_field":
				delete(fields, "skills")
			case "foreign_requester":
				other := newPrincipal(t, pool)
				ref := insertRequester(t, pool, other.companyID, "client", "Other")
				fields["requester"] = map[string]any{"kind": "client", "id": ref.String()}
			case "wrong_requester_kind":
				ref := insertRequester(t, pool, p.companyID, "client", "Client")
				fields["requester"] = map[string]any{"kind": "internal_area", "id": ref.String()}
			}
			body := mustCanonical(t, doc)
			// Invalid bytes force auth/resource gating to win over parsing.
			if tc.name == "malformed" || (tc.want != nil && tc.name != "v1") {
				body = []byte(`{`)
			}
			store, created, _ := seedReadV2(t, pool, p, body)
			id, company, actor := draftIDOf(t, created), p.companyID, p.ownerID
			switch tc.name {
			case "nonprincipal":
				actor = addMember(t, pool, p.companyID, "recruiter")
			case "other_company":
				other := newPrincipal(t, pool)
				company, actor = other.companyID, other.ownerID
			case "missing":
				id = uuid.New()
			case "dead_user":
				if _, err := pool.Exec(context.Background(), `UPDATE users SET deleted_at=now() WHERE id=$1`, actor); err != nil {
					t.Fatal(err)
				}
			case "no_membership":
				actor = insertUser(t, pool)
				registerUserCleanup(t, pool, actor)
			case "inactive_company":
				if _, err := pool.Exec(context.Background(), `UPDATE companies SET status='suspended' WHERE id=$1`, company); err != nil {
					t.Fatal(err)
				}
			}
			before := readV2Snapshot(t, pool, p)
			var reader drafts.V2Reader = store
			got, err := reader.GetV2(context.Background(), company, actor, id)
			if tc.want != nil {
				if !errors.Is(err, tc.want) {
					t.Fatalf("err=%v want=%v", err, tc.want)
				}
			} else if err == nil || errors.Is(err, drafts.ErrNotFound) || errors.Is(err, drafts.ErrValidation) || errors.Is(err, drafts.ErrInvalidRequest) {
				t.Fatalf("want internal invariant error, got %v", err)
			}
			if got.Body != nil || got.ETag != "" || got.Replayed {
				t.Fatalf("partial result: %+v", got)
			}
			if after := readV2Snapshot(t, pool, p); after != before {
				t.Fatal("rejection changed stored state")
			}
		})
	}
}

func TestGetV2_PreservesV1GetSaveAndReplay(t *testing.T) {
	pool := requireDraftPool(t)
	p := newPrincipal(t, pool)
	store := newStore(t, pool)
	key := uuid.NewString()
	created := create(t, store, p, key, minimalCreateBody())
	id := draftIDOf(t, created)
	before := readV2Snapshot(t, pool, p)
	got, err := store.Get(context.Background(), p.companyID, p.ownerID, id)
	if err != nil || !bytes.Equal(got.Body, created.Body) || got.ETag != created.ETag || got.Replayed {
		t.Fatalf("v1 get changed: %+v %v", got, err)
	}
	replay := create(t, store, p, key, minimalCreateBody())
	if !replay.Replayed || !bytes.Equal(replay.Body, created.Body) || replay.ETag != created.ETag {
		t.Fatal("v1 replay changed")
	}
	if after := readV2Snapshot(t, pool, p); after != before {
		t.Fatal("v1 read/replay mutated state")
	}
	if _, err := pool.Exec(context.Background(), `UPDATE job_drafts SET fields=$1 WHERE id=$2`, []byte(readV2Document), id); err != nil {
		t.Fatal(err)
	}
	before = readV2Snapshot(t, pool, p)
	calls := []struct {
		name string
		run  func() (drafts.Result, error)
	}{
		{"get", func() (drafts.Result, error) { return store.Get(context.Background(), p.companyID, p.ownerID, id) }},
		{"save", func() (drafts.Result, error) {
			return store.Save(context.Background(), p.companyID, p.ownerID, id, strings.Replace(created.ETag, "jd-r1-", "jd-r2-", 1), true, []byte(`{`))
		}},
		{"replay", func() (drafts.Result, error) {
			return store.Create(context.Background(), p.companyID, p.ownerID, key, minimalCreateBody())
		}},
	}
	for _, call := range calls {
		t.Run(call.name, func(t *testing.T) {
			got, err := call.run()
			if !errors.Is(err, drafts.ErrNotFound) || got.Body != nil || got.ETag != "" || got.Replayed {
				t.Fatalf("v1 %s exposed v2: %+v %v", call.name, got, err)
			}
		})
	}
	if after := readV2Snapshot(t, pool, p); after != before {
		t.Fatal("v1 rejection mutated state")
	}
}
