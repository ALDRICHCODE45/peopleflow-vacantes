package main

import (
	"encoding/json"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/google/uuid"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	pc "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
)

func TestColumnPutOccupiedAndPreviewBudget(t *testing.T) {
	auth := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": `"opaque"`}
	path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/pipeline"
	store := &pipelineRouteStore{err: &pc.Occupied{StageIDs: []string{"a", "b"}}}
	rec := doRouteRequest(t, pipelineRoutesRouter(store), "PUT", path, `{}`, auth)
	var obj map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &obj); err != nil || rec.Code != 409 || len(obj) != 3 || obj["details"] == nil || routeCatalogCode(t, rec) != "stage_occupied" {
		t.Fatal(rec.Code, rec.Body.String(), err)
	}
	assertDraftRouteNoStore(t, rec)
	store = &pipelineRouteStore{}
	rec = doRouteRequest(t, pipelineRoutesRouter(store), "POST", path+"/preview", strings.Repeat("x", 1048577), auth)
	if rec.Code != 413 || len(store.previews) != 0 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	assertDraftRouteNoStore(t, rec)
}

func TestColumnRecoveryStageRequiredWire(t *testing.T) {
	s := &movementRouteStore{err: app.ErrRecoveryStageRequired}
	rec := doRouteRequest(t, movementRouter(s), "POST", "/v2/me/company/job-drafts/"+routeTestDraftID.String()+"/participations/"+uuid.NewString()+"/recover", `{}`, map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": `"opaque"`})
	var obj map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &obj); err != nil || rec.Code != 409 || len(obj) != 2 || routeCatalogCode(t, rec) != "recovery_stage_required" || s.operation != "recover" {
		t.Fatal(rec.Code, rec.Body.String(), err)
	}
	assertDraftRouteNoStore(t, rec)
}

func TestColumnPreviewRouteExactKeysAndGates(t *testing.T) {
	path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/pipeline/preview"
	auth := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": "malformed ignored"}
	for _, tc := range []struct {
		name    string
		headers map[string]string
		err     error
		status  int
		calls   int
	}{
		{"success without preconditions", auth, nil, 200, 1},
		{"unauthenticated", nil, nil, 401, 0},
		{"candidate", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": "candidate"}, nil, 403, 0},
		{"foreign", auth, drafts.ErrNotFound, 404, 1},
		{"cutoff", auth, pc.ErrCutoffStageInUse, 409, 1},
		{"occupied", auth, &pc.Occupied{StageIDs: []string{"a", "b"}}, 409, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stage := pc.Stage{ID: "server-id", Kind: "custom", Name: "Interview"}
			impact := pc.EmptyImpact()
			impact.NotApplicable = append(impact.NotApplicable, pc.NotApplicable{ParticipationID: "p", Candidate: pc.Candidate{ID: "c", FullName: "Candidate"}, StageID: stage.ID})
			s := &pipelineRouteStore{err: tc.err, preview: pc.Preview{Stages: []pc.Stage{stage}, Impact: impact, HasImpact: true}}
			rec := doRouteRequest(t, pipelineRoutesRouter(s), "POST", path, `{"stages":[],"exit":{}}`, tc.headers)
			assertDraftRouteNoStore(t, rec)
			if rec.Code != tc.status || len(s.previews) != tc.calls || rec.Header().Get("ETag") != "" {
				t.Fatal(rec.Code, rec.Body.String(), s.previews)
			}
			if rec.Code == 200 {
				var obj map[string]any
				_ = json.Unmarshal(rec.Body.Bytes(), &obj)
				if len(obj) != 4 || obj["has_impact"] != true || obj["recovery_reassigned"] == nil {
					t.Fatal(obj)
				}
				stages := obj["stages"].([]any)
				mark := obj["not_applicable"].([]any)[0].(map[string]any)
				if len(stages[0].(map[string]any)) != 3 || len(mark) != 3 || len(mark["candidate"].(map[string]any)) != 2 || mark["stage_id"] != stages[0].(map[string]any)["id"] {
					t.Fatal(obj)
				}
				if !reflect.DeepEqual(s.previews[0].body, []byte(`{"stages":[],"exit":{}}`)) || s.previews[0].companyID != routeTestCompanyID || s.previews[0].actorID != routeTestActorID {
					t.Fatal(s.previews)
				}
			}
			if tc.name == "occupied" {
				var obj map[string]any
				_ = json.Unmarshal(rec.Body.Bytes(), &obj)
				if len(obj) != 3 || !reflect.DeepEqual(obj["details"], []any{map[string]any{"stage_id": "a"}, map[string]any{"stage_id": "b"}}) {
					t.Fatal(obj)
				}
			}
		})
	}
}
