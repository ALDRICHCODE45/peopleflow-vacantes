package httpjson

import (
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

func TestRateLimitErrorCatalog(t *testing.T) {
	def := Resolve(CodeRateLimited)
	if def.Code != CodeRateLimited || def.Status != 429 || def.Message != "too many requests" {
		t.Fatalf("%+v", def)
	}
	codes := RateLimitErrorCodes()
	if !reflect.DeepEqual(codes, []Code{CodeRateLimited}) {
		t.Fatal(codes)
	}
	codes[0] = "changed"
	if reflect.DeepEqual(codes, RateLimitErrorCodes()) {
		t.Fatal("shared backing slice")
	}
}

type rateCodeRecorder struct {
	*httptest.ResponseRecorder
	code string
}

func (c *rateCodeRecorder) RecordCatalogCode(code string) { c.code = code }

func TestWriteRateLimitedEnvelopeAndRetryAfter(t *testing.T) {
	for _, tc := range []struct {
		wait time.Duration
		want string
	}{{0, "1"}, {-time.Second, "1"}, {time.Millisecond, "1"}, {time.Second, "1"}, {1001 * time.Millisecond, "2"}, {10 * time.Minute, "600"}} {
		rec := &rateCodeRecorder{ResponseRecorder: httptest.NewRecorder()}
		WriteRateLimited(rec, tc.wait)
		if rec.Code != 429 || rec.Header().Get("Retry-After") != tc.want || rec.code != string(CodeRateLimited) {
			t.Fatalf("%v: %d %q %q", tc.wait, rec.Code, rec.Header().Get("Retry-After"), rec.code)
		}
		if got := rec.Body.String(); got != "{\"error\":\"too many requests\",\"code\":\"rate_limited\"}\n" {
			t.Fatalf("%v: body %q", tc.wait, got)
		}
	}
}
