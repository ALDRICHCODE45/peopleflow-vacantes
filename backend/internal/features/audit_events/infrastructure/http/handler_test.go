package http

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/application/auditlog"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/google/uuid"
)

func TestGuardFormula(t *testing.T) {
	for in, want := range map[string]string{
		"":               "",
		"plain":          "plain",
		"=SUM(A1)":       "'=SUM(A1)",
		"+52 33":         "'+52 33",
		"-1":             "'-1",
		"@cmd":           "'@cmd",
		"\tcell":         "'\tcell",
		"\rcell":         "'\rcell",
		"a=b":            "a=b",
		"'=already":      "'=already",
		"2025-03-10":     "2025-03-10",
		"{\"a\":\"=1\"}": "{\"a\":\"=1\"}",
	} {
		if got := guardFormula(in); got != want {
			t.Errorf("guardFormula(%q) = %q, want %q", in, got, want)
		}
	}
}

type fakeStream struct {
	batches [][]app.ExportRow
	failAt  int // 1-based call that errors; 0 never
	calls   int
	closed  bool
}

func (s *fakeStream) RowCount() int { return 2 }
func (s *fakeStream) Close() error  { s.closed = true; return nil }
func (s *fakeStream) Next(context.Context) ([]app.ExportRow, error) {
	s.calls++
	if s.failAt != 0 && s.calls == s.failAt {
		return nil, errors.New("connection lost")
	}
	if s.calls > len(s.batches) {
		return nil, nil
	}
	return s.batches[s.calls-1], nil
}

type fakeReader struct{ stream *fakeStream }

func (fakeReader) List(context.Context, uuid.UUID, app.Query) (app.Page, error) {
	return app.Page{}, nil
}
func (fakeReader) Actors(context.Context, uuid.UUID) ([]app.ActorOption, error)      { return nil, nil }
func (fakeReader) Vacancies(context.Context, uuid.UUID) ([]app.VacancyOption, error) { return nil, nil }
func (r fakeReader) Export(context.Context, app.ExportRequest) (app.ExportStream, error) {
	return r.stream, nil
}

func exportRow(eventType string) app.ExportRow {
	return app.ExportRow{OccurredAt: time.Date(2025, 3, 10, 12, 0, 0, 0, time.UTC), EventType: eventType, Category: "session", EntityType: "user", EntityID: uuid.New(), Metadata: []byte("{}")}
}

func serveExport(t *testing.T, stream *fakeStream) *http.Response {
	t.Helper()
	handler := NewHandler(app.NewService(fakeReader{stream}))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cc := security.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()}
		handler.Export(w, r.WithContext(security.ContextWithCompanyContext(r.Context(), cc)))
	}))
	t.Cleanup(server.Close)
	resp, err := http.Post(server.URL, "application/json", strings.NewReader(`{"from":"2025-03-10","to":"2025-03-10"}`))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// A failure after the 200 is on the wire must not look like a complete file.
func TestExportAbortsTheConnectionWhenTheStreamFailsMidway(t *testing.T) {
	stream := &fakeStream{batches: [][]app.ExportRow{{exportRow("SessionStarted")}, {exportRow("SessionEnded")}}, failAt: 2}
	resp := serveExport(t, stream)
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if _, err := io.ReadAll(resp.Body); err == nil {
		t.Fatal("a stream that failed midway ended like a complete download")
	}
	if !stream.closed {
		t.Fatal("the stream was not closed")
	}
}

func TestExportCompletesWhenTheStreamDoes(t *testing.T) {
	stream := &fakeStream{batches: [][]app.ExportRow{{exportRow("SessionStarted")}, {exportRow("SessionEnded")}}}
	resp := serveExport(t, stream)
	body, err := io.ReadAll(resp.Body)
	if err != nil || !strings.HasPrefix(string(body), "\xEF\xBB\xBFoccurred_at,") || strings.Count(string(body), "\n") != 3 || !stream.closed {
		t.Fatalf("%v %q closed=%v", err, body, stream.closed)
	}
}
