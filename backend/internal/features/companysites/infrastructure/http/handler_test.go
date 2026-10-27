package http

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/google/uuid"
)

type stubStore struct {
	current   app.Current
	saveErr   error
	calls     int
	available bool
}

func (s *stubStore) Get(context.Context, uuid.UUID, uuid.UUID) (app.Current, error) {
	return s.current, nil
}
func (s *stubStore) Save(context.Context, uuid.UUID, uuid.UUID, int64, *app.Document) (app.Current, error) {
	s.calls++
	return s.current, s.saveErr
}
func (s *stubStore) Publish(context.Context, uuid.UUID, uuid.UUID, int64) (app.Current, error) {
	s.calls++
	return s.current, s.saveErr
}
func (s *stubStore) Unpublish(context.Context, uuid.UUID, uuid.UUID) (app.Current, error) {
	s.calls++
	return s.current, s.saveErr
}
func (s *stubStore) SlugAvailable(context.Context, uuid.UUID, string) (bool, error) {
	return s.available, nil
}
func newTestHandler(s app.Store) *Handler {
	decode := func(raw []byte) (any, error) { var value any; err := json.Unmarshal(raw, &value); return value, err }
	rich := func(value any) (*app.RichDocument, error) {
		if value == nil {
			return nil, nil
		}
		return nil, fmt.Errorf("rich test adapter unavailable")
	}
	return New(s, decode, app.NewValidator(rich))
}
func call(t *testing.T, h http.HandlerFunc, body, match string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest("PUT", "/", strings.NewReader(body))
	r = r.WithContext(security.ContextWithCompanyContext(r.Context(), security.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()}))
	if match != "" {
		r.Header.Set("If-Match", match)
	}
	w := httptest.NewRecorder()
	h(w, r)
	return w
}
func TestPut(t *testing.T) {
	body := string(app.DefaultDocument())
	reserved := strings.Replace(body, `"slug":null`, `"slug":"admin"`, 1)
	tests := []struct {
		name, body, match string
		err               error
		status            int
		expected          string
		tag               string
	}{
		{"missing precondition", body, "", nil, 428, "{\"error\":\"precondition required\",\"code\":\"precondition_required\"}\n", ""},
		{"bad precondition", body, "1", nil, 400, "{\"error\":\"invalid request\",\"code\":\"invalid_request\"}\n", ""},
		{"wildcard", body, "*", nil, 400, "{\"error\":\"invalid request\",\"code\":\"invalid_request\"}\n", ""},
		{"malformed", "{", `"1"`, nil, 400, "{\"error\":\"invalid request\",\"code\":\"invalid_request\"}\n", ""},
		{"oversize", strings.Repeat(" ", 1<<20) + "x", `"1"`, nil, 413, "{\"error\":\"payload too large\",\"code\":\"payload_too_large\"}\n", ""},
		{"reserved", reserved, `"1"`, nil, 422, "{\"error\":\"slug reserved\",\"code\":\"slug_reserved\",\"field\":\"slug\"}\n", ""},
		{"taken", body, `"1"`, app.ErrSlugTaken, 409, "{\"error\":\"slug taken\",\"code\":\"slug_taken\",\"field\":\"slug\"}\n", ""},
		{"foreign media", body, `"1"`, &app.InvalidFields{Fields: []app.Field{{Field: "blocks[0].content.cover", Code: "invalid"}}}, 400, "{\"error\":\"validation failed\",\"code\":\"validation_error\",\"fields\":[{\"field\":\"blocks[0].content.cover\",\"code\":\"invalid\"}]}\n", ""},
		{"stale", body, `"1"`, app.ErrVersionConflict, 412, "", `"7"`},
		{"success", body, `"1"`, nil, 200, "", `"7"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &stubStore{current: app.Current{Draft: json.RawMessage(body), DraftVersion: 7, Media: []app.Media{}}, saveErr: tt.err}
			w := call(t, newTestHandler(s).Put, tt.body, tt.match)
			if w.Code != tt.status || w.Header().Get("ETag") != tt.tag {
				t.Fatalf("%d %s %s", w.Code, w.Header(), w.Body)
			}
			if tt.expected != "" && w.Body.String() != tt.expected {
				t.Fatalf("got %s want %s", w.Body, tt.expected)
			}
			if tt.status == 412 {
				var m map[string]json.RawMessage
				if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
					t.Fatal(err)
				}
				if len(m) != 3 || m["current"] == nil || string(m["code"]) != `"version_conflict"` {
					t.Fatal(w.Body)
				}
			}
		})
	}
}
func TestPutValidation(t *testing.T) {
	body := strings.Replace(string(app.DefaultDocument()), `"slug":null`, `"slug":"BAD","surprise":true`, 1)
	s := &stubStore{}
	w := call(t, newTestHandler(s).Put, body, `"1"`)
	want := "{\"error\":\"validation failed\",\"code\":\"validation_error\",\"fields\":[{\"field\":\"slug\",\"code\":\"invalid\"},{\"field\":\"surprise\",\"code\":\"unknown_key\"}]}\n"
	if w.Code != 400 || w.Body.String() != want || s.calls != 0 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}
func TestGetAndSlug(t *testing.T) {
	s := &stubStore{current: app.Current{Draft: app.DefaultDocument(), DraftVersion: 1, Media: []app.Media{}}}
	h := newTestHandler(s)
	w := call(t, h.Get, "", "")
	if w.Code != 200 || w.Header().Get("ETag") != `"1"` {
		t.Fatal(w)
	}
	for _, tt := range []struct {
		slug      string
		available bool
		reason    string
	}{{"abc", true, "null"}, {"abc", false, `"taken"`}, {"admin", false, `"reserved"`}, {"BAD", false, `"invalid"`}} {
		t.Run(tt.slug+tt.reason, func(t *testing.T) {
			s.available = tt.available
			r := httptest.NewRequest("GET", "/?slug="+tt.slug, nil)
			r = r.WithContext(security.ContextWithCompanyContext(r.Context(), security.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()}))
			w := httptest.NewRecorder()
			h.SlugAvailability(w, r)
			expected := `{"slug":"` + tt.slug + `","available":` + fmt.Sprint(tt.available) + `,"reason":` + tt.reason + "}\n"
			if w.Code != 200 || w.Body.String() != expected {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
		})
	}
}
