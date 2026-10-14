package localbootstrap

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
)

const (
	handlerAddr  = "127.0.0.1:8081"
	handlerKey   = "keykeykeykeykeykeykeykeykeykeyke"
	accessToken  = "test-access-token-value"
	testSubject  = "sub-1"
	testEmail    = "user@example.com"
	testFullName = "Ada Lovelace"
)

type handlerHarness struct {
	handler *Handler
	clock   *fakeClock
	coord   *Coordinator
	verify  *fakeVerifier
	info    *fakeUserInfo
	creator *fakeCreator
	applied atomic.Int32
}

func newHandlerHarness(t *testing.T) *handlerHarness {
	t.Helper()
	h := &handlerHarness{
		clock:   newFakeClock(),
		verify:  &fakeVerifier{claims: security.Claims{Subject: testSubject}},
		info:    &fakeUserInfo{info: UserInfo{Subject: testSubject, Email: testEmail, FullName: testFullName}},
		creator: &fakeCreator{code: CreateCodeCreated},
	}
	h.coord = NewCoordinator(h.clock.Now)
	h.handler = NewHandler(HandlerConfig{
		Addr:        handlerAddr,
		Key:         []byte(handlerKey),
		Verifier:    h.verify,
		UserInfo:    h.info,
		Coordinator: h.coord,
		Creator:     h.creator,
		UserType:    valueobjects.UserRecruiter,
		Database:    DatabaseTarget{Host: "127.0.0.1", Port: "5432", Name: "local_db"},
		Now:         h.clock.Now,
		OnApplied:   func() { h.applied.Add(1) },
	})
	return h
}

func (h *handlerHarness) do(method, path, body string, mutate func(*http.Request)) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.RemoteAddr = "127.0.0.1:55555"
	req.Host = handlerAddr
	req.Header.Set("X-Local-Bootstrap-Key", handlerKey)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	if mutate != nil {
		mutate(req)
	}
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	return rec
}

func assertErrorBody(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if rec.Code != status {
		t.Errorf("status = %d, want %d (body %q)", rec.Code, status, rec.Body.String())
	}
	want := `{"ok":false,"code":"` + code + `"}`
	if got := rec.Body.String(); got != want {
		t.Errorf("body = %q, want %q", got, want)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	h := rec.Result().Header
	for key := range h {
		if strings.HasPrefix(strings.ToLower(key), "access-control-") {
			t.Errorf("unexpected CORS header %q", key)
		}
	}
}

func (h *handlerHarness) stageOK(t *testing.T) string {
	t.Helper()
	rec := h.do(http.MethodPost, "/stage", "{}", nil)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("stage status = %d, want 202 (body %q)", rec.Code, rec.Body.String())
	}
	var body struct {
		OK            bool   `json:"ok"`
		OperationCode string `json:"operation_code"`
		ExpiresIn     int    `json:"expires_in"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("stage body is not JSON: %v (%q)", err, rec.Body.String())
	}
	if !body.OK || body.ExpiresIn != 60 || len(body.OperationCode) != 26 {
		t.Fatalf("stage body = %+v, want ok=true expires_in=60 and a 26-char code", body)
	}
	if !validOperationCode(body.OperationCode) {
		t.Fatalf("stage operation_code %q is not valid base32", body.OperationCode)
	}
	if strings.Contains(rec.Body.String(), accessToken) {
		t.Fatalf("stage body leaked the access token: %q", rec.Body.String())
	}
	return body.OperationCode
}

func (h *handlerHarness) approve(t *testing.T, code string) {
	t.Helper()
	if err := h.coord.Approve(code); err != nil {
		t.Fatalf("Approve(%q): %v", code, err)
	}
}

func TestHandler_SourceKeyAndHostGuards(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*http.Request)
	}{
		{name: "missing bridge key", mutate: func(r *http.Request) { r.Header.Del("X-Local-Bootstrap-Key") }},
		{name: "wrong bridge key", mutate: func(r *http.Request) { r.Header.Set("X-Local-Bootstrap-Key", "wrong") }},
		{name: "non loopback remote", mutate: func(r *http.Request) { r.RemoteAddr = "10.0.0.5:55555" }},
		{name: "wrong host", mutate: func(r *http.Request) { r.Host = "localhost:8081" }},
		{name: "host without port", mutate: func(r *http.Request) { r.Host = "127.0.0.1" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHandlerHarness(t)
			rec := h.do(http.MethodPost, "/stage", "{}", tt.mutate)

			assertErrorBody(t, rec, http.StatusForbidden, codeBootstrapForbidden)
			if h.verify.callCount() != 0 || h.info.callCount() != 0 || h.creator.callCount() != 0 {
				t.Errorf("guarded request reached dependencies: verify=%d info=%d create=%d",
					h.verify.callCount(), h.info.callCount(), h.creator.callCount())
			}
			if h.coord.Pending() {
				t.Errorf("guarded request staged a candidate")
			}
		})
	}
}

func TestHandler_StatusAndBody(t *testing.T) {
	h := newHandlerHarness(t)

	t.Run("GET is rejected without a write", func(t *testing.T) {
		for _, path := range []string{"/stage", "/apply"} {
			rec := h.do(http.MethodGet, path, "", nil)
			assertErrorBody(t, rec, http.StatusMethodNotAllowed, codeInvalidRequest)
		}
		if h.coord.Pending() || h.creator.callCount() != 0 || h.info.callCount() != 0 {
			t.Errorf("GET caused work: pending=%v create=%d info=%d", h.coord.Pending(), h.creator.callCount(), h.info.callCount())
		}
	})

	t.Run("unknown path is not found", func(t *testing.T) {
		rec := h.do(http.MethodPost, "/other", "{}", nil)
		assertErrorBody(t, rec, http.StatusNotFound, codeInvalidRequest)
	})

	t.Run("missing token is unauthenticated before verification", func(t *testing.T) {
		rec := h.do(http.MethodPost, "/stage", "{}", func(r *http.Request) { r.Header.Del("Authorization") })
		assertErrorBody(t, rec, http.StatusUnauthorized, codeUnauthenticated)
		if h.verify.callCount() != 0 {
			t.Errorf("verifier calls = %d, want 0 without a bearer token", h.verify.callCount())
		}
	})

	t.Run("wrong scheme is unauthenticated", func(t *testing.T) {
		rec := h.do(http.MethodPost, "/stage", "{}", func(r *http.Request) { r.Header.Set("Authorization", "Basic abc") })
		assertErrorBody(t, rec, http.StatusUnauthorized, codeUnauthenticated)
	})

	t.Run("invalid token is unauthenticated", func(t *testing.T) {
		h.verify.err = errVerifierReject
		rec := h.do(http.MethodPost, "/stage", "{}", nil)
		assertErrorBody(t, rec, http.StatusUnauthorized, codeUnauthenticated)
		if h.info.callCount() != 0 {
			t.Errorf("UserInfo callCount = %d, want 0 after a rejected token", h.info.callCount())
		}
		h.verify.err = nil
	})
}

func TestHandler_Stage_BodyGuards(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		contentType string
	}{
		{name: "non json content type", body: "{}", contentType: "text/plain"},
		{name: "unknown field", body: `{"extra":1}`},
		{name: "trailing json", body: "{} {}"},
		{name: "empty body", body: ""},
		{name: "garbage", body: "not-json"},
		{name: "oversized body", body: "{" + strings.Repeat("a", 5000) + "}"},
		{name: "array body", body: "[]"},
		{name: "null body", body: "null"},
		{name: "whitespace null body", body: " \n null \t"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHandlerHarness(t)
			rec := h.do(http.MethodPost, "/stage", tt.body, func(r *http.Request) {
				if tt.contentType != "" {
					r.Header.Set("Content-Type", tt.contentType)
				}
			})
			assertErrorBody(t, rec, http.StatusBadRequest, codeInvalidRequest)
			if h.coord.Pending() {
				t.Errorf("malformed stage installed a candidate")
			}
			if h.verify.callCount() != 0 || h.info.callCount() != 0 || h.creator.callCount() != 0 || h.applied.Load() != 0 {
				t.Errorf("malformed stage reached dependencies: verify=%d info=%d", h.verify.callCount(), h.info.callCount())
			}
		})
	}
}

func TestHandler_Apply_BodyGuards(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "missing operation code", body: "{}"},
		{name: "unknown field", body: `{"operation_code":"AAAAAAAAAAAAAAAAAAAAAAAAAA","extra":1}`},
		{name: "wrong code format lowercase", body: `{"operation_code":"aaaa"}`},
		{name: "wrong code length", body: `{"operation_code":"AAAA"}`},
		{name: "trailing json", body: `{"operation_code":"AAAAAAAAAAAAAAAAAAAAAAAAAA"} {}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHandlerHarness(t)
			rec := h.do(http.MethodPost, "/apply", tt.body, nil)
			assertErrorBody(t, rec, http.StatusBadRequest, codeInvalidRequest)
			if h.creator.callCount() != 0 {
				t.Errorf("malformed apply reached the creator")
			}
		})
	}
}

func TestHandler_Stage_HappyPath(t *testing.T) {
	h := newHandlerHarness(t)
	code := h.stageOK(t)

	if h.verify.callCount() != 1 || h.info.callCount() != 1 {
		t.Fatalf("verify=%d info=%d, want exactly one call each", h.verify.callCount(), h.info.callCount())
	}
	cand, err := h.coord.WaitForCandidate(t.Context())
	if err != nil {
		t.Fatalf("WaitForCandidate: %v", err)
	}
	if cand.Subject != testSubject || cand.Email != testEmail || cand.FullName != testFullName {
		t.Errorf("candidate = %+v, want the verified identity", cand)
	}
	if cand.UserType != valueobjects.UserRecruiter {
		t.Errorf("candidate.Type = %v, want recruiter", cand.UserType)
	}
	if cand.Database.Display() != "127.0.0.1:5432/local_db" {
		t.Errorf("candidate.Database = %q", cand.Database.Display())
	}
	if cand.OperationCode != code {
		t.Errorf("candidate code = %q, want the returned %q", cand.OperationCode, code)
	}
	if !cand.ExpiresAt.Equal(h.clock.Now().Add(OperationTTL)) {
		t.Errorf("candidate expiry = %v, want now+TTL", cand.ExpiresAt)
	}
}

func TestHandler_Stage_SecondRejected(t *testing.T) {
	h := newHandlerHarness(t)
	first := h.stageOK(t)

	rec := h.do(http.MethodPost, "/stage", "{}", nil)
	assertErrorBody(t, rec, http.StatusConflict, codeStagePending)

	if h.info.callCount() != 1 {
		t.Errorf("UserInfo callCount = %d, want 1 (second stage must be rejected before provider calls)", h.info.callCount())
	}
	candidate, err := h.coord.WaitForCandidate(t.Context())
	if err != nil {
		t.Fatalf("WaitForCandidate: %v", err)
	}
	if candidate.OperationCode != first {
		t.Errorf("candidate code = %q, want the immutable first code %q", candidate.OperationCode, first)
	}
}

func TestHandler_Stage_ProviderFailures(t *testing.T) {
	t.Run("unavailable", func(t *testing.T) {
		h := newHandlerHarness(t)
		h.info.err = ErrUserInfoUnavailable
		rec := h.do(http.MethodPost, "/stage", "{}", nil)
		assertErrorBody(t, rec, http.StatusBadGateway, codeIdentityProviderUnavailable)
		if h.coord.Pending() {
			t.Errorf("unavailable provider still staged a candidate")
		}
	})

	t.Run("invalid attributes", func(t *testing.T) {
		h := newHandlerHarness(t)
		h.info.err = ErrUserInfoInvalid
		rec := h.do(http.MethodPost, "/stage", "{}", nil)
		assertErrorBody(t, rec, http.StatusBadRequest, codeInvalidRequest)
		if h.coord.Pending() {
			t.Errorf("invalid attributes still staged a candidate")
		}
	})

	t.Run("subject mismatch", func(t *testing.T) {
		h := newHandlerHarness(t)
		h.info.info.Subject = "different-sub"
		rec := h.do(http.MethodPost, "/stage", "{}", nil)
		assertErrorBody(t, rec, http.StatusBadRequest, codeInvalidRequest)
		if h.coord.Pending() {
			t.Errorf("subject mismatch still staged a candidate")
		}
	})

	t.Run("invalid email", func(t *testing.T) {
		h := newHandlerHarness(t)
		h.info.info.Email = "not-an-email"
		rec := h.do(http.MethodPost, "/stage", "{}", nil)
		assertErrorBody(t, rec, http.StatusBadRequest, codeInvalidRequest)
		if h.coord.Pending() {
			t.Errorf("invalid email still staged a candidate")
		}
	})

	t.Run("invalid name", func(t *testing.T) {
		h := newHandlerHarness(t)
		h.info.info.FullName = "x"
		rec := h.do(http.MethodPost, "/stage", "{}", nil)
		assertErrorBody(t, rec, http.StatusBadRequest, codeInvalidRequest)
		if h.coord.Pending() {
			t.Errorf("invalid name still staged a candidate")
		}
	})
}

func TestHandler_Stage_ExpiryDuringVerification(t *testing.T) {
	h := newHandlerHarness(t)
	h.info.fetchHook = func() { h.clock.Advance(OperationTTL + time.Second) }

	rec := h.do(http.MethodPost, "/stage", "{}", nil)

	assertErrorBody(t, rec, http.StatusGone, codeOperationExpired)
	if h.coord.Pending() {
		t.Errorf("an operation that expired during verification still staged a candidate")
	}
}

func TestHandler_Stage_ReplaceAfterExpiry(t *testing.T) {
	h := newHandlerHarness(t)
	first := h.stageOK(t)
	h.clock.Advance(OperationTTL + time.Second)
	second := h.stageOK(t)
	if first == second {
		t.Errorf("stage after expiry reused the expired code %q", first)
	}
}

func TestHandler_Apply_RequiresApproval(t *testing.T) {
	t.Run("no stage", func(t *testing.T) {
		h := newHandlerHarness(t)
		rec := h.do(http.MethodPost, "/apply", `{"operation_code":"`+strings.Repeat("A", 26)+`"}`, nil)
		assertErrorBody(t, rec, http.StatusConflict, codeApprovalRequired)
		if h.creator.callCount() != 0 {
			t.Errorf("unapproved apply reached the creator")
		}
	})

	t.Run("staged but unapproved", func(t *testing.T) {
		h := newHandlerHarness(t)
		code := h.stageOK(t)
		rec := h.do(http.MethodPost, "/apply", `{"operation_code":"`+code+`"}`, nil)
		assertErrorBody(t, rec, http.StatusConflict, codeApprovalRequired)
		if h.creator.callCount() != 0 {
			t.Errorf("unapproved apply reached the creator")
		}
		if h.info.callCount() != 1 {
			t.Errorf("unapproved apply made an extra UserInfo call: %d", h.info.callCount())
		}
	})

	t.Run("wrong code", func(t *testing.T) {
		h := newHandlerHarness(t)
		code := h.stageOK(t)
		h.approve(t, code)
		other := strings.Repeat("A", 26)
		if other == code {
			other = strings.Repeat("B", 26)
		}
		rec := h.do(http.MethodPost, "/apply", `{"operation_code":"`+other+`"}`, nil)
		assertErrorBody(t, rec, http.StatusConflict, codeApprovalRequired)
		if h.creator.callCount() != 0 {
			t.Errorf("wrong-code apply reached the creator")
		}
	})
}

func TestHandler_Apply_HappyPath(t *testing.T) {
	h := newHandlerHarness(t)
	code := h.stageOK(t)
	h.approve(t, code)

	rec := h.do(http.MethodPost, "/apply", `{"operation_code":"`+code+`"}`, nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("apply status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
	}
	if got, want := rec.Body.String(), `{"ok":true,"code":"created"}`; got != want {
		t.Errorf("apply body = %q, want %q", got, want)
	}
	if h.creator.callCount() != 1 {
		t.Fatalf("creator calls = %d, want exactly 1", h.creator.callCount())
	}
	if h.applied.Load() != 1 {
		t.Errorf("OnApplied count = %d, want 1", h.applied.Load())
	}
	cmd := h.creator.lastCommand()
	if cmd.CognitoSub != testSubject || cmd.Email != testEmail || cmd.FullName != testFullName || cmd.UserType != "recruiter" {
		t.Errorf("creation command = %+v, want the verified recruiter identity", cmd)
	}
}

func TestHandler_Apply_AlreadyExists(t *testing.T) {
	h := newHandlerHarness(t)
	h.creator.code = CreateCodeAlreadyExists
	code := h.stageOK(t)
	h.approve(t, code)

	rec := h.do(http.MethodPost, "/apply", `{"operation_code":"`+code+`"}`, nil)

	if got, want := rec.Body.String(), `{"ok":true,"code":"already_exists"}`; got != want {
		t.Errorf("apply body = %q, want %q", got, want)
	}
}

func TestHandler_Apply_Replay(t *testing.T) {
	h := newHandlerHarness(t)
	code := h.stageOK(t)
	h.approve(t, code)

	if rec := h.do(http.MethodPost, "/apply", `{"operation_code":"`+code+`"}`, nil); rec.Code != http.StatusOK {
		t.Fatalf("first apply status = %d, want 200", rec.Code)
	}
	rec := h.do(http.MethodPost, "/apply", `{"operation_code":"`+code+`"}`, nil)
	assertErrorBody(t, rec, http.StatusConflict, codeApprovalRequired)
	if h.creator.callCount() != 1 {
		t.Errorf("creator calls = %d after replay, want exactly 1", h.creator.callCount())
	}
}

func TestHandler_Apply_IdentityConflict(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*handlerHarness)
	}{
		{name: "different email", mutate: func(h *handlerHarness) { h.info.info.Email = "other@example.com" }},
		{name: "different name", mutate: func(h *handlerHarness) { h.info.info.FullName = "Grace Hopper" }},
		{name: "different subject", mutate: func(h *handlerHarness) { h.info.info.Subject = "sub-2"; h.verify.claims.Subject = "sub-2" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHandlerHarness(t)
			code := h.stageOK(t)
			h.approve(t, code)
			tt.mutate(h)

			rec := h.do(http.MethodPost, "/apply", `{"operation_code":"`+code+`"}`, nil)

			assertErrorBody(t, rec, http.StatusConflict, codeIdentityConflict)
			if h.creator.callCount() != 0 {
				t.Errorf("conflicting apply reached the creator")
			}
			if err := h.coord.CheckApproval(code); err != nil {
				t.Errorf("grant was cleared on conflict: %v", err)
			}
		})
	}
}

func TestHandler_Apply_Expired(t *testing.T) {
	h := newHandlerHarness(t)
	code := h.stageOK(t)
	h.approve(t, code)
	h.clock.Advance(OperationTTL + time.Second)

	rec := h.do(http.MethodPost, "/apply", `{"operation_code":"`+code+`"}`, nil)
	assertErrorBody(t, rec, http.StatusGone, codeOperationExpired)
	if h.creator.callCount() != 0 {
		t.Errorf("expired apply reached the creator")
	}
}

func TestHandler_Apply_CreatorErrors(t *testing.T) {
	tests := []struct {
		name       string
		creatorErr error
		wantStatus int
		wantCode   string
	}{
		{name: "identity conflict", creatorErr: ErrIdentityConflict, wantStatus: http.StatusConflict, wantCode: codeIdentityConflict},
		{name: "ambiguous failure", creatorErr: errVerifierReject, wantStatus: http.StatusInternalServerError, wantCode: codeBootstrapFailed},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHandlerHarness(t)
			h.creator.err = tt.creatorErr
			code := h.stageOK(t)
			h.approve(t, code)

			rec := h.do(http.MethodPost, "/apply", `{"operation_code":"`+code+`"}`, nil)

			assertErrorBody(t, rec, tt.wantStatus, tt.wantCode)
			if h.creator.callCount() != 1 {
				t.Errorf("creator calls = %d, want exactly 1 (no retry)", h.creator.callCount())
			}
			if h.applied.Load() != 1 {
				t.Errorf("OnApplied count = %d, want 1 after the single attempt", h.applied.Load())
			}
		})
	}
}
