package ratelimit_test

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/ratelimit"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
)

// validationHarness routes /v2/assessments/{token}/{mode} with a fake clock:
// "ok" 200, "gone" assessment_unavailable, "nf" catch-all 404, "boom" 500.
func validationHarness() (func(token, mode string) *httptest.ResponseRecorder, *clock) {
	c := &clock{t: time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)}
	lim := ratelimit.NewAssessment(ratelimit.DefaultLimits(), nil, c.now)
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(lim.Middleware)
		r.Get("/v2/assessments/{token}/{mode}", func(w http.ResponseWriter, r *http.Request) {
			switch chi.URLParam(r, "mode") {
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
	return func(token, mode string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/v2/assessments/"+token+"/"+mode, nil)
		req.RemoteAddr = "192.0.2.1:1234"
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec
	}, c
}

// exhaust spends n of the IP's unknown lookups with fresh tokens.
func exhaust(t *testing.T, send func(string, string) *httptest.ResponseRecorder, tag string, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		if rec := send(tag+strconv.Itoa(i), "gone"); rec.Code != 404 {
			t.Fatal("exhaust", i, rec.Code)
		}
	}
}

func TestExhaustedUnknownBudgetSparesValidatedTokens(t *testing.T) {
	send, c := validationHarness()
	if rec := send("valid", "ok"); rec.Code != 200 {
		t.Fatal(rec.Code)
	}
	exhaust(t, send, "x", 30)
	c.add(4 * time.Minute)
	if rec := send("valid", "ok"); rec.Code != 200 {
		t.Fatalf("validated token blocked by exhaustion: %d", rec.Code)
	}
	rec := send("fresh", "ok")
	if rec.Code != 429 || rec.Header().Get("Retry-After") != "360" {
		t.Fatalf("unvalidated token after exhaustion: %d %q", rec.Code, rec.Header().Get("Retry-After"))
	}
}

func TestValidationOutlivesTheWindowFor24Hours(t *testing.T) {
	send, c := validationHarness()
	send("valid", "ok")
	c.add(11 * time.Minute) // token and IP windows reset
	exhaust(t, send, "a", 30)
	if rec := send("valid", "ok"); rec.Code != 200 {
		t.Fatalf("validation lost at window reset: %d", rec.Code)
	}
	// Renewed just now; 24 h after this renewal it expires.
	c.add(24*time.Hour - time.Second)
	exhaust(t, send, "b", 30)
	if rec := send("valid", "ok"); rec.Code != 200 {
		t.Fatalf("validation expired before 24 h: %d", rec.Code)
	}
	// Renewed again; let it lapse past 24 h without traffic.
	c.add(24*time.Hour + time.Minute)
	exhaust(t, send, "c", 30)
	if rec := send("valid", "ok"); rec.Code != 429 {
		t.Fatalf("validation survived past 24 h: %d", rec.Code)
	}
}

func TestOnlyAssessmentUnavailableClearsValidation(t *testing.T) {
	for _, tc := range []struct {
		mode  string
		clear bool
	}{{"nf", false}, {"boom", false}, {"gone", true}} {
		t.Run(tc.mode, func(t *testing.T) {
			send, _ := validationHarness()
			send("valid", "ok")
			send("valid", tc.mode)
			spent := 0
			if tc.mode == "gone" {
				spent = 1 // the clearing answer is itself an unknown lookup
			}
			exhaust(t, send, "x", 30-spent)
			rec := send("valid", "ok")
			if tc.clear && rec.Code != 429 || !tc.clear && rec.Code != 200 {
				t.Fatalf("after %s: %d", tc.mode, rec.Code)
			}
		})
	}
}
