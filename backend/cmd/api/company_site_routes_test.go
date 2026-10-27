package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	roles "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	siteshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/infrastructure/http"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/google/uuid"
)

type siteRouteStore struct {
	err   error
	calls int
}

func (s *siteRouteStore) Get(context.Context, uuid.UUID, uuid.UUID) (app.Current, error) {
	s.calls++
	return app.Current{Draft: app.DefaultDocument(), DraftVersion: 2, Media: []app.Media{}}, s.err
}
func (s *siteRouteStore) Save(context.Context, uuid.UUID, uuid.UUID, int64, *app.Document) (app.Current, error) {
	s.calls++
	return app.Current{Draft: app.DefaultDocument(), DraftVersion: 2, Media: []app.Media{}}, s.err
}
func (s *siteRouteStore) Publish(ctx context.Context, company, user uuid.UUID, version int64) (app.Current, error) {
	return s.Get(ctx, company, user)
}
func (s *siteRouteStore) Unpublish(ctx context.Context, company, user uuid.UUID) (app.Current, error) {
	return s.Get(ctx, company, user)
}
func (s *siteRouteStore) SlugAvailable(context.Context, uuid.UUID, string) (bool, error) {
	s.calls++
	return true, nil
}
func TestCompanySiteRealRichWiring(t *testing.T) {
	for _, tt := range []struct {
		name      string
		n         int
		malformed bool
		status    int
		fieldCode string
	}{
		{name: "boundary", n: 5000, status: 200},
		{name: "over", n: 5001, status: 400, fieldCode: "too_long"},
		{name: "invalid grammar", n: 1, malformed: true, status: 400, fieldCode: "invalid"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			value, err := draftjson.Decode(app.DefaultDocument())
			if err != nil {
				t.Fatal(err)
			}
			m := value.(map[string]any)
			kind := "paragraph"
			if tt.malformed {
				kind = "script"
			}
			rich := fmt.Sprintf(`{"schema_version":1,"document":{"type":"doc","content":[{"type":%q,"content":[{"type":"text","text":%q}]}]}}`, kind, strings.Repeat("界", tt.n))
			m["blocks"] = append(m["blocks"].([]any), map[string]any{"id": uuid.NewString(), "type": "story", "variant": "text", "hidden": false, "content": map[string]any{"body": json.RawMessage(rich)}})
			raw, err := json.Marshal(m)
			if err != nil {
				t.Fatal(err)
			}
			s := &siteRouteStore{}
			router := newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(roles.RecruiterRole, "recruiter"), requireOwner: routeRoleGate(roles.OwnerRole, "owner"), siteHandler: siteshttp.New(s, draftjson.Decode, companySiteValidator())})
			w := doRouteRequest(t, router, "PUT", "/v2/me/company/site/draft", string(raw), map[string]string{"X-Test-Sub": "s", "X-Test-Role": "recruiter", "If-Match": `"1"`})
			if w.Code != tt.status {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
			if tt.fieldCode != "" {
				var envelope struct {
					Fields []app.Field `json:"fields"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
					t.Fatal(err)
				}
				if len(envelope.Fields) != 1 || envelope.Fields[0].Field != "blocks[2].content.body" || envelope.Fields[0].Code != tt.fieldCode {
					t.Fatal(w.Body)
				}
				if s.calls != 0 {
					t.Fatal("invalid body reached store")
				}
			}
		})
	}
}

func TestCompanySiteRoutes(t *testing.T) {
	for _, tt := range []struct {
		name, method, path, body, sub, role, match string
		err                                        error
		status                                     int
		code, tag                                  string
	}{
		{name: "media unauthenticated", method: "POST", path: "/v2/me/company/site/media", status: 401, code: "unauthenticated"},
		{name: "media forbidden", method: "POST", path: "/v2/me/company/site/media", sub: "s", role: "candidate", status: 403, code: "forbidden"},
		{name: "media unavailable", method: "POST", path: "/v2/me/company/site/media", sub: "s", role: "recruiter", status: 503, code: "cv_storage_unavailable"},
		{name: "publish owner", method: "POST", path: "/v2/me/company/site/publish", sub: "s", role: "owner", match: `"2"`, status: 200, tag: `"2"`},
		{name: "publish recruiter", method: "POST", path: "/v2/me/company/site/publish", sub: "s", role: "recruiter", status: 403, code: "forbidden"},
		{name: "unpublish recruiter", method: "POST", path: "/v2/me/company/site/unpublish", sub: "s", role: "recruiter", status: 403, code: "forbidden"},
		{name: "publish missing match", method: "POST", path: "/v2/me/company/site/publish", sub: "s", role: "owner", status: 428, code: "precondition_required"},
		{name: "publish stale", method: "POST", path: "/v2/me/company/site/publish", sub: "s", role: "owner", match: `"1"`, err: app.ErrVersionConflict, status: 412, code: "version_conflict", tag: `"2"`},
		{name: "unpublish owner", method: "POST", path: "/v2/me/company/site/unpublish", sub: "s", role: "owner", status: 200, tag: `"2"`},
		{name: "publish unauthenticated", method: "POST", path: "/v2/me/company/site/publish", status: 401, code: "unauthenticated"},
		{name: "get", method: "GET", path: "/v2/me/company/site", sub: "s", role: "recruiter", status: 200, tag: `"2"`},
		{name: "availability", method: "GET", path: "/v2/me/company/site/slug-availability?slug=abc", sub: "s", role: "recruiter", status: 200},
		{name: "401", method: "GET", path: "/v2/me/company/site", status: 401, code: "unauthenticated"},
		{name: "403", method: "PUT", path: "/v2/me/company/site/draft", sub: "s", role: "candidate", status: 403, code: "forbidden"},
		{name: "428", method: "PUT", path: "/v2/me/company/site/draft", sub: "s", role: "recruiter", body: string(app.DefaultDocument()), status: 428, code: "precondition_required"},
		{name: "412", method: "PUT", path: "/v2/me/company/site/draft", sub: "s", role: "recruiter", body: string(app.DefaultDocument()), match: `"1"`, err: app.ErrVersionConflict, status: 412, code: "version_conflict", tag: `"2"`},
		{name: "413", method: "PUT", path: "/v2/me/company/site/draft", sub: "s", role: "recruiter", body: strings.Repeat(" ", 1<<20) + "x", match: `"1"`, status: 413, code: "payload_too_large"},
		{name: "duplicate keys", method: "PUT", path: "/v2/me/company/site/draft", sub: "s", role: "recruiter", body: `{"slug":null,"slug":null}`, match: `"1"`, status: 400, code: "invalid_request"},
		{name: "put", method: "PUT", path: "/v2/me/company/site/draft", sub: "s", role: "recruiter", body: string(app.DefaultDocument()), match: `"1"`, status: 200, tag: `"2"`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			s := &siteRouteStore{err: tt.err}
			r := newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(roles.RecruiterRole, "recruiter"), requireOwner: routeRoleGate(roles.OwnerRole, "owner"), siteHandler: siteshttp.New(s, draftjson.Decode, companySiteValidator())})
			w := doRouteRequest(t, r, tt.method, tt.path, tt.body, map[string]string{"X-Test-Sub": tt.sub, "X-Test-Role": tt.role, "If-Match": tt.match})
			if w.Code != tt.status || w.Header().Get("ETag") != tt.tag {
				t.Fatalf("%d %s %s", w.Code, w.Header(), w.Body)
			}
			assertDraftRouteNoStore(t, w)
			if tt.code != "" && routeCatalogCode(t, w) != tt.code {
				t.Fatal(w.Body)
			}
			if (tt.status == 401 || tt.status == 403 || tt.status == 428 || tt.status == 413) && s.calls != 0 {
				t.Fatal("store called before boundary checks")
			}
			if tt.status == http.StatusOK && s.calls != 1 {
				t.Fatal("handler not reached")
			}
		})
	}
}

// The public projection of a published snapshot with a visible story body goes
// through the real draftjson + draftrich wiring exactly as GET /v2/company-sites does.
func TestCompanySitePublicProjectionRealRichWiring(t *testing.T) {
	stored := `{"slug":"nexo","theme":{"brand_color":"#7835DB","font_pair":"classic"},"seo":{"title":null,"description":null},"blocks":[` +
		`{"id":"` + uuid.NewString() + `","type":"hero","variant":"photo","hidden":false,"content":{"title":"Trabaja en Nexo","subtitle":null,"cover":null}},` +
		`{"id":"` + uuid.NewString() + `","type":"jobs","variant":"list","hidden":false,"content":{"title":null,"intro":null}},` +
		`{"id":"` + uuid.NewString() + `","type":"story","variant":"text","hidden":false,"content":{"title":"Historia","image":null,"body":{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Construimos oportunidades reales."}]}]}}}},` +
		`{"id":"` + uuid.NewString() + `","type":"closing","variant":"banner","hidden":true,"content":{"title":null,"text":null}}]}`
	value, err := draftjson.Decode([]byte(stored))
	if err != nil {
		t.Fatal(err)
	}
	doc, err := companySiteValidator().VisibleDocument(value)
	if err != nil {
		t.Fatalf("visible document: %v", err)
	}
	if strings.Contains(string(doc.Canonical), `"slug"`) || strings.Contains(string(doc.Canonical), `"closing"`) || !strings.Contains(string(doc.Canonical), "Construimos oportunidades reales.") {
		t.Fatalf("canonical: %s", doc.Canonical)
	}
}
