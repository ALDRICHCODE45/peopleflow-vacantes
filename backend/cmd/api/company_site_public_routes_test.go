package main

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	siteshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/infrastructure/http"
	"github.com/google/uuid"
)

type sitePublicStub struct {
	out   app.PublicSnapshot
	err   error
	calls int
}

func (s *sitePublicStub) Public(context.Context, string) (app.PublicSnapshot, error) {
	s.calls++
	return s.out, s.err
}

func sitePublicKeys(t *testing.T, value map[string]json.RawMessage, keys ...string) {
	t.Helper()
	if len(value) != len(keys) {
		t.Fatalf("unexpected keys: %v", value)
	}
	for _, key := range keys {
		if _, ok := value[key]; !ok {
			t.Fatalf("missing %s: %v", key, value)
		}
	}
}

func TestCompanySitePublicAnonymousShapeAndErrors(t *testing.T) {
	id := uuid.New()
	stub := &sitePublicStub{out: app.PublicSnapshot{CompanyID: id, Slug: "current-slug", Site: json.RawMessage(`{"theme":{},"seo":{},"blocks":[]}`), PublishedAt: time.Date(2026, 10, 27, 0, 0, 0, 0, time.UTC), Media: []app.Media{{ID: id, Kind: "cover", URL: "/v2/company-sites/media/" + id.String(), Width: 400, Height: 300}}}}
	companyErr := error(nil)
	handler := siteshttp.New(nil, nil, nil).WithPublic(stub, func(context.Context, uuid.UUID) (app.PublicCompany, error) {
		return app.PublicCompany{ID: id, Name: "Public name"}, companyErr
	})
	router := newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRequireAuth, requireOwner: routeRequireAuth, siteHandler: handler})
	get := func(slug string) (int, string, string) {
		w := doRouteRequest(t, router, "GET", "/v2/company-sites/"+slug, "", nil)
		return w.Code, w.Header().Get("Cache-Control"), w.Body.String()
	}
	for _, slug := range []string{"current-slug", "old-slug"} {
		status, cache, body := get(slug)
		if status != 200 || cache != "public, max-age=60" {
			t.Fatalf("%d %s %s", status, cache, body)
		}
		var envelope map[string]json.RawMessage
		if err := json.Unmarshal([]byte(body), &envelope); err != nil {
			t.Fatal(err)
		}
		sitePublicKeys(t, envelope, "company", "site", "slug", "published_at", "media")
		var company, site map[string]json.RawMessage
		_ = json.Unmarshal(envelope["company"], &company)
		_ = json.Unmarshal(envelope["site"], &site)
		sitePublicKeys(t, company, "id", "name", "logo_url", "description", "website", "linkedin_url", "instagram_url", "facebook_url", "twitter_url", "location")
		sitePublicKeys(t, site, "theme", "seo", "blocks")
		var media []map[string]json.RawMessage
		_ = json.Unmarshal(envelope["media"], &media)
		sitePublicKeys(t, media[0], "id", "kind", "url", "width", "height")
		if string(envelope["slug"]) != `"current-slug"` {
			t.Fatal(body)
		}
	}
	stub.err = app.ErrSiteNotFound
	_, _, notFound := get("unknown-slug")
	for _, slug := range []string{"unknown-slug", "never-published", "unpublished", "ab", "INVALID", "invalid--slug"} {
		before := stub.calls
		status, cache, body := get(slug)
		if status != 404 || cache != "no-store" || body != notFound {
			t.Fatalf("%d %s %s", status, cache, body)
		}
		if app.SlugReason(slug) != "" && before != stub.calls {
			t.Fatal("invalid slug reached store")
		}
	}
	stub.err = nil
	companyErr = app.ErrSiteNotFound
	status, cache, body := get("deleted-company")
	if status != 404 || cache != "no-store" || body != notFound {
		t.Fatal(status, cache, body)
	}
	companyErr = nil
	stub.err = errors.New("private database details")
	status, cache, body = get("valid-slug")
	if status != 500 || cache != "no-store" || body == stub.err.Error() {
		t.Fatal(status, cache, body)
	}
}
