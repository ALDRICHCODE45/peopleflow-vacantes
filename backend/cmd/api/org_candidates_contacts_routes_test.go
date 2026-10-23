package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestOrgCandidatesContacts(t *testing.T) {
	headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	entry := `{"kind":"manual","id":"` + routeTestDraftID.String() + `"}`
	valid := `{"candidates":[` + entry + `]}`
	for _, tc := range []struct {
		name    string
		headers map[string]string
		status  int
		code    string
	}{
		{"anonymous", nil, 401, "unauthenticated"},
		{"non recruiter", map[string]string{"X-Test-Sub": "candidate"}, 403, "forbidden"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reader := &orgCandidatesReader{}
			w := doRouteRequest(t, orgCandidatesRouter(reader), "POST", orgCandidatesPath+"/contacts", valid, tc.headers)
			assertDraftRouteNoStore(t, w)
			var body map[string]any
			_ = json.Unmarshal(w.Body.Bytes(), &body)
			if w.Code != tc.status || len(body) != 2 || body["code"] != tc.code || body["error"] == nil || reader.contactCalls != 0 {
				t.Fatal(w.Code, w.Body.String(), reader.contactCalls)
			}
		})
	}
	type invalidCase struct {
		name, body, code, field, fieldCode string
		status                             int
	}
	cases := []invalidCase{
		{"missing", `{}`, "validation_error", "candidates", "required", 400},
		{"empty", `{"candidates":[]}`, "validation_error", "candidates", "required", 400},
		{"null", `{"candidates":null}`, "validation_error", "candidates", "required", 400},
		{"invalid kind", strings.Replace(valid, `"manual"`, `"PRIVATE"`, 1), "validation_error", "candidates[0].kind", "invalid", 400},
		{"invalid id", strings.Replace(valid, routeTestDraftID.String(), "PRIVATE", 1), "validation_error", "candidates[0].id", "invalid", 400},
		{"nil id", strings.Replace(valid, routeTestDraftID.String(), "00000000-0000-0000-0000-000000000000", 1), "validation_error", "candidates[0].id", "invalid", 400},
		{"id wrong type", `{"candidates":[{"kind":"manual","id":7}]}`, "validation_error", "candidates[0].id", "invalid", 400},
		{"kind wrong type", `{"candidates":[{"kind":null,"id":"` + routeTestDraftID.String() + `"}]}`, "validation_error", "candidates[0].kind", "invalid", 400},
		{"duplicate UUID spelling", `{"candidates":[` + entry + `,` + strings.Replace(entry, routeTestDraftID.String(), "{"+routeTestDraftID.String()+"}", 1) + `]}`, "validation_error", "candidates", "duplicate", 400},
		{"duplicate", `{"candidates":[` + entry + `,` + entry + `]}`, "validation_error", "candidates", "duplicate", 400},
		{"unknown root", `{"PRIVATE":true,"candidates":[]}`, "invalid_request", "", "", 400},
		{"unknown nested", strings.Replace(valid, `"kind":`, `"PRIVATE":true,"kind":`, 1), "invalid_request", "", "", 400},
		{"duplicate JSON key", `{"candidates":[],"candidates":[]}`, "invalid_request", "", "", 400},
		{"trailing", valid + ` {}`, "invalid_request", "", "", 400},
		{"malformed", `{"PRIVATE":`, "invalid_request", "", "", 400},
		{"oversized", valid + strings.Repeat(" ", 16*1024+1-len(valid)), "payload_too_large", "", "", 413},
		{"wrong candidates type", `{"candidates":{}}`, "invalid_request", "", "", 400},
		{"wrong root type", `[]`, "invalid_request", "", "", 400},
		{"wrong entry type", `{"candidates":[null]}`, "invalid_request", "", "", 400},
	}
	entries := []string{}
	for i := 1; i <= 101; i++ {
		entries = append(entries, fmt.Sprintf(`{"kind":"manual","id":"11111111-1111-4111-8111-%012d"}`, i))
	}
	cases = append(cases, invalidCase{"too many", `{"candidates":[` + strings.Join(entries, ",") + `]}`, "validation_error", "candidates", "too_many", 400})
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reader := &orgCandidatesReader{}
			w := doRouteRequest(t, orgCandidatesRouter(reader), "POST", orgCandidatesPath+"/contacts", tc.body, headers)
			assertDraftRouteNoStore(t, w)
			var got map[string]any
			_ = json.Unmarshal(w.Body.Bytes(), &got)
			keys := 2
			if tc.field != "" {
				keys = 3
				want := []any{map[string]any{"field": tc.field, "code": tc.fieldCode}}
				if !reflect.DeepEqual(got["fields"], want) {
					t.Fatal(w.Code, w.Body.String(), want)
				}
			}
			if w.Code != tc.status || len(got) != keys || got["code"] != tc.code || got["error"] == nil || strings.Contains(w.Body.String(), "PRIVATE") || reader.contactCalls != 0 {
				t.Fatal(w.Code, w.Body.String(), reader.contactCalls)
			}
		})
	}
	for _, tc := range []struct{ name, body string }{
		{"success", valid},
		{"exact body limit", valid + strings.Repeat(" ", 16*1024-len(valid))},
		{"100 entries", `{"candidates":[` + strings.Join(entries[:100], ",") + `]}`},
		{"same id different kind", `{"candidates":[` + entry + `,` + strings.Replace(entry, "manual", "organic", 1) + `]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reader := &orgCandidatesReader{}
			w := doRouteRequest(t, orgCandidatesRouter(reader), "POST", orgCandidatesPath+"/contacts", tc.body, headers)
			assertDraftRouteNoStore(t, w)
			var got map[string]any
			_ = json.Unmarshal(w.Body.Bytes(), &got)
			var request struct {
				Candidates []map[string]any `json:"candidates"`
			}
			_ = json.Unmarshal([]byte(tc.body), &request)
			wantItems := []any{}
			for i, candidate := range request.Candidates {
				wantItems = append(wantItems, map[string]any{"kind": candidate["kind"], "id": candidate["id"], "email": "export@example.test", "phone": nil})
				if i >= len(reader.contactSelections) || reader.contactSelections[i].Kind != candidate["kind"] || reader.contactSelections[i].ID.String() != candidate["id"] {
					t.Fatal("selection not forwarded in request order", reader.contactSelections)
				}
			}
			if w.Code != 200 || !reflect.DeepEqual(got, map[string]any{"items": wantItems}) || reader.contactCalls != 1 {
				t.Fatal(w.Code, w.Body.String(), reader.contactCalls)
			}
		})
	}
	t.Run("internal error", func(t *testing.T) {
		w := doRouteRequest(t, orgCandidatesRouter(&orgCandidatesReader{err: errors.New("PRIVATE datastore failure")}), "POST", orgCandidatesPath+"/contacts", valid, headers)
		assertDraftRouteNoStore(t, w)
		var got map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &got)
		if w.Code != 500 || len(got) != 2 || got["code"] != "internal_error" || got["error"] == nil || strings.Contains(w.Body.String(), "PRIVATE") {
			t.Fatal(w.Code, w.Body.String())
		}
	})
}
