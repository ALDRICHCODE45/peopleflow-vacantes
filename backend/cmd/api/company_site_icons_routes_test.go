package main

import (
	"encoding/json"
	"testing"

	roles "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	siteshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/infrastructure/http"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/google/uuid"
)

func TestCompanySiteIconEmojiRouteErrors(t *testing.T) {
	for _, tc := range []struct {
		item      map[string]any
		key, code string
	}{
		{map[string]any{}, "icon", "required"},
		{map[string]any{"icon": "heart", "emoji": "😀"}, "emoji", "not_allowed"},
		{map[string]any{"emoji": "a"}, "emoji", "invalid"},
	} {
		value, err := draftjson.Decode(app.DefaultDocument())
		if err != nil {
			t.Fatal(err)
		}
		m := value.(map[string]any)
		m["blocks"] = append(m["blocks"].([]any), map[string]any{"id": uuid.NewString(), "type": "benefits", "variant": "grid", "hidden": false, "content": map[string]any{"items": []any{tc.item}}})
		raw, err := json.Marshal(m)
		if err != nil {
			t.Fatal(err)
		}
		s := &siteRouteStore{}
		router := newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(roles.RecruiterRole, "recruiter"), requireOwner: routeRoleGate(roles.OwnerRole, "owner"), siteHandler: siteshttp.New(s, draftjson.Decode, companySiteValidator())})
		w := doRouteRequest(t, router, "PUT", "/v2/me/company/site/draft", string(raw), map[string]string{"X-Test-Sub": "s", "X-Test-Role": "recruiter", "If-Match": `"1"`})
		if w.Code != 400 || routeCatalogCode(t, w) != "validation_error" || s.calls != 0 {
			t.Fatal(w.Code, w.Body, s.calls)
		}
		var body struct {
			Fields []app.Field `json:"fields"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if len(body.Fields) != 1 || body.Fields[0].Field != "blocks[2].content.items[0]."+tc.key || body.Fields[0].Code != tc.code {
			t.Fatal(w.Body)
		}
	}
}
