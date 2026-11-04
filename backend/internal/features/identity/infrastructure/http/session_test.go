package http

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
)

type sessionStoreSpy struct {
	subjects, events []string
	err              error
}

func (s *sessionStoreSpy) RecordSession(_ context.Context, subject, eventType string) error {
	s.subjects, s.events = append(s.subjects, subject), append(s.events, eventType)
	return s.err
}

func sessionRequest(subject string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/v2/me/session/start", nil)
	if subject != "" {
		req = req.WithContext(security.ContextWithClaims(req.Context(), security.Claims{Subject: subject}))
	}
	return req
}

func TestSessionHandlerRecordsTheSubjectsEvent(t *testing.T) {
	for _, tc := range []struct {
		name, event string
		call        func(*SessionHandler) http.HandlerFunc
	}{
		{"start", "SessionStarted", func(h *SessionHandler) http.HandlerFunc { return h.Start }},
		{"end", "SessionEnded", func(h *SessionHandler) http.HandlerFunc { return h.End }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &sessionStoreSpy{}
			rec := httptest.NewRecorder()
			tc.call(NewSessionHandler(usecases.NewSessions(store)))(rec, sessionRequest("sub-1"))
			if rec.Code != http.StatusNoContent || rec.Body.Len() != 0 || rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("status %d body %q cache %q", rec.Code, rec.Body.String(), rec.Header().Get("Cache-Control"))
			}
			if len(store.events) != 1 || store.subjects[0] != "sub-1" || store.events[0] != tc.event {
				t.Fatalf("recorded %v %v, want sub-1 %s", store.subjects, store.events, tc.event)
			}
		})
	}
}

func TestSessionHandlerRefusesWithoutASubjectOrOnFailure(t *testing.T) {
	store := &sessionStoreSpy{}
	h := NewSessionHandler(usecases.NewSessions(store))
	rec := httptest.NewRecorder()
	h.Start(rec, sessionRequest(""))
	if rec.Code != http.StatusUnauthorized || len(store.events) != 0 {
		t.Fatalf("no subject: status %d, %d events", rec.Code, len(store.events))
	}

	failing := NewSessionHandler(usecases.NewSessions(&sessionStoreSpy{err: errors.New("audit refused")}))
	rec = httptest.NewRecorder()
	failing.End(rec, sessionRequest("sub-1"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("store failure: status %d, want 500", rec.Code)
	}

	var unwired *SessionHandler
	rec = httptest.NewRecorder()
	unwired.Start(rec, sessionRequest("sub-1"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("unwired handler: status %d, want 500", rec.Code)
	}
}
