package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/requesters"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

const requestersPath = "/me/company/requesters"

var (
	reqCompanyID = uuid.MustParse("22222222-2222-2222-2222-222222222222")
	reqUserID    = uuid.MustParse("33333333-3333-3333-3333-333333333333")
	reqEntryID   = uuid.MustParse("44444444-4444-4444-4444-444444444444")
)

// fakeRequesterStore records the last call and returns canned results.
type fakeRequesterStore struct {
	createCalls int
	listCalls   int
	companyID   uuid.UUID
	actorID     uuid.UUID
	kind        string
	name        valueobjects.RequesterName
	listReq     requesters.ListRequest

	entry requesters.Entry
	page  requesters.Page
	err   error
}

func (f *fakeRequesterStore) CreateRequester(_ context.Context, companyID, actorID uuid.UUID, kind string, name valueobjects.RequesterName) (requesters.Entry, error) {
	f.createCalls++
	f.companyID, f.actorID, f.kind, f.name = companyID, actorID, kind, name
	return f.entry, f.err
}

func (f *fakeRequesterStore) ListRequesters(_ context.Context, companyID, actorID uuid.UUID, req requesters.ListRequest) (requesters.Page, error) {
	f.listCalls++
	f.companyID, f.actorID, f.listReq = companyID, actorID, req
	return f.page, f.err
}

func requesterRouter(store requesters.Store, withContext bool) http.Handler {
	handlers := NewRequesterHandler(store).RequesterHandlers()
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
	r.Get(requestersPath, handlers.ListRequesters)
	r.Post(requestersPath, handlers.CreateRequester)
	return r
}

func decodeObject(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("body is not a JSON object: %v; %s", err, body)
	}
	return out
}

func TestListRequesters_Success(t *testing.T) {
	store := &fakeRequesterStore{page: requesters.Page{
		Items:      []requesters.Entry{{ID: reqEntryID, Kind: requesters.KindInternalArea, Name: "Área de TI"}},
		NextCursor: "",
	}}
	rec := doDraft(t, requesterRouter(store, true), http.MethodGet, requestersPath+"?kind=internal_area&q=%20%C3%81REA%20", nil, nil)
	assertNoStore(t, rec)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; %s", rec.Code, rec.Body)
	}
	if got, want := rec.Body.String(), `{"items":[{"id":"44444444-4444-4444-4444-444444444444","kind":"internal_area","name":"Área de TI"}],"next_cursor":null}`; got != want+"\n" && got != want {
		t.Fatalf("body = %s, want %s", got, want)
	}
	if store.companyID != reqCompanyID || store.actorID != reqUserID {
		t.Errorf("identity = %v/%v, want session context", store.companyID, store.actorID)
	}
	want := requesters.ListRequest{Kind: requesters.KindInternalArea, Query: requesters.Query{Normalized: "ÁREA", Key: "área"}, Limit: requesters.DefaultLimit}
	if store.listReq.Kind != want.Kind || store.listReq.Query != want.Query || store.listReq.Limit != want.Limit || store.listReq.After != nil {
		t.Errorf("list request = %+v, want %+v", store.listReq, want)
	}
}

func TestListRequesters_EmptyPageAndNextCursor(t *testing.T) {
	store := &fakeRequesterStore{page: requesters.Page{Items: []requesters.Entry{}, NextCursor: "opaque"}}
	rec := doDraft(t, requesterRouter(store, true), http.MethodGet, requestersPath+"?kind=client&limit=5", nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; %s", rec.Code, rec.Body)
	}
	body := decodeObject(t, rec.Body.Bytes())
	if items, ok := body["items"].([]any); !ok || len(items) != 0 {
		t.Errorf("items = %#v, want []", body["items"])
	}
	if body["next_cursor"] != "opaque" {
		t.Errorf("next_cursor = %#v", body["next_cursor"])
	}
	if store.listReq.Limit != 5 {
		t.Errorf("limit = %d, want 5", store.listReq.Limit)
	}
}

func TestListRequesters_ForwardsValidCursor(t *testing.T) {
	cursor := requesters.Cursor{CompanyID: reqCompanyID, Kind: requesters.KindClient, QNormalized: "", LastNameKey: "acme", LastID: reqEntryID}
	token, err := requesters.EncodeCursor(cursor)
	if err != nil {
		t.Fatal(err)
	}
	store := &fakeRequesterStore{page: requesters.Page{Items: []requesters.Entry{}}}
	rec := doDraft(t, requesterRouter(store, true), http.MethodGet, requestersPath+"?kind=client&cursor="+token, nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; %s", rec.Code, rec.Body)
	}
	if store.listReq.After == nil || *store.listReq.After != cursor {
		t.Errorf("after = %+v, want %+v", store.listReq.After, cursor)
	}
}

func TestListRequesters_RejectsMalformedQuery(t *testing.T) {
	otherKind, _ := requesters.EncodeCursor(requesters.Cursor{CompanyID: reqCompanyID, Kind: requesters.KindInternalArea, LastNameKey: "a", LastID: reqEntryID})
	otherCompany, _ := requesters.EncodeCursor(requesters.Cursor{CompanyID: reqEntryID, Kind: requesters.KindClient, LastNameKey: "a", LastID: reqEntryID})
	for name, query := range map[string]string{
		"missing kind":       "",
		"invalid kind":       "?kind=area",
		"repeated kind":      "?kind=client&kind=client",
		"limit zero":         "?kind=client&limit=0",
		"limit over max":     "?kind=client&limit=51",
		"limit not a number": "?kind=client&limit=abc",
		"repeated limit":     "?kind=client&limit=5&limit=6",
		"query too long":     "?kind=client&q=" + strings.Repeat("a", 161),
		"query control":      "?kind=client&q=a%01b",
		"repeated query":     "?kind=client&q=a&q=b",
		"empty cursor":       "?kind=client&cursor=",
		"garbage cursor":     "?kind=client&cursor=%21%21",
		"cursor other kind":  "?kind=client&cursor=" + otherKind,
		"cursor other org":   "?kind=client&cursor=" + otherCompany,
		"cursor other query": "?kind=client&q=zz&cursor=" + otherKind,
		"repeated cursor":    "?kind=client&cursor=a&cursor=b",
		"cursor bad escape":  "?kind=client&cursor=%zz",
		"limit bad escape":   "?kind=client&limit=%zz",
		"query bad escape":   "?kind=client&q=%zz",
		"kind bad escape":    "?kind=client&kind=%zz",
		"unknown bad escape": "?kind=client&x=%zz",
	} {
		t.Run(name, func(t *testing.T) {
			store := &fakeRequesterStore{}
			rec := doDraft(t, requesterRouter(store, true), http.MethodGet, requestersPath+query, nil, nil)
			assertCatalogError(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
			if store.listCalls != 0 {
				t.Errorf("store called %d times", store.listCalls)
			}
		})
	}
}

func TestCreateRequester_Success(t *testing.T) {
	store := &fakeRequesterStore{entry: requesters.Entry{ID: reqEntryID, Kind: requesters.KindClient, Name: "Cyber Power"}}
	rec := doDraft(t, requesterRouter(store, true), http.MethodPost, requestersPath, []byte(`{"kind":"client","name":"  Cyber   Power "}`), nil)
	assertNoStore(t, rec)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d; %s", rec.Code, rec.Body)
	}
	if got, want := strings.TrimSpace(rec.Body.String()), `{"id":"44444444-4444-4444-4444-444444444444","kind":"client","name":"Cyber Power"}`; got != want {
		t.Fatalf("body = %s, want %s", got, want)
	}
	if store.companyID != reqCompanyID || store.actorID != reqUserID || store.kind != requesters.KindClient || store.name.Value() != "Cyber Power" {
		t.Errorf("store call = %v %v %q %q", store.companyID, store.actorID, store.kind, store.name.Value())
	}
}

func TestCreateRequester_DuplicateReturnsTypedConflict(t *testing.T) {
	store := &fakeRequesterStore{err: &requesters.AlreadyExistsError{Existing: requesters.Entry{ID: reqEntryID, Kind: requesters.KindInternalArea, Name: "Área"}}}
	rec := doDraft(t, requesterRouter(store, true), http.MethodPost, requestersPath, []byte(`{"kind":"internal_area","name":"ÁREA"}`), nil)
	assertNoStore(t, rec)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d; %s", rec.Code, rec.Body)
	}
	var env struct {
		Error string `json:"error"`
		Code  string `json:"code"`
		Data  struct {
			Existing map[string]string `json:"existing"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"id": reqEntryID.String(), "kind": "internal_area", "name": "Área"}
	if env.Code != "requester_already_exists" || env.Error == "" || len(env.Data.Existing) != 3 {
		t.Fatalf("envelope = %s", rec.Body)
	}
	for k, v := range want {
		if env.Data.Existing[k] != v {
			t.Errorf("existing[%s] = %q, want %q", k, env.Data.Existing[k], v)
		}
	}
}

func TestCreateRequester_RejectsMalformedBody(t *testing.T) {
	invalid := map[string]string{
		"not json":        `nope`,
		"array":           `[]`,
		"missing name":    `{"kind":"client"}`,
		"missing kind":    `{"name":"Acme"}`,
		"extra key":       `{"kind":"client","name":"Acme","company_id":"x"}`,
		"duplicate key":   `{"kind":"client","name":"Acme","name":"Other"}`,
		"non-string name": `{"kind":"client","name":1}`,
		"null kind":       `{"kind":null,"name":"Acme"}`,
		"invalid kind":    `{"kind":"area","name":"Acme"}`,
		"invalid utf-8":   "{\"kind\":\"client\",\"name\":\"\xff\"}",
		"trailing data":   `{"kind":"client","name":"Acme"} {}`,
	}
	for name, body := range invalid {
		t.Run(name, func(t *testing.T) {
			store := &fakeRequesterStore{}
			rec := doDraft(t, requesterRouter(store, true), http.MethodPost, requestersPath, []byte(body), nil)
			assertCatalogError(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
			if store.createCalls != 0 {
				t.Errorf("store called")
			}
		})
	}
	validation := map[string]string{
		"empty name":      `{"kind":"client","name":"   "}`,
		"name too long":   `{"kind":"client","name":"` + strings.Repeat("ñ", 161) + `"}`,
		"control in name": `{"kind":"client","name":"a\u0001b"}`,
	}
	for name, body := range validation {
		t.Run(name, func(t *testing.T) {
			store := &fakeRequesterStore{}
			rec := doDraft(t, requesterRouter(store, true), http.MethodPost, requestersPath, []byte(body), nil)
			assertCatalogError(t, rec, http.StatusBadRequest, httpjson.CodeValidationError)
			if store.createCalls != 0 {
				t.Errorf("store called")
			}
		})
	}
	store := &fakeRequesterStore{}
	huge := `{"kind":"client","name":"` + strings.Repeat("a", maxRequesterBodyBytes) + `"}`
	rec := doDraft(t, requesterRouter(store, true), http.MethodPost, requestersPath, []byte(huge), nil)
	assertCatalogError(t, rec, http.StatusRequestEntityTooLarge, httpjson.CodePayloadTooLarge)
}

func TestRequesters_MapsStoreGatesAndMissingContext(t *testing.T) {
	gates := map[error]struct {
		status int
		code   httpjson.Code
	}{
		drafts.ErrUnauthenticated:  {http.StatusUnauthorized, httpjson.CodeUnauthenticated},
		drafts.ErrForbidden:        {http.StatusForbidden, httpjson.CodeForbidden},
		drafts.ErrCompanyInactive:  {http.StatusForbidden, httpjson.CodeCompanyInactive},
		drafts.ErrCompanyNotActive: {http.StatusConflict, httpjson.CodeCompanyNotActive},
		errors.New("boom"):         {http.StatusInternalServerError, httpjson.CodeInternalError},
	}
	for err, want := range gates {
		store := &fakeRequesterStore{err: err}
		router := requesterRouter(store, true)
		assertCatalogError(t, doDraft(t, router, http.MethodGet, requestersPath+"?kind=client", nil, nil), want.status, want.code)
		assertCatalogError(t, doDraft(t, router, http.MethodPost, requestersPath, []byte(`{"kind":"client","name":"Acme"}`), nil), want.status, want.code)
	}

	store := &fakeRequesterStore{}
	router := requesterRouter(store, false)
	assertCatalogError(t, doDraft(t, router, http.MethodGet, requestersPath+"?kind=client", nil, nil), http.StatusInternalServerError, httpjson.CodeInternalError)
	assertCatalogError(t, doDraft(t, router, http.MethodPost, requestersPath, []byte(`{"kind":"client","name":"Acme"}`), nil), http.StatusInternalServerError, httpjson.CodeInternalError)
	if store.createCalls+store.listCalls != 0 {
		t.Errorf("store called without company context")
	}
}
