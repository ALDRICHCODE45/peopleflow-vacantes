package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"testing"

	companies "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publication"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	"github.com/google/uuid"
)

type incompleteDraftSaver struct{ err error }

func (s incompleteDraftSaver) SaveV2(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, bool, []byte) (drafts.Result, error) {
	return drafts.Result{}, s.err
}

func TestPublishedWriteRoutesReuse422MissingEnvelope(t *testing.T) {
	missing := []string{"title_missing", "delivery_target_missing"}
	err := fmt.Errorf("private context: %w", &publication.Incomplete{Missing: missing})
	r := newRouter(routerDeps{
		requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(companies.RecruiterRole, routeTestRecruiterHeader), requireOwner: routeRequireAuth,
		draftV2Handler:    jobshttp.NewDraftV2Handler(nil, nil, incompleteDraftSaver{err: err}),
		deliveryHandler:   jobshttp.NewDeliveryHandler(&deliveryRouteStore{err: err}),
		managementHandler: jobshttp.NewManagementHandler(&managementRouteStore{err: err}),
	})
	for _, tc := range []struct{ method, suffix string }{{"PATCH", ""}, {"PUT", "/pipeline/delivery"}, {"PUT", "/management"}} {
		response := doRouteRequest(t, r, tc.method, "/v2/me/company/job-drafts/"+routeTestDraftID.String()+tc.suffix, `{}`, map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": `"opaque"`})
		assertDraftRouteNoStore(t, response)
		var body map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if response.Code != http.StatusUnprocessableEntity || len(body) != 3 || body["code"] != "publication_incomplete" || !reflect.DeepEqual(body["missing"], []any{"title_missing", "delivery_target_missing"}) || response.Header().Get("ETag") != "" {
			t.Fatalf("%s %s: %d %s", tc.method, tc.suffix, response.Code, response.Body.String())
		}
	}
}
