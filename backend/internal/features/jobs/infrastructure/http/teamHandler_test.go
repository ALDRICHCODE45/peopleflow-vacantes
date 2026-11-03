package http

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancyteam"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type teamFake struct {
	result             drafts.Result
	err                error
	calls              int
	company, actor, id uuid.UUID
	cursor             string
}

func (s *teamFake) GetTeam(_ context.Context, c, a, id uuid.UUID) (drafts.Result, error) {
	s.calls++
	s.company = c
	s.actor = a
	s.id = id
	return s.result, s.err
}
func (s *teamFake) GetTeamHistory(ctx context.Context, c, a, id uuid.UUID, cursor string) (drafts.Result, error) {
	s.cursor = cursor
	return s.GetTeam(ctx, c, a, id)
}
func TestTeamHandlerWire(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		history    bool
	}{
		{"team", `{"mode":"shared","members":[],"viewer":{"function":null,"is_owner":true,"can":{"add_member":true,"remove_member":true,"leave":false,"reassign_responsible":false,"change_mode":true,"edit_deadline":true,"renegotiate_commitment":true}}}`, false},
		{"history", `{"items":[],"next_cursor":null}`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cc := draftTestContext()
			id := uuid.New()
			s := &teamFake{result: drafts.Result{Body: []byte(tc.body), ETag: `"opaque"`}}
			h := NewTeamHandler(s)
			r := chi.NewRouter()
			r.Use(NoStore)
			r.Get("/{id}", h.Get)
			if tc.history {
				r = chi.NewRouter()
				r.Use(NoStore)
				r.Get("/{id}", h.History)
			}
			req := httptest.NewRequest("GET", "/"+id.String()+"?cursor=opaque", nil)
			req = req.WithContext(security.ContextWithCompanyContext(req.Context(), cc))
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != 200 || rec.Body.String() != tc.body || rec.Header().Get("ETag") != `"opaque"` || rec.Header().Get("Content-Type") != "application/json" || rec.Header().Get("Cache-Control") != "no-store" || s.calls != 1 || s.company != cc.CompanyID || s.actor != cc.UserID || s.id != id {
				t.Fatalf("%d %s %+v", rec.Code, rec.Body.String(), s)
			}
			if tc.history && s.cursor != "opaque" {
				t.Fatal(s.cursor)
			}
		})
	}
}
func TestTeamHandlerErrors(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{{drafts.ErrTeamAccessEnded, 404, "team_access_ended"}, {drafts.ErrNotFound, 404, "not_found"}, {vacancyteam.ErrInvalidCursor, 400, "invalid_cursor"}} {
		s := &teamFake{err: tc.err}
		h := NewTeamHandler(s)
		r := chi.NewRouter()
		r.Use(NoStore)
		r.Get("/{id}", h.History)
		cc := draftTestContext()
		req := httptest.NewRequest(http.MethodGet, "/"+uuid.NewString(), nil)
		req = req.WithContext(security.ContextWithCompanyContext(req.Context(), cc))
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != tc.status {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
		assertCatalogError(t, rec, tc.status, httpjson.Code(tc.code))
	}
}
