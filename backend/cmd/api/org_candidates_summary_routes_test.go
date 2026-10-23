package main

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	poolapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
)

func TestOrgCandidatesSummaryGates(t *testing.T) {
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
			w := doRouteRequest(t, orgCandidatesRouter(reader), "GET", orgCandidatesPath+"/summary", "", tc.headers)
			if w.Code != tc.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			assertDraftRouteNoStore(t, w)
			if routeCatalogCode(t, w) != tc.code {
				t.Fatal(w.Body.String())
			}
			if reader.summaryCalls != 0 {
				t.Fatal("rejected request reached summary reader")
			}
		})
	}
}

func TestOrgCandidatesSummaryRoute(t *testing.T) {
	reader := &orgDetailReader{}
	router := orgCandidatesRouter(reader)
	headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	t.Run("exact summary shape", func(t *testing.T) {
		w := doRouteRequest(t, router, "GET", orgCandidatesPath+"/summary", "", headers)
		assertDraftRouteNoStore(t, w)
		if w.Code != 200 {
			t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
		}
		var got map[string]json.RawMessage
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		var want map[string]json.RawMessage
		if err := json.Unmarshal([]byte(`{"total":5,"with_active_process":2,"added_last_7_days":3,"by_kind":{"manual":2,"organic":3}}`), &want); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatal(w.Body.String())
		}
		if reader.calls != 0 || len(reader.queries) != 0 || reader.summaryCalls != 1 {
			t.Fatal("summary dispatched to detail/list")
		}
	})
	t.Run("manual detail still resolves", func(t *testing.T) {
		w := doRouteRequest(t, router, "GET", orgCandidatesPath+"/manual/"+routeTestDraftID.String(), "", headers)
		assertDraftRouteNoStore(t, w)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		var got struct {
			Kind string `json:"kind"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || got.Kind != "manual" {
			t.Fatal(w.Body.String(), err)
		}
	})
	t.Run("empty pool emits integer zeroes", func(t *testing.T) {
		reader.summary = &poolapp.Summary{}
		w := doRouteRequest(t, router, "GET", orgCandidatesPath+"/summary", "", headers)
		assertDraftRouteNoStore(t, w)
		if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"total":0,"with_active_process":0,"added_last_7_days":0,"by_kind":{"manual":0,"organic":0}}` {
			t.Fatal(w.Code, w.Body.String())
		}
	})
	t.Run("internal failure is sanitized", func(t *testing.T) {
		reader.err = errors.New("PRIVATE database details")
		w := doRouteRequest(t, router, "GET", orgCandidatesPath+"/summary", "", headers)
		assertDraftRouteNoStore(t, w)
		if w.Code != 500 || routeCatalogCode(t, w) != "internal_error" || strings.Contains(w.Body.String(), "PRIVATE") {
			t.Fatal(w.Code, w.Body.String())
		}
	})
}
