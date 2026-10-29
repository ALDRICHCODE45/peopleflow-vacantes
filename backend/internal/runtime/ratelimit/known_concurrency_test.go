package ratelimit_test

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/ratelimit"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
)

// knownHarness routes /v2/assessments/{token}/{mode}: "slow" blocks until
// release and answers 200, "ok" answers 200, "gone" answers
// assessment_unavailable, "nf" answers the catch-all not_found, "boom" 500.
func knownHarness(l ratelimit.Limits) (http.Handler, chan struct{}, chan struct{}) {
	lim := ratelimit.NewAssessment(l, nil, nil)
	entered := make(chan struct{}, 1000)
	release := make(chan struct{})
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(lim.Middleware)
		r.Get("/v2/assessments/{token}/{mode}", func(w http.ResponseWriter, r *http.Request) {
			switch chi.URLParam(r, "mode") {
			case "slow":
				entered <- struct{}{}
				<-release
				w.WriteHeader(http.StatusOK)
			case "gone":
				httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeAssessmentUnavailable))
			case "nf":
				httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeNotFound))
			case "boom":
				httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
			default:
				w.WriteHeader(http.StatusOK)
			}
		})
	})
	return r, entered, release
}

func knownSend(h http.Handler, token, mode string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("GET", "/v2/assessments/"+token+"/"+mode, nil)
	r.RemoteAddr = "192.0.2.1:1234"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

// A NAT IP with many in-flight requests on tokens already proven valid is not
// limited below the contract budgets (300/token, 600/IP).
func TestKnownTokensAreNotConcurrencyLimited(t *testing.T) {
	h, entered, release := knownHarness(ratelimit.DefaultLimits())
	tokens := make([]string, 40)
	for i := range tokens {
		tokens[i] = "valid-" + string(rune('A'+i))
		if rec := knownSend(h, tokens[i], "ok"); rec.Code != 200 {
			t.Fatal("prime", i, rec.Code)
		}
	}
	var wg sync.WaitGroup
	var limited atomic.Int64
	for _, tok := range tokens {
		wg.Add(1)
		go func(tok string) {
			defer wg.Done()
			if knownSend(h, tok, "slow").Code == 429 {
				limited.Add(1)
			}
		}(tok)
	}
	in := 0
	deadline := time.After(2 * time.Second)
wait:
	for in+int(limited.Load()) < len(tokens) {
		select {
		case <-entered:
			in++
		case <-deadline:
			break wait
		case <-time.After(5 * time.Millisecond):
		}
	}
	got := knownSend(h, tokens[0], "ok")
	close(release)
	wg.Wait()
	if in != len(tokens) || got.Code != 200 {
		t.Fatalf("in-flight=%d limited=%d; known request below budgets: %d %q %q", in, limited.Load(), got.Code, got.Header().Get("Retry-After"), got.Body.String())
	}
}

// Responses that do not prove a token valid (catch-all 404, 5xx, unknown)
// never exempt it, so primed fake tokens cannot bypass the unknown budget.
func TestOnlyRealSuccessMarksATokenKnown(t *testing.T) {
	for _, prime := range []string{"nf", "boom", "gone"} {
		t.Run(prime, func(t *testing.T) {
			h, _, _ := knownHarness(ratelimit.Limits{PerToken: 100, PerIP: 1000, UnknownPerIP: 30, Window: 60e9, MaxKeys: 1000})
			tokens := make([]string, 40)
			for i := range tokens {
				tokens[i] = prime + "-" + string(rune('A'+i))
				knownSend(h, tokens[i], prime)
			}
			// After at most 30 unknown lookups (including "gone" primes) the IP is blocked.
			var admitted atomic.Int64
			var wg sync.WaitGroup
			for _, tok := range tokens {
				wg.Add(1)
				go func(tok string) {
					defer wg.Done()
					if knownSend(h, tok, "gone").Code != 429 {
						admitted.Add(1)
					}
				}(tok)
			}
			wg.Wait()
			limit := int64(30)
			if prime == "gone" {
				limit = 0 // the 40 primes already exhausted the budget after 30
			}
			if admitted.Load() > limit {
				t.Fatalf("admitted %d unknown lookups after %s primes, want <= %d", admitted.Load(), prime, limit)
			}
		})
	}
}

// A known token that later answers assessment_unavailable (revoked) loses its
// exemption and its lookup is counted.
func TestKnownTokenThatTurnsUnknownIsCounted(t *testing.T) {
	h, _, _ := knownHarness(ratelimit.Limits{PerToken: 100, PerIP: 1000, UnknownPerIP: 2, Window: 60e9, MaxKeys: 1000})
	knownSend(h, "t", "ok")
	knownSend(h, "t", "gone")
	knownSend(h, "t", "gone")
	if rec := knownSend(h, "other", "ok"); rec.Code != 429 {
		t.Fatalf("unknown lookups on a formerly known token not counted: %d", rec.Code)
	}
}
