package http

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftlist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

const draftListPath = "/v2/me/company/job-drafts"

var (
	listDraftID     = uuid.MustParse("55555555-5555-5555-5555-555555555555")
	listPrincipalID = uuid.MustParse("66666666-6666-6666-6666-666666666666")
)

// fakeDraftLister records the last call and returns canned results.
type fakeDraftLister struct {
	calls     int
	companyID uuid.UUID
	actorID   uuid.UUID
	req       draftlist.Request

	page draftlist.Page
	err  error
}

func (f *fakeDraftLister) ListV2(_ context.Context, companyID, actorID uuid.UUID, req draftlist.Request) (draftlist.Page, error) {
	f.calls++
	f.companyID, f.actorID, f.req = companyID, actorID, req
	return f.page, f.err
}

func draftListRouter(lister draftlist.Lister, withContext bool) http.Handler {
	handler := NewDraftListHandler(lister).ListDrafts
	r := chi.NewRouter()
	r.Use(NoStore)
	if withContext {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				ctx := identitysecurity.ContextWithCompanyContext(req.Context(), identitysecurity.CompanyContext{
					CompanyID: reqCompanyID, UserID: reqUserID, Role: companiesvalueobjects.RecruiterRole,
				})
				next.ServeHTTP(w, req.WithContext(ctx))
			})
		})
	}
	r.Get(draftListPath, handler)
	return r
}

func TestListDrafts_Success(t *testing.T) {
	created := time.Date(2026, 10, 1, 9, 0, 0, 1000, time.UTC)
	updated := time.Date(2026, 10, 15, 12, 30, 45, 123456000, time.UTC)
	reqID := reqEntryID.String()
	store := &fakeDraftLister{page: draftlist.Page{
		Items: []draftlist.Item{
			{
				ID:        listDraftID,
				Title:     strPtr("Backend Go"),
				Requester: &draftlist.Requester{Kind: "client", ID: &reqID, Name: strPtr("Acme")},
				Principal: draftlist.Principal{ID: listPrincipalID, Name: strPtr("Ana Pérez")},
				Version:   7,
				CreatedAt: created,
				UpdatedAt: updated,
			},
			{
				ID:        reqEntryID,
				Requester: &draftlist.Requester{Kind: "internal_area"},
				Principal: draftlist.Principal{ID: listPrincipalID},
				Version:   1,
				CreatedAt: created,
				UpdatedAt: created,
			},
			{
				ID:        reqUserID,
				Principal: draftlist.Principal{ID: listPrincipalID},
				Version:   2,
				CreatedAt: created,
				UpdatedAt: created,
			},
		},
		NextCursor: "next-token",
	}}
	rec := doDraft(t, draftListRouter(store, true), http.MethodGet, draftListPath, nil, nil)
	assertNoStore(t, rec)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q", got)
	}
	want := `{"items":[` +
		`{"id":"55555555-5555-5555-5555-555555555555","title":"Backend Go","requester":{"kind":"client","id":"44444444-4444-4444-4444-444444444444","name":"Acme"},"principal_recruiter":{"id":"66666666-6666-6666-6666-666666666666","name":"Ana Pérez"},"version":"7","created_at":"2026-10-01T09:00:00.000001Z","updated_at":"2026-10-15T12:30:45.123456Z"},` +
		`{"id":"44444444-4444-4444-4444-444444444444","title":null,"requester":{"kind":"internal_area","id":null,"name":null},"principal_recruiter":{"id":"66666666-6666-6666-6666-666666666666","name":null},"version":"1","created_at":"2026-10-01T09:00:00.000001Z","updated_at":"2026-10-01T09:00:00.000001Z"},` +
		`{"id":"33333333-3333-3333-3333-333333333333","title":null,"requester":null,"principal_recruiter":{"id":"66666666-6666-6666-6666-666666666666","name":null},"version":"2","created_at":"2026-10-01T09:00:00.000001Z","updated_at":"2026-10-01T09:00:00.000001Z"}` +
		`],"next_cursor":"next-token"}` + "\n"
	if rec.Body.String() != want {
		t.Fatalf("body =\n%s\nwant\n%s", rec.Body.String(), want)
	}
	if store.calls != 1 || store.companyID != reqCompanyID || store.actorID != reqUserID {
		t.Fatalf("store call = %d company=%s actor=%s", store.calls, store.companyID, store.actorID)
	}
	if store.req.Limit != draftlist.DefaultLimit || store.req.After != nil {
		t.Fatalf("request = %+v, want default limit and no cursor", store.req)
	}
}

func TestListDrafts_EmptyPage(t *testing.T) {
	store := &fakeDraftLister{}
	rec := doDraft(t, draftListRouter(store, true), http.MethodGet, draftListPath+"?limit=50&unknown=x", nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", rec.Code, rec.Body.String())
	}
	if got, want := rec.Body.String(), `{"items":[],"next_cursor":null}`+"\n"; got != want {
		t.Fatalf("body = %s, want %s", got, want)
	}
	if store.req.Limit != 50 {
		t.Fatalf("limit = %d, want 50", store.req.Limit)
	}
}

func TestListDrafts_ForwardsValidCursor(t *testing.T) {
	cursor := draftlist.Cursor{
		CompanyID: reqCompanyID, ActorID: reqUserID,
		LastUpdatedAt: time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC), LastID: listDraftID,
	}
	token, err := draftlist.EncodeCursor(cursor)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	store := &fakeDraftLister{}
	rec := doDraft(t, draftListRouter(store, true), http.MethodGet, draftListPath+"?limit=2&cursor="+token, nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", rec.Code, rec.Body.String())
	}
	if store.req.Limit != 2 || store.req.After == nil || *store.req.After != cursor {
		t.Fatalf("request = %+v, want limit 2 and the cursor", store.req)
	}
}

func TestListDrafts_RejectsMalformedQuery(t *testing.T) {
	valid := draftlist.Cursor{CompanyID: reqCompanyID, ActorID: reqUserID, LastUpdatedAt: time.Unix(0, 0), LastID: listDraftID}
	good, _ := draftlist.EncodeCursor(valid)
	otherCompany := valid
	otherCompany.CompanyID = listPrincipalID
	otherCompanyToken, _ := draftlist.EncodeCursor(otherCompany)
	otherActor := valid
	otherActor.ActorID = listPrincipalID
	otherActorToken, _ := draftlist.EncodeCursor(otherActor)

	for name, query := range map[string]string{
		"limit zero":      "?limit=0",
		"limit too big":   "?limit=51",
		"limit text":      "?limit=abc",
		"limit repeated":  "?limit=1&limit=2",
		"cursor empty":    "?cursor=",
		"cursor garbage":  "?cursor=%25%25",
		"cursor repeated": "?cursor=" + good + "&cursor=" + good,
		"other company":   "?cursor=" + otherCompanyToken,
		"other actor":     "?cursor=" + otherActorToken,
	} {
		t.Run(name, func(t *testing.T) {
			store := &fakeDraftLister{}
			rec := doDraft(t, draftListRouter(store, true), http.MethodGet, draftListPath+query, nil, nil)
			assertNoStore(t, rec)
			assertCatalogError(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
			if store.calls != 0 {
				t.Fatalf("store called %d times for rejected input", store.calls)
			}
		})
	}
}

func TestListDrafts_StoreErrors(t *testing.T) {
	for name, tc := range map[string]struct {
		err    error
		status int
		code   httpjson.Code
	}{
		"unauthenticated":    {drafts.ErrUnauthenticated, http.StatusUnauthorized, httpjson.CodeUnauthenticated},
		"forbidden":          {drafts.ErrForbidden, http.StatusForbidden, httpjson.CodeForbidden},
		"company inactive":   {drafts.ErrCompanyInactive, http.StatusForbidden, httpjson.CodeCompanyInactive},
		"company not active": {drafts.ErrCompanyNotActive, http.StatusConflict, httpjson.CodeCompanyNotActive},
		"unexpected":         {errors.New("boom"), http.StatusInternalServerError, httpjson.CodeInternalError},
	} {
		t.Run(name, func(t *testing.T) {
			rec := doDraft(t, draftListRouter(&fakeDraftLister{err: tc.err}, true), http.MethodGet, draftListPath, nil, nil)
			assertNoStore(t, rec)
			assertCatalogError(t, rec, tc.status, tc.code)
		})
	}
}

func TestListDrafts_MissingCompanyContextFailsClosed(t *testing.T) {
	store := &fakeDraftLister{}
	rec := doDraft(t, draftListRouter(store, false), http.MethodGet, draftListPath, nil, nil)
	assertCatalogError(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)
	if store.calls != 0 {
		t.Fatalf("store called without company context")
	}
}
