package localbootstrap

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// TestIndependentDuplicateRequiredClaims is the independent verifier's public
// regression for blocker B1: a duplicate required claim must be rejected with
// the exact sanitized 400 invalid_request and zero writes, never silently
// resolved by map last-wins. It drives the real HTTP UserInfo client (dummy TLS
// provider -> actual client -> handler) for both the stage and apply phases.
func TestIndependentDuplicateRequiredClaims(t *testing.T) {
	cases := []struct{ name, body string }{
		{"verified", `{"sub":"sub-1","email":"user@example.com","name":"Ada Lovelace","email_verified":false,"email_verified":true}`},
		{"subject", `{"sub":"wrong-sub","sub":"sub-1","email":"user@example.com","name":"Ada Lovelace","email_verified":true}`},
		{"email", `{"sub":"sub-1","email":42,"email":"user@example.com","name":"Ada Lovelace","email_verified":true}`},
		{"name", `{"sub":"sub-1","email":"user@example.com","name":null,"name":"Ada Lovelace","email_verified":true}`},
		{"escaped-alias", `{"\u0073ub":"sub-1","sub":"sub-1","email":"user@example.com","name":"Ada Lovelace","email_verified":true}`},
	}
	for _, tc := range cases {
		for _, phase := range []string{"stage", "apply"} {
			t.Run(tc.name+"/"+phase, func(t *testing.T) {
				h := newHandlerHarness(t)
				var malformed atomic.Bool
				var calls atomic.Int32
				srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					if r.URL.Path != UserInfoPath || r.Method != "GET" || r.Header.Get("Authorization") != "Bearer "+accessToken {
						t.Error("unexpected provider request")
					}
					w.Header().Set("Content-Type", "application/json")
					if malformed.Load() {
						_, _ = w.Write([]byte(tc.body))
					} else {
						_, _ = w.Write([]byte(`{"sub":"sub-1","email":"user@example.com","name":"Ada Lovelace","email_verified":true}`))
					}
				}))
				defer srv.Close()
				client := NewHTTPUserInfoClient(srv.URL+UserInfoPath, time.Second)
				client.client = srv.Client()
				h.handler.cfg.UserInfo = client

				code := ""
				wantCalls := 1
				if phase == "apply" {
					code = h.stageOK(t)
					h.approve(t, code)
					wantCalls = 2
				}
				malformed.Store(true)
				body := "{}"
				if phase == "apply" {
					body = `{"operation_code":"` + code + `"}`
				}
				rec := h.do(http.MethodPost, "/"+phase, body, nil)

				assertErrorBody(t, rec, http.StatusBadRequest, "invalid_request")
				if calls.Load() != int32(wantCalls) || h.verify.callCount() != wantCalls {
					t.Errorf("provider/verifier counters=%d/%d want=%d", calls.Load(), h.verify.callCount(), wantCalls)
				}
				if h.creator.callCount() != 0 || h.creator.lastCommand() != (CreateUserCommand{}) || h.applied.Load() != 0 {
					t.Errorf("denied malformed profile reached creation: calls=%d applied=%d", h.creator.callCount(), h.applied.Load())
				}
				if phase == "stage" && h.coord.Pending() {
					t.Error("duplicate required claim installed candidate")
				}
				if phase == "apply" && h.coord.CheckApproval(code) != nil {
					t.Error("malformed profile consumed approved grant")
				}
			})
		}
	}
}
