package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/google/uuid"
)

func (s *movementRouteStore) OriginalFile(ctx context.Context, c, a, v, p uuid.UUID) (app.File, error) {
	out, err := s.File(ctx, c, a, v, p)
	s.operation = "original"
	return out, err
}

func TestBoardCorrectionsAdditiveWire(t *testing.T) {
	base := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/participations/" + uuid.NewString()
	headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	for _, suffix := range []string{"", "/moves", "/discard", "/recover", "/substate"} {
		t.Run(suffix, func(t *testing.T) {
			method := "POST"
			if suffix == "" {
				method = "GET"
			}
			w := doRouteRequest(t, movementRouter(&movementRouteStore{}), method, base+suffix, `{}`, headers)
			if w.Code != 200 {
				t.Fatal(w.Code, w.Body.String())
			}
			var out map[string]json.RawMessage
			if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
			if string(out["corrected_fields"]) != "[]" {
				t.Errorf("corrected_fields = %s, want []", out["corrected_fields"])
			}
			var cv map[string]json.RawMessage
			if err := json.Unmarshal(out["cv"], &cv); err != nil {
				t.Fatal(err)
			}
			if _, ok := cv["source"]; !ok {
				t.Error("missing cv.source")
			}
			if suffix == "" {
				for _, key := range []string{"original", "original_cv"} {
					if string(out[key]) != "null" {
						t.Errorf("%s = %s, want null", key, out[key])
					}
				}
			} else {
				for _, key := range []string{"original", "original_cv", "contact", "profile", "screening_answers"} {
					if _, ok := out[key]; ok {
						t.Errorf("private %s leaked", key)
					}
				}
			}
		})
	}
}

func TestBoardOriginalCVRoute(t *testing.T) {
	path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/participations/" + uuid.NewString() + "/cv/original"
	for _, tc := range []struct {
		name    string
		headers map[string]string
		err     error
		status  int
	}{
		{"anonymous", nil, nil, 401},
		{"candidate", map[string]string{"X-Test-Sub": "candidate"}, nil, 403},
		{"existing", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}, nil, 200},
		{"foreign", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}, app.ErrNotFound, 404},
		{"storage", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}, app.ErrStorageUnavailable, 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &movementRouteStore{err: tc.err}
			w := doRouteRequest(t, movementRouter(s), http.MethodGet, path, "", tc.headers)
			if w.Code != tc.status {
				t.Errorf("status %d want %d: %s", w.Code, tc.status, w.Body.String())
			}
			assertDraftRouteNoStore(t, w)
			if tc.status == 401 || tc.status == 403 {
				if s.calls != 0 {
					t.Fatal("gate called storage")
				}
				return
			}
			if s.operation != "original" || s.company != routeTestCompanyID || s.actor != routeTestActorID || s.vacancy != routeTestDraftID {
				t.Error("original download did not use trusted board scope")
			}
			if tc.status == 200 && (w.Body.String() != "%PDF-1" || w.Header().Get("Content-Type") != "application/pdf" || w.Header().Get("Content-Length") != "6" || w.Header().Get("X-Content-Type-Options") != "nosniff" || !strings.Contains(w.Header().Get("Content-Disposition"), "Resume.pdf")) {
				t.Fatal(w.Header(), w.Body.String())
			}
		})
	}
}
