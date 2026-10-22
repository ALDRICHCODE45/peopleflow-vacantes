package main

import (
	"context"
	"encoding/json"
	"errors"
	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	pool "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	"github.com/google/uuid"
	"io"
	"reflect"
	"strings"
	"testing"
	"time"
)

type orgDetailReader struct {
	orgCandidatesReader
	fail  error
	calls int
}

func (s *orgDetailReader) Detail(_ context.Context, c uuid.UUID, kind string, id uuid.UUID) (pool.Detail, error) {
	s.calls++
	if c != routeTestCompanyID {
		return pool.Detail{}, errors.New("wrong company")
	}
	if s.fail != nil {
		return pool.Detail{}, s.fail
	}
	if id != routeTestDraftID {
		return pool.Detail{}, board.ErrNotFound
	}
	raw := `{"kind":"` + kind + `","id":"` + id.String() + `","full_name":"Candidate","professional_title":null,"current_company":null,"contact":{"email":"contact@example.test","phone":null},"profile":{"location":null,"skills":[],"years_of_experience":null,"seniority":null,"education":{"highest_completed":null,"in_progress":null},"languages":[]},"participations":[],"created_by":null,"created_at":"2026-01-01T00:00:00Z"}`
	var d pool.Detail
	err := json.Unmarshal([]byte(raw), &d)
	d.ETag = pool.ETag(kind, id, 1)
	d.CorrectedFields = []string{}
	d.Skills = []string{}
	if kind == "manual" {
		d.Education = []pool.Study{}
	}
	return d, err
}
func (s *orgDetailReader) File(_ context.Context, c uuid.UUID, kind string, id, pid uuid.UUID) (board.File, error) {
	s.calls++
	if c != routeTestCompanyID {
		return board.File{}, errors.New("wrong company")
	}
	if s.fail != nil {
		return board.File{}, s.fail
	}
	if id != routeTestDraftID || pid != routeTestDraftID {
		return board.File{}, board.ErrNotFound
	}
	return board.File{Name: "Exact CV", ContentType: "application/pdf", Size: 6, Reader: io.NopCloser(strings.NewReader("%PDF-x"))}, nil
}

func TestOrgCandidatesDetailHTTP(t *testing.T) {
	headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	reader := &orgDetailReader{}
	router := orgCandidatesRouter(reader)
	for _, kind := range []string{"manual", "organic"} {
		t.Run(kind, func(t *testing.T) {
			w := doRouteRequest(t, router, "GET", orgCandidatesPath+"/"+kind+"/"+routeTestDraftID.String(), "", headers)
			assertDraftRouteNoStore(t, w)
			if w.Code != 200 {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
			var got pool.Detail
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			expected, _ := reader.Detail(context.Background(), routeTestCompanyID, kind, routeTestDraftID)
			if !reflect.DeepEqual(got, expected) || !got.CreatedAt.Equal(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)) {
				t.Fatal(got)
			}
			var keys map[string]any
			_ = json.Unmarshal(w.Body.Bytes(), &keys)
			if len(keys) != 19 || w.Header().Get("ETag") != got.ETag {
				t.Fatal(keys)
			}
			if kind == "organic" && keys["education"] != nil {
				t.Fatal(keys)
			}
			if kind == "manual" && len(keys["education"].([]any)) != 0 {
				t.Fatal(keys)
			}
		})
	}
	for _, suffix := range []string{"/manual/bad", "/unknown/" + routeTestDraftID.String(), "/organic/" + uuid.NewString(), "/manual/" + routeTestDraftID.String() + "/participations/bad/cv", "/manual/" + routeTestDraftID.String() + "/participations/" + uuid.NewString() + "/cv"} {
		t.Run(suffix, func(t *testing.T) {
			w := doRouteRequest(t, router, "GET", orgCandidatesPath+suffix, "", headers)
			assertDraftRouteNoStore(t, w)
			if w.Code != 404 || routeCatalogCode(t, w) != "not_found" {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
	for _, kind := range []string{"manual", "organic"} {
		t.Run(kind+" CV", func(t *testing.T) {
			w := doRouteRequest(t, router, "GET", orgCandidatesPath+"/"+kind+"/"+routeTestDraftID.String()+"/participations/"+routeTestDraftID.String()+"/cv", "", headers)
			assertDraftRouteNoStore(t, w)
			if w.Code != 200 || w.Body.String() != "%PDF-x" || w.Header().Get("Content-Type") != "application/pdf" || w.Header().Get("Content-Disposition") != `attachment; filename="Exact CV.pdf"` || w.Header().Get("Content-Length") != "6" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatal(w.Code, w.Header(), w.Body.String())
			}
		})
	}
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{{"internal", errors.New("PRIVATE key"), 500, "internal_error"}, {"storage", board.ErrStorageUnavailable, 503, "cv_storage_unavailable"}} {
		t.Run(tc.name, func(t *testing.T) {
			reader.fail = tc.err
			w := doRouteRequest(t, router, "GET", orgCandidatesPath+"/manual/"+routeTestDraftID.String()+"/participations/"+routeTestDraftID.String()+"/cv", "", headers)
			if w.Code != tc.status || routeCatalogCode(t, w) != tc.code || strings.Contains(w.Body.String(), "PRIVATE") {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
}

func TestOrgCandidatesDetailGates(t *testing.T) {
	for _, suffix := range []string{"/manual/" + routeTestDraftID.String(), "/organic/" + routeTestDraftID.String() + "/participations/" + routeTestDraftID.String() + "/cv"} {
		for _, tc := range []struct {
			name    string
			headers map[string]string
			status  int
		}{
			{"anonymous", nil, 401}, {"candidate", map[string]string{"X-Test-Sub": "candidate"}, 403},
		} {
			t.Run(suffix+tc.name, func(t *testing.T) {
				w := doRouteRequest(t, orgCandidatesRouter(), "GET", orgCandidatesPath+suffix, "", tc.headers)
				if w.Code != tc.status {
					t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
				}
				assertDraftRouteNoStore(t, w)
			})
		}
	}
}
