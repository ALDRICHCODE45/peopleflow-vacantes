package draftstore

import (
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/google/uuid"
)

// mustCanonical encodes an already-typed value with the approved canonical
// serializer. Tests use it to build the exact stored byte shape.
func mustCanonical(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := draftjson.EncodeValidatedValue(value)
	if err != nil {
		t.Fatalf("EncodeValidatedValue: %v", err)
	}
	return encoded
}

// decodeCanonical decodes canonical bytes back into the strict dynamic type
// set (int64 numbers, map[string]any objects).
func decodeCanonical(t *testing.T, data []byte) map[string]any {
	t.Helper()
	value, err := draftjson.Decode(data)
	if err != nil {
		t.Fatalf("draftjson.Decode: %v", err)
	}
	object, ok := value.(map[string]any)
	if !ok || object == nil {
		t.Fatalf("decoded canonical bytes are not an object: %T", value)
	}
	return object
}

// TestMergeWritable_ReplacesPresentFieldsFully proves the patch merge rule:
// keys present in the delta replace their stored value wholesale (no nested
// merge), absent keys are preserved verbatim, and array order is preserved.
func TestMergeWritable_ReplacesPresentFieldsFully(t *testing.T) {
	current := mustCanonical(t, map[string]any{
		"schema_version": int64(1),
		"fields": map[string]any{
			"title":       "Backend Go",
			"skills":      []any{"go", "sql"},
			"requester":   nil,
			"description": map[string]any{"schema_version": int64(1)},
		},
	})
	delta := mustCanonical(t, map[string]any{
		"schema_version": int64(1),
		"fields": map[string]any{
			"skills": []any{"rust"},
			"title":  nil,
		},
	})

	merged, err := mergeWritable(current, delta)
	if err != nil {
		t.Fatalf("mergeWritable: %v", err)
	}

	fields, ok := decodeCanonical(t, merged)["fields"].(map[string]any)
	if !ok {
		t.Fatal("merged envelope has no fields object")
	}
	if fields["title"] != nil {
		t.Errorf("title: want replaced with null, got %#v", fields["title"])
	}
	skills, ok := fields["skills"].([]any)
	if !ok || len(skills) != 1 || skills[0] != "rust" {
		t.Errorf("skills: want fully replaced [rust], got %#v", fields["skills"])
	}
	if _, preserved := fields["requester"]; !preserved {
		t.Error("requester: absent key must be preserved")
	} else if fields["requester"] != nil {
		t.Errorf("requester: want preserved null, got %#v", fields["requester"])
	}
	if _, preserved := fields["description"]; !preserved {
		t.Error("description: absent key must be preserved")
	}

	// A no-op delta (identical fields) must yield byte-identical canonical
	// bytes, which is the store's no-op detection.
	noop, err := mergeWritable(current, current)
	if err != nil {
		t.Fatalf("mergeWritable(no-op): %v", err)
	}
	if string(noop) != string(current) {
		t.Errorf("no-op merge must be byte-identical\n got: %s\nwant: %s", noop, current)
	}
}

// TestMergeWritable_RejectsMalformedEnvelope pins that a stored or delta
// envelope without the {schema_version, fields} shape is a hard error rather
// than silently merged.
func TestMergeWritable_RejectsMalformedEnvelope(t *testing.T) {
	valid := mustCanonical(t, map[string]any{
		"schema_version": int64(1),
		"fields":         map[string]any{"title": "x"},
	})
	if _, err := mergeWritable([]byte(`{"nope":1}`), valid); err == nil {
		t.Error("malformed current envelope: want error, got nil")
	}
	if _, err := mergeWritable(valid, []byte(`{"fields":"x"}`)); err == nil {
		t.Error("malformed delta envelope: want error, got nil")
	}
}

// TestRenderEnvelope_DerivesDescriptionPlainAndRequesterName pins the read
// envelope: the numeric schema version, the decimal version string, UTC
// microsecond timestamps, the full writable field set, the derived
// description_plain and the nested requester.name.
func TestRenderEnvelope_DerivesDescriptionPlainAndRequesterName(t *testing.T) {
	draftID := uuid.MustParse("018f0000-0000-7000-8000-0000000000e1")
	actorID := uuid.MustParse("018f0000-0000-7000-8000-0000000000e2")
	requesterID := uuid.MustParse("018f0000-0000-7000-8000-0000000000e3")

	fields := mustCanonical(t, map[string]any{
		"schema_version": int64(1),
		"fields": map[string]any{
			"title": "Backend Go",
			"description": map[string]any{
				"schema_version": int64(1),
				"document": map[string]any{
					"type": "doc",
					"content": []any{
						map[string]any{
							"type": "paragraph",
							"content": []any{
								map[string]any{"type": "text", "text": "Hola"},
							},
						},
					},
				},
			},
			"requester": map[string]any{"kind": "client", "id": requesterID.String()},
		},
	})

	record := draftRecord{
		id:          draftID,
		principalID: actorID,
		status:      "draft",
		version:     3,
		fields:      fields,
		createdAt:   time.Date(2026, 1, 2, 3, 4, 5, 123456000, time.UTC),
		updatedAt:   time.Date(2026, 1, 2, 3, 5, 6, 654321000, time.UTC),
	}

	body, err := renderEnvelope(record, stringPtr("Acme"))
	if err != nil {
		t.Fatalf("renderEnvelope: %v", err)
	}
	envelope := decodeCanonical(t, body)

	if envelope["schema_version"] != int64(1) {
		t.Errorf("schema_version: want int64(1), got %#v", envelope["schema_version"])
	}
	if envelope["id"] != draftID.String() {
		t.Errorf("id: want %s, got %#v", draftID, envelope["id"])
	}
	if envelope["principal_recruiter_id"] != actorID.String() {
		t.Errorf("principal_recruiter_id: want %s, got %#v", actorID, envelope["principal_recruiter_id"])
	}
	if envelope["status"] != "draft" {
		t.Errorf("status: want draft, got %#v", envelope["status"])
	}
	if envelope["version"] != "3" {
		t.Errorf("version: want decimal string \"3\", got %#v", envelope["version"])
	}
	if envelope["created_at"] != "2026-01-02T03:04:05.123456Z" {
		t.Errorf("created_at: want 2026-01-02T03:04:05.123456Z, got %#v", envelope["created_at"])
	}
	if envelope["updated_at"] != "2026-01-02T03:05:06.654321Z" {
		t.Errorf("updated_at: want 2026-01-02T03:05:06.654321Z, got %#v", envelope["updated_at"])
	}

	gotFields, ok := envelope["fields"].(map[string]any)
	if !ok {
		t.Fatal("envelope.fields is not an object")
	}
	if gotFields["description_plain"] != "Hola" {
		t.Errorf("description_plain: want %q, got %#v", "Hola", gotFields["description_plain"])
	}
	if gotFields["title"] != "Backend Go" {
		t.Errorf("title: want Backend Go, got %#v", gotFields["title"])
	}
	requester, ok := gotFields["requester"].(map[string]any)
	if !ok {
		t.Fatal("fields.requester is not an object")
	}
	if requester["name"] != "Acme" {
		t.Errorf("requester.name: want Acme, got %#v", requester["name"])
	}
}

// TestRenderEnvelope_NullDescriptionAndRequester pins the derived null shapes:
// a null description yields description_plain null and a null requester stays
// null.
func TestRenderEnvelope_NullDescriptionAndRequester(t *testing.T) {
	record := draftRecord{
		id:          uuid.New(),
		principalID: uuid.New(),
		status:      "draft",
		version:     1,
		fields: mustCanonical(t, map[string]any{
			"schema_version": int64(1),
			"fields": map[string]any{
				"description": nil,
				"requester":   nil,
			},
		}),
		createdAt: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		updatedAt: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
	}

	body, err := renderEnvelope(record, nil)
	if err != nil {
		t.Fatalf("renderEnvelope: %v", err)
	}
	fields := decodeCanonical(t, body)["fields"].(map[string]any)

	if value, present := fields["description_plain"]; !present || value != nil {
		t.Errorf("description_plain: want present null, got present=%v value=%#v", present, value)
	}
	if fields["requester"] != nil {
		t.Errorf("requester: want null, got %#v", fields["requester"])
	}
}

// TestRequesterRef_ReadsKindAndID pins the authoritative requester extraction
// from the canonical bytes (never from a mutable Fields struct).
func TestRequesterRef_ReadsKindAndID(t *testing.T) {
	requesterID := "018f0000-0000-7000-8000-0000000000e3"
	withID := mustCanonical(t, map[string]any{
		"schema_version": int64(1),
		"fields": map[string]any{
			"requester": map[string]any{"kind": "internal_area", "id": requesterID},
		},
	})
	kind, id, present, err := requesterRef(withID)
	if err != nil {
		t.Fatalf("requesterRef: %v", err)
	}
	if !present || kind != "internal_area" || id == nil || *id != requesterID {
		t.Errorf("requesterRef: got present=%v kind=%q id=%v", present, kind, id)
	}

	nullRequester := mustCanonical(t, map[string]any{
		"schema_version": int64(1),
		"fields":         map[string]any{"requester": nil},
	})
	kind, id, present, err = requesterRef(nullRequester)
	if err != nil {
		t.Fatalf("requesterRef(null): %v", err)
	}
	if present || kind != "" || id != nil {
		t.Errorf("requesterRef(null): want absent, got present=%v kind=%q id=%v", present, kind, id)
	}
}

func stringPtr(value string) *string { return &value }

// TestAuthorized_OnlyOwnerOrPrincipal pins the resource policy: a caller may
// read or save an addressed draft only as the company owner or as the draft
// principal. The creator (created_by) is deliberately NOT sufficient on its
// own — principal reassignment is a future concern and the extra OR was an
// unnecessary authorization widening.
func TestAuthorized_OnlyOwnerOrPrincipal(t *testing.T) {
	principal := uuid.MustParse("018f0000-0000-7000-8000-0000000000f1")
	creator := uuid.MustParse("018f0000-0000-7000-8000-0000000000f2")
	record := draftRecord{createdBy: creator, principalID: principal}

	tests := []struct {
		name  string
		role  string
		actor uuid.UUID
		want  bool
	}{
		{"owner is allowed even when not principal", roleOwner, uuid.MustParse("018f0000-0000-7000-8000-0000000000f3"), true},
		{"principal is allowed as a recruiter", "recruiter", principal, true},
		{"creator who is neither owner nor principal is denied", "recruiter", creator, false},
		{"unrelated member is denied", "recruiter", uuid.MustParse("018f0000-0000-7000-8000-0000000000f4"), false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := authorized(authContext{role: tc.role}, tc.actor, record); got != tc.want {
				t.Errorf("authorized(role=%q, actor=%s) = %v, want %v", tc.role, tc.actor, got, tc.want)
			}
		})
	}
}
