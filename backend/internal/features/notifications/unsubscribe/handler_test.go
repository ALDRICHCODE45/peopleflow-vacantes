package unsubscribe

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

const invalidBody = `{"error":"unsubscribe link invalid","code":"unsubscribe_link_invalid"}` + "\n"

const rateLimitedBody = `{"error":"too many requests","code":"rate_limited"}` + "\n"

// fakeStore records every call; a key in gone has no live target.
type fakeStore struct {
	mu        sync.Mutex
	targets   map[domain.PreferenceKey]Target
	reads     []domain.PreferenceKey
	writes    []domain.PreferenceKey
	failRead  error
	failWrite error
}

func (f *fakeStore) Target(_ context.Context, k domain.PreferenceKey) (Target, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reads = append(f.reads, k)
	if f.failRead != nil {
		return Target{}, f.failRead
	}
	t, ok := f.targets[k]
	if !ok {
		return Target{}, ErrNoTarget
	}
	return t, nil
}

func (f *fakeStore) TurnOff(_ context.Context, k domain.PreferenceKey) (Target, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.writes = append(f.writes, k)
	if f.failWrite != nil {
		return Target{}, f.failWrite
	}
	t, ok := f.targets[k]
	if !ok {
		return Target{}, ErrNoTarget
	}
	off := false
	t.Email = &off
	f.targets[k] = t
	return t, nil
}

type handlerWorld struct {
	now    time.Time
	signer *Signer
	store  *fakeStore
	h      http.Handler
	member domain.PreferenceKey
	cand   domain.PreferenceKey
}

func newHandlerWorld(t *testing.T) *handlerWorld {
	t.Helper()
	return newLimitedHandlerWorld(t, Limits{PerIP: 1000, PerToken: 1000, Window: time.Minute, MaxKeys: 10000})
}

func newLimitedHandlerWorld(t *testing.T, limits Limits) *handlerWorld {
	t.Helper()
	w := &handlerWorld{now: t0, store: &fakeStore{targets: map[domain.PreferenceKey]Target{}}}
	w.signer = newTestSigner(t, &w.now, Key{ID: "k1", Secret: secretA})
	w.member = memberKey()
	w.cand = candidateKey()
	name := "Acme Talento"
	w.store.targets[w.member] = Target{CompanyName: &name}
	w.store.targets[w.cand] = Target{}
	h := NewHandler(w.signer, w.store, NewLimiter(limits, clock(&w.now)))
	mux := http.NewServeMux()
	mux.Handle("GET /u", Privacy(http.HandlerFunc(h.Get)))
	mux.Handle("POST /u", Privacy(http.HandlerFunc(h.Post)))
	w.h = mux
	return w
}

func (w *handlerWorld) token(t *testing.T, k domain.PreferenceKey) string {
	t.Helper()
	tok, err := w.signer.Sign(k)
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func (w *handlerWorld) do(method, query, contentType, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "/u"+query, strings.NewReader(body))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	rec := httptest.NewRecorder()
	w.h.ServeHTTP(rec, req)
	return rec
}

func wantPrivate(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if rec.Header().Get("Cache-Control") != "no-store" || rec.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("privacy headers: %v", rec.Header())
	}
}

func TestGetReportsTheCurrentStateWithoutWriting(t *testing.T) {
	w := newHandlerWorld(t)
	on := true
	w.store.targets[w.member] = Target{CompanyName: w.store.targets[w.member].CompanyName, Email: &on}
	rec := w.do(http.MethodGet, "?token="+w.token(t, w.member), "", "")
	want := `{"type":"application_received","channel":"email","enabled":true,"company":{"id":"` + w.member.Company.String() + `","name":"Acme Talento"}}` + "\n"
	if rec.Code != 200 || rec.Body.String() != want {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	wantPrivate(t, rec)
	// No row: the default (member operational email off; candidate email on, Q1).
	w.store.targets[w.member] = Target{CompanyName: w.store.targets[w.member].CompanyName}
	if rec := w.do(http.MethodGet, "?token="+w.token(t, w.member), "", ""); !strings.Contains(rec.Body.String(), `"enabled":false`) {
		t.Fatalf("member default: %s", rec.Body.String())
	}
	rec = w.do(http.MethodGet, "?token="+w.token(t, w.cand), "", "")
	if want := `{"type":"candidate_status_changed","channel":"email","enabled":true,"company":null}` + "\n"; rec.Code != 200 || rec.Body.String() != want {
		t.Fatalf("candidate: %d %s", rec.Code, rec.Body.String())
	}
	if len(w.store.writes) != 0 || len(w.store.reads) != 3 {
		t.Fatalf("GET wrote: reads=%d writes=%d", len(w.store.reads), len(w.store.writes))
	}
}

func TestPostTurnsEmailOff(t *testing.T) {
	w := newHandlerWorld(t)
	tok := w.token(t, w.member)
	want := `{"type":"application_received","channel":"email","enabled":false,"company":{"id":"` + w.member.Company.String() + `","name":"Acme Talento"}}` + "\n"
	for name, body := range map[string][2]string{
		"one-click":     {"application/x-www-form-urlencoded", "List-Unsubscribe=One-Click"},
		"empty":         {"", ""},
		"empty object":  {"application/json", "{}"},
		"ignored body":  {"text/plain", "anything at all"},
		"exactly 1 KiB": {"text/plain", strings.Repeat("a", MaxBodyBytes)},
	} {
		rec := w.do(http.MethodPost, "?token="+tok, body[0], body[1])
		if rec.Code != 200 || rec.Body.String() != want {
			t.Fatalf("%s: %d %s", name, rec.Code, rec.Body.String())
		}
		wantPrivate(t, rec)
	}
	if len(w.store.writes) != 5 || w.store.writes[0] != w.member {
		t.Fatalf("writes %v", w.store.writes)
	}
	rec := w.do(http.MethodPost, "?token="+w.token(t, w.cand), "", "")
	if want := `{"type":"candidate_status_changed","channel":"email","enabled":false,"company":null}` + "\n"; rec.Code != 200 || rec.Body.String() != want {
		t.Fatalf("candidate: %d %s", rec.Code, rec.Body.String())
	}
}

func TestPostBodyCap(t *testing.T) {
	w := newHandlerWorld(t)
	rec := w.do(http.MethodPost, "?token="+w.token(t, w.member), "text/plain", strings.Repeat("a", MaxBodyBytes+1))
	if rec.Code != http.StatusRequestEntityTooLarge || rec.Body.String() != `{"error":"payload too large","code":"payload_too_large"}`+"\n" {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	wantPrivate(t, rec)
	if len(w.store.writes) != 0 {
		t.Fatal("an oversized body must write nothing")
	}
}

// Every invalid cause answers the same status and bytes, on both methods, and
// nothing is written.
func TestInvalidTokensAnswerIdentically(t *testing.T) {
	w := newHandlerWorld(t)
	valid := w.token(t, w.member)
	parts := strings.Split(valid, ".")
	x := jsonInt(t0.Add(time.Hour).Unix())
	gone := memberKey() // validly signed, but no live user / company
	expired := func() string {
		w.now = t0.Add(-366 * 24 * time.Hour)
		defer func() { w.now = t0 }()
		return w.token(t, w.member)
	}()
	causes := map[string]string{
		"missing":       "",
		"empty":         "?token=",
		"duplicated":    "?token=" + valid + "&token=" + valid,
		"malformed":     "?token=not-a-token",
		"too long":      "?token=" + strings.Repeat("A", MaxTokenLength+1),
		"bad mac":       "?token=" + parts[0] + "." + parts[1] + "." + mac(secretB, "k1", parts[1]),
		"unknown kid":   "?token=" + forge(secretA, "k7", mustDecode(t, parts[1])),
		"expired":       "?token=" + expired,
		"mandatory":     "?token=" + forge(secretA, "k1", `{"v":1,"u":"`+uuid.NewString()+`","c":"`+uuid.NewString()+`","t":"vacancy_reassigned","x":`+x+`}`),
		"wrong tree":    "?token=" + forge(secretA, "k1", `{"v":1,"u":"`+uuid.NewString()+`","c":null,"t":"application_received","x":`+x+`}`),
		"user gone":     "?token=" + w.token(t, gone),
		"escaped chars": "?token=" + url.QueryEscape(parts[0]+" ."+parts[1]+"."+parts[2]),
	}
	for name, q := range causes {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			rec := w.do(method, q, "", "")
			if rec.Code != http.StatusUnprocessableEntity || rec.Body.String() != invalidBody {
				t.Fatalf("%s %s: %d %s", method, name, rec.Code, rec.Body.String())
			}
			wantPrivate(t, rec)
		}
	}
	for _, k := range w.store.writes {
		if k != gone {
			t.Fatalf("only the gone key may reach the store's write (and find nothing): %v", w.store.writes)
		}
	}
	// A verifier without keys (mailer off) answers the same.
	h := NewHandler((*Signer)(nil), w.store, nil)
	rec := httptest.NewRecorder()
	h.Get(rec, httptest.NewRequest(http.MethodGet, "/u?token="+valid, nil))
	if rec.Code != 422 || rec.Body.String() != invalidBody {
		t.Fatalf("no keys: %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	NewHandler(nil, w.store, nil).Post(rec, httptest.NewRequest(http.MethodPost, "/u?token="+valid, nil))
	if rec.Code != 422 || rec.Body.String() != invalidBody {
		t.Fatalf("nil verifier: %d %s", rec.Code, rec.Body.String())
	}
}

const internalBody = `{"error":"an internal error occurred","code":"internal_error"}` + "\n"

// captureLogs routes slog's default logger to a buffer for the test.
func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

// A store failure is a 500 with the catalog body (never 200, never the
// uniform 422), logged with its step and SQLSTATE only — no token, user,
// company or type.
func TestStoreFailureIsAnObservableInternalError(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		w := newHandlerWorld(t)
		logs := captureLogs(t)
		failure := &storeError{step: "unsubscribe_upsert", err: &pgconn.PgError{Code: "40001", Message: "detail " + w.member.User.String()}}
		if method == http.MethodGet {
			failure.step = "target_read"
			w.store.failRead = failure
		} else {
			w.store.failWrite = failure
		}
		tok := w.token(t, w.member)
		rec := w.do(method, "?token="+tok, "", "")
		if rec.Code != 500 || rec.Body.String() != internalBody {
			t.Fatalf("%s: %d %s", method, rec.Code, rec.Body.String())
		}
		wantPrivate(t, rec)
		out := logs.String()
		if !strings.Contains(out, `"step":"`+failure.step+`"`) || !strings.Contains(out, `"sqlstate":"40001"`) {
			t.Fatalf("%s: log lacks step/sqlstate: %s", method, out)
		}
		for _, leak := range []string{w.member.User.String(), w.member.Company.String(), tok, "detail", "application_received"} {
			if strings.Contains(out, leak) {
				t.Fatalf("%s: log leaked %q: %s", method, leak, out)
			}
		}
	}
	// A non-database failure logs its step with an empty SQLSTATE.
	w := newHandlerWorld(t)
	logs := captureLogs(t)
	w.store.failWrite = &storeError{step: "tx", err: errors.New("conn reset")}
	if rec := w.do(http.MethodPost, "?token="+w.token(t, w.member), "", ""); rec.Code != 500 {
		t.Fatal(rec.Code)
	}
	if !strings.Contains(logs.String(), `"step":"tx"`) || !strings.Contains(logs.String(), `"sqlstate":""`) || strings.Contains(logs.String(), "conn reset") {
		t.Fatalf("%s", logs.String())
	}
}

// A user or company deleted between the check and the upsert (FK 23503) is
// the uniform invalid response, not a 500.
func TestTurnOffForeignKeyRaceIsInvalid(t *testing.T) {
	fk := &pgconn.PgError{Code: "23503"}
	if err := turnOffFailure(fmt.Errorf("wrapped: %w", fk)); !errors.Is(err, ErrNoTarget) {
		t.Fatalf("23503 → %v, want ErrNoTarget", err)
	}
	other := turnOffFailure(&pgconn.PgError{Code: "23514"})
	var se *storeError
	if errors.Is(other, ErrNoTarget) || !errors.As(other, &se) || se.step != "unsubscribe_upsert" {
		t.Fatalf("23514 → %v", other)
	}
	w := newHandlerWorld(t)
	w.store.failWrite = ErrNoTarget
	if rec := w.do(http.MethodPost, "?token="+w.token(t, w.member), "", ""); rec.Code != 422 || rec.Body.String() != invalidBody {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
}

// Policy: the per-IP budget counts only invalid-token requests; valid tokens
// are limited per preference key. 200 one-clicks with distinct valid tokens
// from one IP (a mail provider, the BFF) all succeed, while invalid tokens
// from that IP still hit 429 — and the 422s before it stay byte-identical.
func TestLimitPolicyInvalidPerIPValidPerToken(t *testing.T) {
	w := newLimitedHandlerWorld(t, Limits{PerIP: 3, PerToken: 2, Window: 10 * time.Minute, MaxKeys: 1000})
	name := "Acme"
	for i := 0; i < 200; i++ {
		k := memberKey()
		w.store.targets[k] = Target{CompanyName: &name}
		rec := w.do(http.MethodPost, "?token="+w.token(t, k), "application/x-www-form-urlencoded", "List-Unsubscribe=One-Click")
		if rec.Code != 200 {
			t.Fatalf("valid one-click %d: %d %s", i, rec.Code, rec.Body.String())
		}
	}
	for i, q := range []string{"?token=bad", "", "?token=" + w.token(t, w.member) + "x"} {
		if rec := w.do(http.MethodPost, q, "", ""); rec.Code != 422 || rec.Body.String() != invalidBody {
			t.Fatalf("invalid %d: %d %s", i, rec.Code, rec.Body.String())
		}
	}
	rec := w.do(http.MethodGet, "?token=bad", "", "")
	if rec.Code != 429 || rec.Body.String() != rateLimitedBody || rec.Header().Get("Retry-After") != "600" {
		t.Fatalf("4th invalid: %d %s %q", rec.Code, rec.Body.String(), rec.Header().Get("Retry-After"))
	}
	wantPrivate(t, rec)
	// Valid tokens from the same IP still pass; the same key is capped per token.
	tok := w.token(t, w.member)
	for i := 0; i < 2; i++ {
		if rec := w.do(http.MethodGet, "?token="+tok, "", ""); rec.Code != 200 {
			t.Fatalf("valid after the IP is limited: %d", rec.Code)
		}
	}
	if rec := w.do(http.MethodPost, "?token="+tok, "", ""); rec.Code != 429 || rec.Body.String() != rateLimitedBody {
		t.Fatalf("same key over its budget: %d %s", rec.Code, rec.Body.String())
	}
	if len(w.store.reads)+len(w.store.writes) != 202 {
		t.Fatalf("a limited request reached the store: reads=%d writes=%d", len(w.store.reads), len(w.store.writes))
	}
}
