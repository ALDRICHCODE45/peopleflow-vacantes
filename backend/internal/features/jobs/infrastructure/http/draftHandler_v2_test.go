package http

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Only v2 methods exist on this fake: a v1 dispatch cannot satisfy its ports.
type recordingDraftV2 struct {
	state    recordingDraftStore
	contexts []context.Context
}

func (s *recordingDraftV2) CreateV2(ctx context.Context, company, actor uuid.UUID, key string, body []byte) (drafts.Result, error) {
	s.contexts = append(s.contexts, ctx)
	return s.state.Create(ctx, company, actor, key, body)
}
func (s *recordingDraftV2) GetV2(ctx context.Context, company, actor, id uuid.UUID) (drafts.Result, error) {
	s.contexts = append(s.contexts, ctx)
	return s.state.Get(ctx, company, actor, id)
}
func (s *recordingDraftV2) SaveV2(ctx context.Context, company, actor, id uuid.UUID, tag string, present bool, body []byte) (drafts.Result, error) {
	s.contexts = append(s.contexts, ctx)
	return s.state.Save(ctx, company, actor, id, tag, present, body)
}

const draftV2Path = "/v2/me/company/job-drafts"
const draftV2ID = "11111111-1111-1111-1111-111111111111"
const draftV2Tag = `"jd-r2-11111111-1111-1111-1111-111111111111-v1"`
const draftV2Response = `{"schema_version":2,"fields":{"screening_questions":[{"correct_option_id":"private-answer"}]}}`

// Test-only registration does not change the production router.
func draftV2Router(s *recordingDraftV2, cc *security.CompanyContext, gate http.HandlerFunc) http.Handler {
	h := NewDraftV2Handler(s, s, s).DraftHandlers()
	r := chi.NewRouter()
	r.Use(NoStore)
	if gate != nil {
		r.Use(func(http.Handler) http.Handler { return gate })
	}
	if cc != nil {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				next.ServeHTTP(w, req.WithContext(security.ContextWithCompanyContext(req.Context(), *cc)))
			})
		})
	}
	r.Post(draftV2Path, h.CreateDraft)
	r.Get(draftV2Path+"/{id}", h.GetDraft)
	r.Patch(draftV2Path+"/{id}", h.SaveDraft)
	return r
}
func v2RequestPath(method string) string {
	if method == http.MethodPost {
		return draftV2Path
	}
	return draftV2Path + "/" + draftV2ID
}

func TestDraftV2Handler_ExactSuccessAndForwarding(t *testing.T) {
	for _, method := range []string{http.MethodPost, http.MethodGet, http.MethodPatch} {
		for _, replay := range []bool{false, true} {
			t.Run(method+fmt.Sprint(replay), func(t *testing.T) {
				result := drafts.Result{Body: []byte(draftV2Response), ETag: draftV2Tag, Replayed: replay}
				s := &recordingDraftV2{state: recordingDraftStore{createResult: result, getResult: result, saveResult: result}}
				cc := draftTestContext()
				body := []byte(`{"fields":{"title":" Go "}}`)
				req := httptest.NewRequest(method, v2RequestPath(method), bytes.NewReader(body))
				req.Header.Set("Idempotency-Key", " Raw-Key ")
				req.Header.Set("If-Match", " \t"+draftV2Tag+"\t ")
				type marker struct{}
				ctx := context.WithValue(req.Context(), marker{}, "identity")
				req = req.WithContext(ctx)
				rec := httptest.NewRecorder()
				draftV2Router(s, &cc, nil).ServeHTTP(rec, req)
				want := http.StatusOK
				if method == http.MethodPost {
					want = http.StatusCreated
				}
				if rec.Code != want || rec.Body.String() != draftV2Response || rec.Header().Get("ETag") != draftV2Tag || rec.Header().Get("Content-Type") != "application/json" {
					t.Fatalf("response: %d %v %s", rec.Code, rec.Header(), rec.Body.String())
				}
				assertNoStore(t, rec)
				if method == http.MethodPost {
					if rec.Header().Get("Idempotency-Replayed") != fmt.Sprint(replay) {
						t.Fatal("replay header changed")
					}
				} else if _, ok := rec.Header()["Idempotency-Replayed"]; ok {
					t.Fatal("replay header must be absent")
				}
				if s.state.totalCalls() != 1 || len(s.contexts) != 1 || s.contexts[0].Value(marker{}) != "identity" {
					t.Fatal("call count/context changed")
				}
				switch method {
				case http.MethodPost:
					if len(s.state.creates) != 1 {
						t.Fatal("wrong capability")
					}
					c := s.state.creates[0]
					if c.CompanyID != cc.CompanyID || c.ActorID != cc.UserID || c.Key != " Raw-Key " || !bytes.Equal(c.Body, body) {
						t.Fatalf("create forwarding: %+v", c)
					}
				case http.MethodGet:
					if len(s.state.gets) != 1 {
						t.Fatal("wrong capability")
					}
					c := s.state.gets[0]
					if c.CompanyID != cc.CompanyID || c.ActorID != cc.UserID || c.ID.String() != draftV2ID {
						t.Fatalf("get forwarding: %+v", c)
					}
				case http.MethodPatch:
					if len(s.state.saves) != 1 {
						t.Fatal("wrong capability")
					}
					c := s.state.saves[0]
					if c.CompanyID != cc.CompanyID || c.ActorID != cc.UserID || c.ID.String() != draftV2ID || c.IfMatch != req.Header.Get("If-Match") || !c.Present || !bytes.Equal(c.Body, body) {
						t.Fatalf("save forwarding: %+v", c)
					}
				}
			})
		}
	}
}

func TestDraftV2Handler_LocalRejections(t *testing.T) {
	for _, tc := range []struct {
		name, method, path string
		headers            map[string][]string
		missingContext     bool
		status             int
		code               httpjson.Code
	}{
		{name: "context", method: http.MethodPost, path: draftV2Path, missingContext: true, status: 500, code: httpjson.CodeInternalError},
		{name: "key_missing", method: http.MethodPost, path: draftV2Path, status: 400, code: httpjson.CodeIdempotencyKeyRequired},
		{name: "key_empty", method: http.MethodPost, path: draftV2Path, headers: map[string][]string{"Idempotency-Key": {""}}, status: 400, code: httpjson.CodeInvalidIdempotencyKey},
		{name: "key_repeated", method: http.MethodPost, path: draftV2Path, headers: map[string][]string{"Idempotency-Key": {"one", "two"}}, status: 400, code: httpjson.CodeInvalidIdempotencyKey},
		{name: "get_id", method: http.MethodGet, path: draftV2Path + "/bad", status: 400, code: httpjson.CodeInvalidRequest},
		{name: "patch_id", method: http.MethodPatch, path: draftV2Path + "/bad", status: 400, code: httpjson.CodeInvalidRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &recordingDraftV2{}
			cc := draftTestContext()
			var ptr *security.CompanyContext = &cc
			if tc.missingContext {
				ptr = nil
			}
			rec := doDraft(t, draftV2Router(s, ptr, nil), tc.method, tc.path, []byte(`{`), tc.headers)
			assertCatalogError(t, rec, tc.status, tc.code)
			if s.state.totalCalls() != 0 {
				t.Fatal("transport rejection called capability")
			}
		})
	}
}

func TestDraftV2Handler_IfMatchPresenceVerbatim(t *testing.T) {
	for _, tc := range []struct {
		name    string
		values  []string
		want    string
		present bool
	}{
		{name: "absent"}, {name: "empty", values: []string{""}, present: true},
		{name: "repeated", values: []string{draftV2Tag, draftV2Tag}, want: draftV2Tag + "," + draftV2Tag, present: true},
		{name: "r1_unparsed", values: []string{draftETag}, want: draftETag, present: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &recordingDraftV2{state: recordingDraftStore{saveErr: drafts.ErrPreconditionRequired}}
			cc := draftTestContext()
			rec := doDraft(t, draftV2Router(s, &cc, nil), http.MethodPatch, v2RequestPath(http.MethodPatch), []byte(`{`), map[string][]string{"If-Match": tc.values})
			assertCatalogError(t, rec, 428, httpjson.CodePreconditionRequired)
			if len(s.state.saves) != 1 || s.state.totalCalls() != 1 || s.state.saves[0].IfMatch != tc.want || s.state.saves[0].Present != tc.present || string(s.state.saves[0].Body) != `{` {
				t.Fatal("raw precondition/body changed or parsed")
			}
		})
	}
}

type draftV2BrokenBody struct{}

func (draftV2BrokenBody) Read([]byte) (int, error) { return 0, errors.New("private read failure") }
func (draftV2BrokenBody) Close() error             { return nil }

func TestDraftV2Handler_BodyBoundary(t *testing.T) {
	for _, method := range []string{http.MethodPost, http.MethodPatch} {
		for _, shape := range []string{"exact", "oversized", "read_error"} {
			t.Run(method+shape, func(t *testing.T) {
				result := drafts.Result{Body: []byte(draftV2Response), ETag: draftV2Tag}
				s := &recordingDraftV2{state: recordingDraftStore{createResult: result, saveResult: result}}
				cc := draftTestContext()
				n := draftinput.MaxBodyBytes
				if shape == "oversized" {
					n++
				}
				body := bytes.Repeat([]byte(" "), n)
				req := httptest.NewRequest(method, v2RequestPath(method), bytes.NewReader(body))
				req.Header.Set("Idempotency-Key", "key")
				if shape == "read_error" {
					req.Body = io.ReadCloser(draftV2BrokenBody{})
				}
				rec := httptest.NewRecorder()
				draftV2Router(s, &cc, nil).ServeHTTP(rec, req)
				assertNoStore(t, rec)
				if shape == "exact" {
					if s.state.totalCalls() != 1 {
						t.Fatal("in-budget body not forwarded")
					}
					var got []byte
					if method == http.MethodPost {
						got = s.state.creates[0].Body
					} else {
						got = s.state.saves[0].Body
					}
					want := 200
					if method == http.MethodPost {
						want = 201
					}
					if rec.Code != want || !bytes.Equal(body, got) {
						t.Fatal("in-budget bytes changed")
					}
				} else {
					want, code := 413, httpjson.CodePayloadTooLarge
					if shape == "read_error" {
						want, code = 400, httpjson.CodeInvalidRequest
					}
					assertCatalogError(t, rec, want, code)
					if s.state.totalCalls() != 0 || strings.Contains(rec.Body.String(), "private read failure") {
						t.Fatal("read error leaked/reached store")
					}
				}
			})
		}
	}
}

func TestDraftV2Handler_StoreErrorsAndMiddleware(t *testing.T) {
	cases := []struct {
		err    error
		status int
		code   httpjson.Code
	}{
		{drafts.ErrUnauthenticated, 401, httpjson.CodeUnauthenticated}, {drafts.ErrForbidden, 403, httpjson.CodeForbidden},
		{drafts.ErrCompanyInactive, 403, httpjson.CodeCompanyInactive}, {drafts.ErrCompanyNotActive, 409, httpjson.CodeCompanyNotActive},
		{drafts.ErrNotFound, 404, httpjson.CodeNotFound}, {drafts.ErrPreconditionRequired, 428, httpjson.CodePreconditionRequired},
		{drafts.ErrInvalidRequest, 400, httpjson.CodeInvalidRequest}, {drafts.ErrVersionConflict, 412, httpjson.CodeVersionConflict},
		{drafts.ErrIdempotencyConflict, 409, httpjson.CodeIdempotencyConflict}, {drafts.ErrValidation, 400, httpjson.CodeValidationError},
		{drafts.ErrEmptyPatch, 400, httpjson.CodeEmptyPatch}, {drafts.ErrPayloadTooLarge, 413, httpjson.CodePayloadTooLarge},
		{drafts.ErrInvalidIdempotencyKey, 400, httpjson.CodeInvalidIdempotencyKey}, {drafts.ErrIdempotencyKeyRequired, 400, httpjson.CodeIdempotencyKeyRequired},
		{drafts.ErrVersionOverflow, 500, httpjson.CodeInternalError}, {errors.New("private invariant details"), 500, httpjson.CodeInternalError},
	}
	for _, method := range []string{http.MethodPost, http.MethodGet, http.MethodPatch} {
		for _, tc := range cases {
			t.Run(method+string(tc.code)+tc.err.Error(), func(t *testing.T) {
				err := fmt.Errorf("private invariant details: %w", tc.err)
				s := &recordingDraftV2{state: recordingDraftStore{createErr: err, getErr: err, saveErr: err}}
				cc := draftTestContext()
				rec := doDraft(t, draftV2Router(s, &cc, nil), method, v2RequestPath(method), []byte(`{`), map[string][]string{"Idempotency-Key": {"key"}})
				assertCatalogError(t, rec, tc.status, tc.code)
				if s.state.totalCalls() != 1 || strings.Contains(rec.Body.String(), "private invariant details") || rec.Header().Get("ETag") != "" || rec.Header().Get("Idempotency-Replayed") != "" {
					t.Fatal("store error leaked data/headers or callcount wrong")
				}
			})
		}
		t.Run(method+"middleware", func(t *testing.T) {
			s := &recordingDraftV2{}
			gate := func(w http.ResponseWriter, _ *http.Request) {
				httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeForbidden))
			}
			rec := doDraft(t, draftV2Router(s, nil, gate), method, v2RequestPath(method), nil, nil)
			assertCatalogError(t, rec, 403, httpjson.CodeForbidden)
			if s.state.totalCalls() != 0 {
				t.Fatal("middleware rejection reached store")
			}
		})
	}
}
