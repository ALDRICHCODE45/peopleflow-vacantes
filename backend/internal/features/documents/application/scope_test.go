package documents_test

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
)

// The scope object is the server's answer to «what can this caller do here»
// (placement-vacancy-documents-v1 «The scope object»): the UI never derives it.

// actions is never nil: an empty list is [] on the wire, so the tests compare against an empty non-nil slice.
func actions(a ...documents.Action) []documents.Action { return append([]documents.Action{}, a...) }

func TestBuildScopeAllowedActions(t *testing.T) {
	for _, tc := range []struct {
		name    string
		in      documents.ScopeInput
		actions []documents.Action
		blocked *documents.BlockedReason
	}{
		{"manager of an ordinary vacancy", documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: true, Documents: 3, Links: 1}, actions(documents.ActionUpload), nil},
		{"manager of a replacement", documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: true, CanReceiveLinks: true, Documents: 3}, actions(documents.ActionUpload, documents.ActionLink), nil},
		{"empty scope", documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: true, CanReceiveLinks: true}, actions(documents.ActionUpload, documents.ActionLink), nil},
		{"one slot left", documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: true, CanReceiveLinks: true, Documents: 40, Links: 9}, actions(documents.ActionUpload, documents.ActionLink), nil},
		{"full by documents", documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: true, CanReceiveLinks: true, Documents: 50}, actions(), ptr(documents.BlockedLimitReached)},
		{"full by documents plus links", documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: true, CanReceiveLinks: true, Documents: 30, Links: 20}, actions(), ptr(documents.BlockedLimitReached)},
		{"participation limit is 20", documents.ScopeInput{Kind: documents.ScopeParticipation, CanManage: true, CanReceiveLinks: true, Documents: 15, Links: 5}, actions(), ptr(documents.BlockedLimitReached)},
		{"participation below 20", documents.ScopeInput{Kind: documents.ScopeParticipation, CanManage: true, Documents: 19}, actions(documents.ActionUpload), nil},
		// A stakeholder never uploads or links, and a full scope is not «blocked» for them: can_manage explains it.
		{"stakeholder", documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: false, CanReceiveLinks: true, Documents: 3}, actions(), nil},
		{"stakeholder on a full scope", documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: false, CanReceiveLinks: true, Documents: 50}, actions(), nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			scope := documents.BuildScope(tc.in)
			if scope.CanManage != tc.in.CanManage {
				t.Fatalf("can_manage = %v", scope.CanManage)
			}
			if !reflect.DeepEqual(scope.AllowedActions, tc.actions) {
				t.Fatalf("allowed_actions = %v, want %v", scope.AllowedActions, tc.actions)
			}
			if !reflect.DeepEqual(scope.UploadBlockedReason, tc.blocked) {
				t.Fatalf("upload_blocked_reason = %v, want %v", scope.UploadBlockedReason, tc.blocked)
			}
			if scope.Counts.Documents != tc.in.Documents || scope.Counts.Links != tc.in.Links {
				t.Fatalf("counts = %+v", scope.Counts)
			}
		})
	}
}

func ptr[T any](v T) *T { return &v }

func TestBuildScopeLimitsAndJSONShape(t *testing.T) {
	scope := documents.BuildScope(documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: true, Documents: 1, Links: 2})
	raw, err := json.Marshal(scope)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"can_manage", "allowed_actions", "upload_blocked_reason", "limits", "counts"} {
		if _, ok := got[key]; !ok {
			t.Errorf("scope lacks %q: %s", key, raw)
		}
	}
	if len(got) != 5 {
		t.Errorf("scope has extra keys: %s", raw)
	}
	limits := got["limits"].(map[string]any)
	if limits["max_bytes"] != float64(10_485_760) || limits["max_documents"] != float64(50) || limits["max_versions"] != float64(25) {
		t.Fatalf("limits = %v", limits)
	}
	if len(limits) != 4 {
		t.Fatalf("limits has extra keys: %v", limits)
	}
	formats := limits["formats"].([]any)
	if len(formats) != 5 {
		t.Fatalf("formats = %v", formats)
	}
	first := formats[0].(map[string]any)
	if first["format"] != "pdf" || first["content_type"] != "application/pdf" || !reflect.DeepEqual(first["extensions"], []any{".pdf"}) {
		t.Fatalf("first format = %v", first)
	}
	if got["upload_blocked_reason"] != nil {
		t.Fatalf("upload_blocked_reason = %v, want null", got["upload_blocked_reason"])
	}
	counts := got["counts"].(map[string]any)
	if counts["documents"] != float64(1) || counts["links"] != float64(2) || len(counts) != 2 {
		t.Fatalf("counts = %v", counts)
	}
	// An empty action list is [], never null: the frontend decodes an array.
	empty, _ := json.Marshal(documents.BuildScope(documents.ScopeInput{Kind: documents.ScopeVacancy}))
	if !strings.Contains(string(empty), `"allowed_actions":[]`) {
		t.Fatalf("empty actions must be []: %s", empty)
	}
	participation := documents.BuildScope(documents.ScopeInput{Kind: documents.ScopeParticipation, CanManage: true})
	if participation.Limits.MaxDocuments != 20 {
		t.Fatalf("participation max_documents = %d", participation.Limits.MaxDocuments)
	}
}

func TestItemActions(t *testing.T) {
	for _, tc := range []struct {
		name         string
		canManage    bool
		versionCount int
		want         []documents.Action
	}{
		{"manager", true, 1, actions(documents.ActionDownload, documents.ActionReplace, documents.ActionDelete)},
		{"manager one below the cap", true, 24, actions(documents.ActionDownload, documents.ActionReplace, documents.ActionDelete)},
		{"manager at 25 versions loses replace", true, 25, actions(documents.ActionDownload, documents.ActionDelete)},
		{"stakeholder", false, 1, actions(documents.ActionDownload)},
		{"stakeholder at 25 versions", false, 25, actions(documents.ActionDownload)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := documents.ItemActions(tc.canManage, tc.versionCount); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestLinkActions(t *testing.T) {
	for _, tc := range []struct {
		name      string
		canManage bool
		state     documents.LinkState
		want      []documents.Action
	}{
		{"manager, available", true, documents.LinkAvailable, actions(documents.ActionDownload, documents.ActionUnlink)},
		{"stakeholder, available", false, documents.LinkAvailable, actions(documents.ActionDownload)},
		{"manager, removed", true, documents.LinkRemoved, actions(documents.ActionUnlink)},
		{"manager, inaccessible", true, documents.LinkInaccessible, actions(documents.ActionUnlink)},
		{"stakeholder, removed", false, documents.LinkRemoved, actions()},
		{"stakeholder, inaccessible", false, documents.LinkInaccessible, actions()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := documents.LinkActions(tc.canManage, tc.state); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

// The closed enums the frontend decodes (contract «Closed enums»).
func TestClosedEnumValues(t *testing.T) {
	for got, want := range map[string]string{
		string(documents.ActionDownload): "download", string(documents.ActionReplace): "replace", string(documents.ActionDelete): "delete",
		string(documents.ActionUnlink): "unlink", string(documents.ActionUpload): "upload", string(documents.ActionLink): "link",
		string(documents.LinkAvailable): "available", string(documents.LinkRemoved): "removed", string(documents.LinkInaccessible): "inaccessible",
		string(documents.BlockedLimitReached): "limit_reached",
	} {
		if got != want {
			t.Errorf("enum value %q, want %q", got, want)
		}
	}
}

func TestMaxDocumentsPerScope(t *testing.T) {
	if documents.MaxDocuments(documents.ScopeVacancy) != 50 || documents.MaxDocuments(documents.ScopeParticipation) != 20 {
		t.Fatal("limits per scope")
	}
}
