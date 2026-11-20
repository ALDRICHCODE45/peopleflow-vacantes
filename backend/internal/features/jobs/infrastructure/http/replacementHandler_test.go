package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/replacement"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancyteam"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func TestWriteReplacementErrorMapping(t *testing.T) {
	closed, active := "closed", "active"
	view := lifecycle.View{Publication: &closed, Process: &active, Version: "3", AllowedActions: []string{"finish_process"}}
	for name, tc := range map[string]struct {
		err    error
		status int
		code   string
		data   []string // keys of data
		fields bool
	}{
		"not closed":         {&replacement.SourceNotClosed{Lifecycle: view}, 409, "replacement_source_not_closed", []string{"lifecycle"}, false},
		"not latest":         {&replacement.SourceNotLatest{LatestProcessID: "l", RootProcessID: "r", Lifecycle: view}, 409, "replacement_source_not_latest", []string{"latest_process_id", "root_process_id", "lifecycle"}, false},
		"already active":     {&lifecycle.ReplacementAlreadyActive{ProcessID: "p", RootProcessID: "r", Lifecycle: view}, 409, "replacement_already_active", []string{"process_id", "root_process_id", "lifecycle"}, false},
		"credits":            {&replacement.CreditsInvalid{Credits: []replacement.CreditProblem{{CreditID: "c", Reason: replacement.CreditNotInChain}}}, 422, "replacement_credits_invalid", []string{"credits"}, false},
		"wrapped credits":    {fmt.Errorf("tx: %w", &replacement.CreditsInvalid{}), 422, "replacement_credits_invalid", []string{"credits"}, false},
		"carried candidates": {&replacement.CarriedCandidatesInvalid{Candidates: []replacement.CarriedProblem{{Index: 1, Reason: replacement.CandidateCurrentlyPlaced}}}, 422, "carried_candidate_invalid", []string{"candidates"}, false},
		"carried stages":     {&replacement.CarriedStagesInvalid{Candidates: []replacement.CarriedProblem{{Index: 0, Reason: replacement.StageIsPlacement}}}, 422, "carried_stage_invalid", []string{"candidates"}, false},
		"wrapped carried":    {fmt.Errorf("tx: %w", &replacement.CarriedStagesInvalid{}), 422, "carried_stage_invalid", []string{"candidates"}, false},
		"validation":         {&replacement.Invalid{Fields: []replacement.Field{{Field: "target_quantity", Code: "below_credits_count"}}}, 400, "validation_error", nil, true},
		"non business":       {deliveryconfig.ErrNonBusinessDate, 400, "non_business_date", nil, false},
		"forbidden":          {vacancyteam.ErrForbidden, 403, "team_action_forbidden", nil, false},
		"not a member":       {vacancyteam.ErrNotCompanyMember, 422, "not_company_member", nil, false},
		"stale":              {drafts.ErrVersionConflict, 412, "version_conflict", nil, false},
		"no precondition":    {drafts.ErrPreconditionRequired, 428, "precondition_required", nil, false},
		"invalid":            {drafts.ErrInvalidRequest, 400, "invalid_request", nil, false},
		"idempotency":        {drafts.ErrIdempotencyConflict, 409, "idempotency_conflict", nil, false},
		"not found":          {drafts.ErrNotFound, 404, "not_found", nil, false},
		"unknown":            {errors.New("boom"), 500, "internal_error", nil, false},
	} {
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			writeReplacementError(rec, tc.err)
			var body struct {
				Code   string                     `json:"code"`
				Data   map[string]json.RawMessage `json:"data"`
				Fields []map[string]string        `json:"fields"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if rec.Code != tc.status || body.Code != tc.code || len(body.Data) != len(tc.data) || tc.fields != (len(body.Fields) == 1) {
				t.Fatalf("%d %s", rec.Code, rec.Body.String())
			}
			for _, key := range tc.data {
				if body.Data[key] == nil {
					t.Fatalf("data lacks %s: %s", key, rec.Body.String())
				}
			}
		})
	}
}

type startCall struct {
	id         uuid.UUID
	key, tag   string
	keyPresent bool
	matched    bool
	body       string
}

type fakeReplacementStore struct {
	result drafts.Result
	err    error
	call   startCall
	read   uuid.UUID
}

func (f *fakeReplacementStore) ReadReplacements(_ context.Context, _, _, id uuid.UUID) (drafts.Result, error) {
	f.read = id
	return f.result, f.err
}

func (f *fakeReplacementStore) StartReplacement(_ context.Context, _, _, id uuid.UUID, key string, keyPresent bool, ifMatch string, present bool, body []byte) (drafts.Result, error) {
	f.call = startCall{id: id, key: key, tag: ifMatch, keyPresent: keyPresent, matched: present, body: string(body)}
	return f.result, f.err
}

// startRouter mounts the Start route behind a company context, as the production router does.
func startRouter(start http.HandlerFunc) http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			cc := identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()}
			next.ServeHTTP(w, req.WithContext(identitysecurity.ContextWithCompanyContext(req.Context(), cc)))
		})
	})
	r.Post("/v2/me/company/job-drafts/{id}/replacements", start)
	return r
}

func listRouter(list http.HandlerFunc) http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			cc := identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()}
			next.ServeHTTP(w, req.WithContext(identitysecurity.ContextWithCompanyContext(req.Context(), cc)))
		})
	})
	r.Get("/v2/me/company/job-drafts/{id}/replacements", list)
	return r
}

func getList(router http.Handler, id string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v2/me/company/job-drafts/"+id+"/replacements", nil))
	return rec
}

func postStart(router http.Handler, id string, body string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/v2/me/company/job-drafts/"+id+"/replacements", strings.NewReader(body))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestStartHandlerWritesCreatedWithLocationETagAndReplayHeader(t *testing.T) {
	id := uuid.New()
	for _, replayed := range []bool{false, true} {
		store := &fakeReplacementStore{result: drafts.Result{Body: []byte(`{"id":"` + id.String() + `"}`), ETag: `"vl-x-v1"`, Replayed: replayed}}
		rec := postStart(startRouter(NewReplacementHandler(store).ReplacementHandlers().Start), id.String(), `{"a":1}`, map[string]string{"If-Match": `"vl-1"`, "Idempotency-Key": "k"})
		if rec.Code != http.StatusCreated || rec.Header().Get("Location") != "/v2/me/company/job-drafts/"+id.String() || rec.Header().Get("ETag") != `"vl-x-v1"` ||
			rec.Header().Get("Idempotency-Replayed") != fmt.Sprint(replayed) || rec.Header().Get("Content-Type") != "application/json" || rec.Body.String() != string(store.result.Body) {
			t.Fatalf("%d %v %s", rec.Code, rec.Header(), rec.Body.String())
		}
		if want := (startCall{id: id, key: "k", tag: `"vl-1"`, keyPresent: true, matched: true, body: `{"a":1}`}); store.call != want {
			t.Fatalf("store got %+v, want %+v", store.call, want)
		}
	}
	// A frozen body without an id is a server invariant failure, never a Location-less 201.
	broken := NewReplacementHandler(&fakeReplacementStore{result: drafts.Result{Body: []byte(`{}`)}})
	if rec := postStart(startRouter(broken.ReplacementHandlers().Start), id.String(), `{}`, nil); rec.Code != 500 {
		t.Fatalf("broken body: %d", rec.Code)
	}
}

func TestStartHandlerFailures(t *testing.T) {
	id := uuid.New()
	store := &fakeReplacementStore{err: &replacement.SourceNotClosed{Lifecycle: lifecycle.View{}}}
	rec := postStart(startRouter(NewReplacementHandler(store).ReplacementHandlers().Start), id.String(), `{}`, nil)
	if rec.Code != 409 || store.call.keyPresent || store.call.matched || rec.Header().Get("Location") != "" {
		t.Fatalf("%d %+v", rec.Code, store.call)
	}
	// A path id that is not a UUID never reaches the store.
	store = &fakeReplacementStore{}
	if rec = postStart(startRouter(NewReplacementHandler(store).ReplacementHandlers().Start), "not-a-uuid", `{}`, nil); rec.Code != 400 || store.call.id != uuid.Nil {
		t.Fatalf("%d %+v", rec.Code, store.call)
	}
}

type startingLifecycleStore struct {
	lifecycle.Store
	*fakeReplacementStore
}

// The lifecycle handler serves the route from its own store. A store that cannot
// start replacements (a route-test fake), or no handler at all, answers 500
// instead of panicking; a store that can is used.
func TestLifecycleHandlerReplacementRoute(t *testing.T) {
	id := uuid.New()
	for name, h := range map[string]*LifecycleHandler{"nil handler": nil, "store without replacements": NewLifecycleHandler(nil)} {
		if rec := postStart(startRouter(h.ReplacementHandlers().Start), id.String(), `{}`, nil); rec.Code != 500 {
			t.Fatalf("%s: %d", name, rec.Code)
		}
	}
	store := &fakeReplacementStore{result: drafts.Result{Body: []byte(`{"id":"` + id.String() + `"}`)}}
	rec := postStart(startRouter(NewLifecycleHandler(startingLifecycleStore{fakeReplacementStore: store}).ReplacementHandlers().Start), id.String(), `{"x":1}`, nil)
	if rec.Code != http.StatusCreated || store.call.id != id || store.call.body != `{"x":1}` {
		t.Fatalf("%d %+v", rec.Code, store.call)
	}
}

func TestListHandlerWritesTheChainWithoutAnETag(t *testing.T) {
	id := uuid.New()
	store := &fakeReplacementStore{result: drafts.Result{Body: []byte(`{"root_process_id":"` + id.String() + `","items":[]}`)}}
	rec := getList(listRouter(NewReplacementHandler(store).ReplacementHandlers().List), id.String())
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/json" || rec.Body.String() != string(store.result.Body) || store.read != id {
		t.Fatalf("%d %v %s (read %s)", rec.Code, rec.Header(), rec.Body.String(), store.read)
	}
	// The body is derived from several resources: no ETag, and nothing replay-related.
	if _, has := rec.Header()["Etag"]; has || rec.Header().Get("Idempotency-Replayed") != "" || rec.Header().Get("Location") != "" {
		t.Fatalf("headers = %v", rec.Header())
	}
}

func TestListHandlerFailures(t *testing.T) {
	id := uuid.New()
	for name, tc := range map[string]struct {
		err    error
		status int
		code   string
	}{
		"not found":   {drafts.ErrNotFound, 404, "not_found"},
		"forbidden":   {drafts.ErrForbidden, 403, "forbidden"},
		"unexpected":  {errors.New("boom"), 500, "internal_error"},
		"wrapped 404": {fmt.Errorf("read: %w", drafts.ErrNotFound), 404, "not_found"},
	} {
		store := &fakeReplacementStore{err: tc.err}
		rec := getList(listRouter(NewReplacementHandler(store).ReplacementHandlers().List), id.String())
		var body struct {
			Code string `json:"code"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || rec.Code != tc.status || body.Code != tc.code {
			t.Fatalf("%s: %d %s", name, rec.Code, rec.Body.String())
		}
	}
	// A path id that is not a UUID never reaches the store.
	store := &fakeReplacementStore{}
	if rec := getList(listRouter(NewReplacementHandler(store).ReplacementHandlers().List), "not-a-uuid"); rec.Code != 400 || store.read != uuid.Nil {
		t.Fatalf("%d (read %s)", rec.Code, store.read)
	}
}

// The lifecycle handler serves the read from its own store; a store that cannot read
// replacements (a route-test fake), or no handler at all, answers 500 instead of panicking.
func TestLifecycleHandlerReplacementListRoute(t *testing.T) {
	id := uuid.New()
	for name, h := range map[string]*LifecycleHandler{"nil handler": nil, "store without replacements": NewLifecycleHandler(nil)} {
		if rec := getList(listRouter(h.ReplacementHandlers().List), id.String()); rec.Code != 500 {
			t.Fatalf("%s: %d", name, rec.Code)
		}
	}
	store := &fakeReplacementStore{result: drafts.Result{Body: []byte(`{}`)}}
	if rec := getList(listRouter(NewLifecycleHandler(startingLifecycleStore{fakeReplacementStore: store}).ReplacementHandlers().List), id.String()); rec.Code != http.StatusOK || store.read != id {
		t.Fatalf("%d (read %s)", rec.Code, store.read)
	}
}
