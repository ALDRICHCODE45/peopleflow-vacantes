package talentbase

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/google/uuid"
)

type stubAccess struct {
	allowed bool
	err     error
	called  bool
}

func (s *stubAccess) CanView(context.Context, uuid.UUID, uuid.UUID, string) (bool, error) {
	s.called = true
	return s.allowed, s.err
}

func TestGate(t *testing.T) {
	withContext := func(r *http.Request) *http.Request {
		cc := security.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New(), Role: valueobjects.RecruiterRole}
		return r.WithContext(security.ContextWithCompanyContext(r.Context(), cc))
	}
	for _, tc := range []struct {
		name    string
		access  *stubAccess
		context bool
		status  int
		body    string
		reached bool
	}{
		{"allowed", &stubAccess{allowed: true}, true, 204, "", true},
		{"restricted", &stubAccess{}, true, 403, `{"error":"the company owner restricted the talent base","code":"talent_base_restricted"}` + "\n", false},
		{"access failure", &stubAccess{err: errors.New("down")}, true, 500, `{"error":"an internal error occurred","code":"internal_error"}` + "\n", false},
		{"no company context", &stubAccess{allowed: true}, false, 401, `{"error":"unauthenticated","code":"unauthenticated"}` + "\n", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reached := false
			handler := Gate(tc.access)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				reached = true
				w.WriteHeader(http.StatusNoContent)
			}))
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tc.context {
				req = withContext(req)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.status || rec.Body.String() != tc.body || reached != tc.reached {
				t.Fatalf("status=%d body=%q reached=%v", rec.Code, rec.Body.String(), reached)
			}
		})
	}
}
