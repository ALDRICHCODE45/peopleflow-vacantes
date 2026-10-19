package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/fulfillment"
	"github.com/google/uuid"
)

func (s *deliveryRouteStore) GetDeliveryStatus(_ context.Context, company, actor, id uuid.UUID) (fulfillment.Status, error) {
	s.gets = append(s.gets, routeGetCall{companyID: company, actorID: actor, id: id})
	remaining := 1
	return fulfillment.Status{State: "pending", Target: 5, CutoffStageID: uuid.NewString(), CommitmentDate: "2026-11-30", BusinessDaysRemaining: &remaining}, s.err
}
func (s *deliveryRouteStore) PreviewDelivery(_ context.Context, company, actor, id uuid.UUID, body []byte) (fulfillment.Preview, error) {
	s.puts = append(s.puts, routeSaveCall{companyID: company, actorID: actor, id: id, body: body})
	target := int64(5)
	return fulfillment.Preview{Target: &target, Candidates: []fulfillment.Candidate{}}, s.err
}
func TestFulfillmentPreviewIgnoresIfMatchAndKeepsBodyBudget(t *testing.T) {
	path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/pipeline/delivery/preview"
	auth := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": "malformed and irrelevant"}
	s := &deliveryRouteStore{}
	r := doRouteRequest(t, deliveryRoutesRouter(s), "POST", path, `{}`, auth)
	if r.Code != 200 || len(s.puts) != 1 || s.puts[0].present || s.puts[0].ifMatch != "" {
		t.Fatal(r.Code, r.Body.String())
	}
	s = &deliveryRouteStore{}
	r = doRouteRequest(t, deliveryRoutesRouter(s), "POST", path, strings.Repeat("x", 1048577), auth)
	var root map[string]any
	if err := json.Unmarshal(r.Body.Bytes(), &root); err != nil || r.Code != 413 || root["code"] != "payload_too_large" || len(s.puts) != 0 || r.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(r.Code, r.Body.String(), err)
	}
}

func TestFulfillmentRoutesGatesErrorsAndNoPrecondition(t *testing.T) {
	path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/pipeline/delivery"
	auth := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	for _, tc := range []struct {
		name, method, suffix string
		err                  error
		status               int
		code                 string
	}{
		{"status", "GET", "/status", nil, 200, ""}, {"preview no If-Match", "POST", "/preview", nil, 200, ""},
		{"draft", "GET", "/status", fulfillment.ErrNotPublished, 409, "vacancy_not_published"},
		{"draft preview", "POST", "/preview", fulfillment.ErrNotPublished, 409, "vacancy_not_published"},
		{"foreign status", "GET", "/status", drafts.ErrNotFound, 404, "not_found"},
		{"foreign preview", "POST", "/preview", drafts.ErrNotFound, 404, "not_found"},
		{"preview invalid", "POST", "/preview", drafts.ErrInvalidRequest, 400, "invalid_request"},
		{"preview validation", "POST", "/preview", drafts.ErrValidation, 400, "validation_error"},
		{"preview holiday", "POST", "/preview", deliveryconfig.ErrNonBusinessDate, 400, "non_business_date"},
		{"frozen preview", "POST", "/preview", fulfillment.ErrFulfilled, 409, "delivery_fulfilled"},
		{"confirmation", "PUT", "", fulfillment.ErrConfirmationRequired, 409, "fulfillment_confirmation_required"},
		{"wrapped freeze", "PUT", "", errors.Join(errors.New("private"), fulfillment.ErrFulfilled), 409, "delivery_fulfilled"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &deliveryRouteStore{err: tc.err}
			r := doRouteRequest(t, deliveryRoutesRouter(s), tc.method, path+tc.suffix, `{}`, auth)
			if r.Code != tc.status || r.Header().Get("Cache-Control") != "no-store" || len(s.gets)+len(s.puts) != 1 {
				t.Fatal(r.Code, r.Body.String(), len(s.gets)+len(s.puts))
			}
			if tc.err == nil {
				var root map[string]json.RawMessage
				if err := json.Unmarshal(r.Body.Bytes(), &root); err != nil {
					t.Fatal(err)
				}
				keys := []string{"state", "delivered", "target", "cutoff_stage_id", "commitment_date", "business_days_remaining", "fulfillment"}
				if tc.suffix == "/preview" {
					keys = []string{"would_fulfill", "delivered", "target", "candidates"}
				}
				if len(root) != len(keys) {
					t.Fatal(r.Body.String())
				}
				for _, key := range keys {
					if root[key] == nil {
						t.Fatal("missing key", key)
					}
				}
			}
			if tc.suffix == "/status" {
				call := s.gets[0]
				if call.companyID != routeTestCompanyID || call.actorID != routeTestActorID || call.id != routeTestDraftID {
					t.Fatal(call)
				}
			}
			if tc.suffix == "/preview" {
				call := s.puts[0]
				if call.companyID != routeTestCompanyID || call.actorID != routeTestActorID || call.id != routeTestDraftID || string(call.body) != `{}` || call.present {
					t.Fatal(call)
				}
			}
			if tc.code != "" {
				var obj map[string]any
				if err := json.Unmarshal(r.Body.Bytes(), &obj); err != nil || len(obj) != 2 || obj["code"] != tc.code {
					t.Fatal(r.Body.String(), err)
				}
			}
			if tc.suffix != "" && r.Header().Get("ETag") != "" {
				t.Fatal("unexpected precondition")
			}
		})
	}
	for _, suffix := range []string{"/status", "/preview"} {
		method := "GET"
		if suffix == "/preview" {
			method = "POST"
		}
		for _, headers := range []map[string]string{nil, {"X-Test-Sub": "sub", "X-Test-Role": "candidate"}} {
			r := doRouteRequest(t, deliveryRoutesRouter(&deliveryRouteStore{}), method, path+suffix, `{}`, headers)
			if (r.Code != 401 && r.Code != 403) || r.Header().Get("Cache-Control") != "no-store" {
				t.Fatal(r.Code, r.Body.String())
			}
		}
	}
}
