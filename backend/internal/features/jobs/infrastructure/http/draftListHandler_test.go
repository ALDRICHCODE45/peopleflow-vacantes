package http

import (
	"context"
	"errors"
	"fmt"
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
				WorkMode:  strPtr("remote"),
				Schedule:  strPtr("full_time"),
				Requester: &draftlist.Requester{Kind: "client", ID: &reqID, Name: strPtr("Acme")},
				Principal: draftlist.Principal{ID: listPrincipalID, Name: strPtr("Ana Pérez")},
				Version:   7,
				Status:    "draft",
				CreatedAt: created,
				UpdatedAt: updated,
			},
			{
				ID:        reqEntryID,
				Requester: &draftlist.Requester{Kind: "internal_area"},
				Principal: draftlist.Principal{ID: listPrincipalID},
				Version:   1,
				Status:    "draft",
				CreatedAt: created,
				UpdatedAt: created,
			},
			{
				ID:        reqUserID,
				Principal: draftlist.Principal{ID: listPrincipalID},
				Version:   2,
				Status:    "draft",
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
		`{"id":"55555555-5555-5555-5555-555555555555","title":"Backend Go","work_mode":"remote","work_schedule":"full_time","requester":{"kind":"client","id":"44444444-4444-4444-4444-444444444444","name":"Acme"},"principal_recruiter":{"id":"66666666-6666-6666-6666-666666666666","name":"Ana Pérez"},"version":"7","process":null,"status":"draft","published_at":null,"paused_at":null,"closed_at":null,"process_finished_at":null,"candidates":null,"created_at":"2026-10-01T09:00:00.000001Z","updated_at":"2026-10-15T12:30:45.123456Z"},` +
		`{"id":"44444444-4444-4444-4444-444444444444","title":null,"work_mode":null,"work_schedule":null,"requester":{"kind":"internal_area","id":null,"name":null},"principal_recruiter":{"id":"66666666-6666-6666-6666-666666666666","name":null},"version":"1","process":null,"status":"draft","published_at":null,"paused_at":null,"closed_at":null,"process_finished_at":null,"candidates":null,"created_at":"2026-10-01T09:00:00.000001Z","updated_at":"2026-10-01T09:00:00.000001Z"},` +
		`{"id":"33333333-3333-3333-3333-333333333333","title":null,"work_mode":null,"work_schedule":null,"requester":null,"principal_recruiter":{"id":"66666666-6666-6666-6666-666666666666","name":null},"version":"2","process":null,"status":"draft","published_at":null,"paused_at":null,"closed_at":null,"process_finished_at":null,"candidates":null,"created_at":"2026-10-01T09:00:00.000001Z","updated_at":"2026-10-01T09:00:00.000001Z"}` +
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

func TestListDrafts_CandidatesExactWire(t *testing.T) {
	for _, tc := range []struct {
		name, process, status                 string
		total, inProcess, discarded, newCount int64
	}{
		{"published empty", "active", "published", 0, 0, 0, 0},
		{"finished live counts", "finished", "closed", 5, 2, 1, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			at := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
			store := &fakeDraftLister{page: draftlist.Page{Items: []draftlist.Item{{
				ID: listDraftID, Principal: draftlist.Principal{ID: listPrincipalID}, Version: 1,
				Process: strPtr(tc.process), Status: tc.status, PublishedAt: &at, CreatedAt: at, UpdatedAt: at,
				Candidates: &draftlist.Candidates{Total: tc.total, InProcess: tc.inProcess, Discarded: tc.discarded, ByStage: []draftlist.CandidateStage{
					{ID: reqEntryID.String(), Kind: "new", Name: "Nuevos", Count: tc.newCount},
					{ID: reqUserID.String(), Kind: "custom", Name: "Prueba técnica", Count: tc.inProcess},
					{ID: listPrincipalID.String(), Kind: "placement", Name: "Placement", Count: 0},
				}},
			}}}}
			rec := doDraft(t, draftListRouter(store, true), http.MethodGet, draftListPath, nil, nil)
			want := fmt.Sprintf(`{"items":[{"id":"55555555-5555-5555-5555-555555555555","title":null,"work_mode":null,"work_schedule":null,"requester":null,"principal_recruiter":{"id":"66666666-6666-6666-6666-666666666666","name":null},"version":"1","process":"%s","status":"%s","published_at":"2026-10-01T09:00:00.000000Z","paused_at":null,"closed_at":null,"process_finished_at":null,"candidates":{"total":%d,"in_process":%d,"discarded":%d,"by_stage":[{"id":"44444444-4444-4444-4444-444444444444","kind":"new","name":"Nuevos","count":%d},{"id":"33333333-3333-3333-3333-333333333333","kind":"custom","name":"Prueba técnica","count":%d},{"id":"66666666-6666-6666-6666-666666666666","kind":"placement","name":"Placement","count":0}]},"created_at":"2026-10-01T09:00:00.000000Z","updated_at":"2026-10-01T09:00:00.000000Z"}],"next_cursor":null}`+"\n", tc.process, tc.status, tc.total, tc.inProcess, tc.discarded, tc.newCount, tc.inProcess)
			if rec.Code != http.StatusOK || rec.Body.String() != want {
				t.Fatalf("status=%d body=%s want=%s", rec.Code, rec.Body.String(), want)
			}
			assertNoStore(t, rec)
			if store.calls != 1 {
				t.Fatalf("ListV2 calls=%d", store.calls)
			}
		})
	}
}

func TestListDrafts_LifecycleDatesExactWire(t *testing.T) {
	published := time.Date(2026, 10, 1, 9, 0, 0, 1000, time.UTC)
	paused := time.Date(2026, 10, 16, 12, 34, 56, 123456789, time.FixedZone("Mexico", -6*60*60))
	closed, finished := paused.Add(time.Hour), paused.Add(2*time.Hour)
	// Reopened publication retains historical transition dates.
	store := &fakeDraftLister{page: draftlist.Page{Items: []draftlist.Item{{
		ID: listDraftID, Principal: draftlist.Principal{ID: listPrincipalID}, Version: 7,
		Process: strPtr("active"), Status: "published", PublishedAt: &published,
		PausedAt: &paused, ClosedAt: &closed, ProcessFinishedAt: &finished,
		CreatedAt: published, UpdatedAt: published,
	}}}}
	rec := doDraft(t, draftListRouter(store, true), http.MethodGet, draftListPath, nil, nil)
	want := `{"items":[{"id":"55555555-5555-5555-5555-555555555555","title":null,"work_mode":null,"work_schedule":null,"requester":null,"principal_recruiter":{"id":"66666666-6666-6666-6666-666666666666","name":null},"version":"7","process":"active","status":"published","published_at":"2026-10-01T09:00:00.000001Z","paused_at":"2026-10-16T18:34:56.123456Z","closed_at":"2026-10-16T19:34:56.123456Z","process_finished_at":"2026-10-16T20:34:56.123456Z","candidates":null,"created_at":"2026-10-01T09:00:00.000001Z","updated_at":"2026-10-01T09:00:00.000001Z"}],"next_cursor":null}` + "\n"
	if rec.Code != http.StatusOK || rec.Body.String() != want {
		t.Fatalf("status=%d body=%s want=%s", rec.Code, rec.Body.String(), want)
	}
	assertNoStore(t, rec)
	if store.calls != 1 {
		t.Fatalf("ListV2 calls=%d", store.calls)
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
		"limit zero":                "?limit=0",
		"limit too big":             "?limit=51",
		"limit text":                "?limit=abc",
		"limit repeated":            "?limit=1&limit=2",
		"cursor empty":              "?cursor=",
		"cursor garbage":            "?cursor=%25%25",
		"cursor repeated":           "?cursor=" + good + "&cursor=" + good,
		"cursor bad escape":         "?cursor=%zz",
		"limit bad escape":          "?limit=%zz",
		"limit repeated bad escape": "?limit=1&limit=%zz",
		"unknown bad escape":        "?x=%zz",
		"other company":             "?cursor=" + otherCompanyToken,
		"other actor":               "?cursor=" + otherActorToken,
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
