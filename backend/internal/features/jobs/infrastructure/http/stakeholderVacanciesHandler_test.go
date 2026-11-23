package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"testing"
	"time"

	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftlist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/stakeholdervacancies"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

const stakeholderVacanciesPath = "/v2/me/company/stakeholder/vacancies"

// fakeStakeholderLister records the last call and returns canned results.
type fakeStakeholderLister struct {
	calls     int
	companyID uuid.UUID
	actorID   uuid.UUID
	req       stakeholdervacancies.Request

	page stakeholdervacancies.Page
	err  error
}

func (f *fakeStakeholderLister) ListStakeholderVacancies(_ context.Context, companyID, actorID uuid.UUID, req stakeholdervacancies.Request) (stakeholdervacancies.Page, error) {
	f.calls++
	f.companyID, f.actorID, f.req = companyID, actorID, req
	return f.page, f.err
}

func stakeholderVacanciesRouter(lister stakeholdervacancies.Lister, withContext bool) http.Handler {
	r := chi.NewRouter()
	r.Use(NoStore)
	if withContext {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				ctx := identitysecurity.ContextWithCompanyContext(req.Context(), identitysecurity.CompanyContext{
					CompanyID: reqCompanyID, UserID: reqUserID, Role: companiesvalueobjects.StakeholderRole,
				})
				next.ServeHTTP(w, req.WithContext(ctx))
			})
		})
	}
	r.Get(stakeholderVacanciesPath, NewStakeholderVacanciesHandler(lister).List)
	return r
}

// The wire shape of a row: nine keys, the lifecycle names, nulls as null and the count as a number.
func TestStakeholderVacancies_ExactWire(t *testing.T) {
	covered, required := int64(2), int64(3)
	store := &fakeStakeholderLister{page: stakeholdervacancies.Page{
		Items: []stakeholdervacancies.Row{
			{
				ID: listDraftID, Title: strPtr("Backend Go"), Publication: strPtr("closed"), Process: strPtr("finished"),
				Kind: "replacement", Visibility: strPtr("private"), CloseReason: strPtr("filled"),
				Coverage: &draftlist.Coverage{Covered: covered, Required: &required}, DocumentsCount: 7,
			},
			{
				ID: reqEntryID, Publication: strPtr("published"), Process: strPtr("active"), Kind: "original", Visibility: strPtr("public"),
				Coverage: &draftlist.Coverage{}, DocumentsCount: 0,
			},
			{ID: reqUserID, Kind: "original", DocumentsCount: 1},
		},
		NextCursor: "next-token",
	}}
	rec := doDraft(t, stakeholderVacanciesRouter(store, true), http.MethodGet, stakeholderVacanciesPath, nil, nil)
	assertNoStore(t, rec)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q", got)
	}
	want := `{"items":[` +
		`{"id":"55555555-5555-5555-5555-555555555555","title":"Backend Go","publication":"closed","process":"finished","kind":"replacement","visibility":"private","close_reason":"filled","coverage":{"covered":2,"required":3},"documents_count":7},` +
		`{"id":"44444444-4444-4444-4444-444444444444","title":null,"publication":"published","process":"active","kind":"original","visibility":"public","close_reason":null,"coverage":{"covered":0,"required":null},"documents_count":0},` +
		`{"id":"33333333-3333-3333-3333-333333333333","title":null,"publication":null,"process":null,"kind":"original","visibility":null,"close_reason":null,"coverage":null,"documents_count":1}` +
		`],"next_cursor":"next-token"}` + "\n"
	if rec.Body.String() != want {
		t.Fatalf("body =\n%s\nwant\n%s", rec.Body.String(), want)
	}
	if store.calls != 1 || store.companyID != reqCompanyID || store.actorID != reqUserID {
		t.Fatalf("store call = %d company=%s actor=%s", store.calls, store.companyID, store.actorID)
	}
	if store.req.Limit != draftlist.DefaultLimit || store.req.After != nil {
		t.Fatalf("request = %+v, want the job-drafts default limit and no cursor", store.req)
	}
	var keys struct {
		Items []map[string]json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &keys); err != nil {
		t.Fatal(err)
	}
	for i, item := range keys.Items {
		if len(item) != 9 {
			t.Fatalf("row %d has %d keys: %v", i, len(item), item)
		}
	}
}

func TestStakeholderVacancies_EmptyPageIsAnEmptyArray(t *testing.T) {
	store := &fakeStakeholderLister{}
	rec := doDraft(t, stakeholderVacanciesRouter(store, true), http.MethodGet, stakeholderVacanciesPath+"?limit=50&unknown=x", nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", rec.Code, rec.Body.String())
	}
	if got, want := rec.Body.String(), `{"items":[],"next_cursor":null}`+"\n"; got != want {
		t.Fatalf("body = %s, want %s", got, want)
	}
	if store.req.Limit != draftlist.MaxLimit {
		t.Fatalf("limit = %d, want %d", store.req.Limit, draftlist.MaxLimit)
	}
}

// The cursor is the job-drafts list cursor: same wire, same session scope.
func TestStakeholderVacancies_ForwardsValidCursor(t *testing.T) {
	cursor := draftlist.Cursor{
		CompanyID: reqCompanyID, ActorID: reqUserID,
		LastUpdatedAt: time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC), LastID: listDraftID,
	}
	token, err := draftlist.EncodeCursor(cursor)
	if err != nil {
		t.Fatal(err)
	}
	store := &fakeStakeholderLister{}
	rec := doDraft(t, stakeholderVacanciesRouter(store, true), http.MethodGet, stakeholderVacanciesPath+"?limit=2&cursor="+token, nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", rec.Code, rec.Body.String())
	}
	if store.req.Limit != 2 || store.req.After == nil || !reflect.DeepEqual(*store.req.After, cursor) {
		t.Fatalf("request = %+v, want limit 2 and the cursor", store.req)
	}
}

func TestStakeholderVacancies_RejectsMalformedQuery(t *testing.T) {
	valid := draftlist.Cursor{CompanyID: reqCompanyID, ActorID: reqUserID, LastUpdatedAt: time.Unix(0, 0), LastID: listDraftID}
	good, _ := draftlist.EncodeCursor(valid)
	otherCompany := valid
	otherCompany.CompanyID = listPrincipalID
	otherCompanyToken, _ := draftlist.EncodeCursor(otherCompany)
	otherActor := valid
	otherActor.ActorID = listPrincipalID
	otherActorToken, _ := draftlist.EncodeCursor(otherActor)

	for name, query := range map[string]string{
		"limit zero":         "?limit=0",
		"limit too big":      "?limit=51",
		"limit text":         "?limit=abc",
		"limit repeated":     "?limit=1&limit=2",
		"cursor empty":       "?cursor=",
		"cursor garbage":     "?cursor=%25%25",
		"cursor repeated":    "?cursor=" + good + "&cursor=" + good,
		"cursor bad escape":  "?cursor=%zz",
		"limit bad escape":   "?limit=%zz",
		"unknown bad escape": "?x=%zz",
		"other company":      "?cursor=" + otherCompanyToken,
		"other actor":        "?cursor=" + otherActorToken,
	} {
		t.Run(name, func(t *testing.T) {
			store := &fakeStakeholderLister{}
			rec := doDraft(t, stakeholderVacanciesRouter(store, true), http.MethodGet, stakeholderVacanciesPath+query, nil, nil)
			assertCatalogError(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
			if store.calls != 0 {
				t.Fatalf("store called %d times for rejected input", store.calls)
			}
		})
	}
}

// v1 has no filters: root_process_id is an unknown parameter and is ignored, and a cursor issued for such a filter by the
// job-drafts list is refused exactly like the job-drafts list refuses a cursor of another filter.
func TestStakeholderVacancies_NoFilters(t *testing.T) {
	store := &fakeStakeholderLister{}
	rec := doDraft(t, stakeholderVacanciesRouter(store, true), http.MethodGet, stakeholderVacanciesPath+"?root_process_id="+listDraftID.String()+"&status=closed", nil, nil)
	if rec.Code != http.StatusOK || store.calls != 1 || store.req.After != nil {
		t.Fatalf("%d %s calls=%d req=%+v", rec.Code, rec.Body.String(), store.calls, store.req)
	}

	root := listDraftID
	filtered, err := draftlist.EncodeCursor(draftlist.Cursor{CompanyID: reqCompanyID, ActorID: reqUserID, LastUpdatedAt: time.Unix(0, 0), LastID: listDraftID, RootProcessID: &root})
	if err != nil {
		t.Fatal(err)
	}
	store = &fakeStakeholderLister{}
	rec = doDraft(t, stakeholderVacanciesRouter(store, true), http.MethodGet, stakeholderVacanciesPath+"?cursor="+filtered, nil, nil)
	assertCatalogError(t, rec, http.StatusBadRequest, httpjson.CodeInvalidCursor)
	if store.calls != 0 {
		t.Fatal("the store was reached with a cursor of another filter")
	}
}

func TestStakeholderVacancies_StoreErrors(t *testing.T) {
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
			rec := doDraft(t, stakeholderVacanciesRouter(&fakeStakeholderLister{err: tc.err}, true), http.MethodGet, stakeholderVacanciesPath, nil, nil)
			assertCatalogError(t, rec, tc.status, tc.code)
		})
	}
}

func TestStakeholderVacancies_MissingCompanyContextFailsClosed(t *testing.T) {
	store := &fakeStakeholderLister{}
	rec := doDraft(t, stakeholderVacanciesRouter(store, false), http.MethodGet, stakeholderVacanciesPath, nil, nil)
	assertCatalogError(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)
	if store.calls != 0 {
		t.Fatal("store called without company context")
	}
}
