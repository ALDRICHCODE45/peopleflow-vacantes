package httpjson

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const bodyLimitN int64 = 1_048_576

// mustJSONExact returns a valid single-value JSON object of exactly size bytes.
func mustJSONExact(size int) string {
	if size < 8 {
		panic("size too small")
	}
	return `{"k":"` + strings.Repeat("a", size-8) + `"}`
}

// newTestRequest builds a POST request; fixed=true pins Content-Length,
// fixed=false models a chunked-style request (ContentLength = -1, no header).
func newTestRequest(t *testing.T, body string, fixed bool) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/decode", strings.NewReader(body))
	if fixed {
		req.ContentLength = int64(len(body))
		req.Header.Set("Content-Length", strconv.Itoa(len(body)))
	} else {
		req.ContentLength = -1
		req.Header.Del("Content-Length")
	}
	return req
}

func wantDefinition(t *testing.T, got *Definition, wantCode Code, wantStatus int) {
	t.Helper()
	if got == nil {
		t.Fatalf("DecodeJSON returned nil, want definition %s/%d", wantCode, wantStatus)
	}
	if got.Code != wantCode || got.Status != wantStatus {
		t.Fatalf("DecodeJSON = %s/%d, want %s/%d", got.Code, got.Status, wantCode, wantStatus)
	}
}

func TestDecodeJSON_BodyLimit_NAndNPlusOne(t *testing.T) {
	cases := []struct {
		name   string
		size   int
		fixed  bool
		accept bool
	}{
		{"fixed_length_exact_n_valid_json_is_accepted", int(bodyLimitN), true, true},
		{"fixed_length_n_plus_one_is_413", int(bodyLimitN) + 1, true, false},
		{"chunked_exact_n_valid_json_is_accepted", int(bodyLimitN), false, true},
		{"chunked_n_plus_one_is_413", int(bodyLimitN) + 1, false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := newTestRequest(t, mustJSONExact(tc.size), tc.fixed)
			var dst struct {
				K string `json:"k"`
			}
			def := DecodeJSON(httptest.NewRecorder(), req, &dst, bodyLimitN)
			if !tc.accept {
				wantDefinition(t, def, CodePayloadTooLarge, http.StatusRequestEntityTooLarge)
				return
			}
			if def != nil {
				t.Fatalf("exact-N valid JSON rejected as %s/%d, want nil", def.Code, def.Status)
			}
			if len(dst.K) != tc.size-8 || strings.Trim(dst.K, "a") != "" {
				t.Fatalf("decoded payload wrong: len=%d", len(dst.K))
			}
		})
	}
}

func TestDecodeJSON_RequiresExactlyOneValue(t *testing.T) {
	cases := []struct {
		name   string
		body   string
		accept bool
	}{
		{"empty_body_is_rejected", "", false},
		{"malformed_json_is_rejected", `{"k":`, false},
		{"second_json_value_is_rejected", `{"k":"v"} {"k":"v"}`, false},
		{"trailing_non_whitespace_is_rejected", `{"k":"v"} trailing`, false},
		{"single_value_with_trailing_whitespace_is_accepted", "{\"k\":\"v\"}\n\t ", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := newTestRequest(t, tc.body, true)
			var dst struct {
				K string `json:"k"`
			}
			def := DecodeJSON(httptest.NewRecorder(), req, &dst, bodyLimitN)
			if !tc.accept {
				wantDefinition(t, def, CodeInvalidRequest, http.StatusBadRequest)
				return
			}
			if def != nil {
				t.Fatalf("single value + trailing whitespace rejected as %s/%d, want nil", def.Code, def.Status)
			}
			if dst.K != "v" {
				t.Fatalf("decoded K = %q, want %q", dst.K, "v")
			}
		})
	}
}

func TestDecodeJSON_NeverWritesResponse(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"failure_path_writes_nothing", `{"k":`},
		{"success_path_writes_nothing", `{"k":"v"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := newTestRequest(t, tc.body, true)
			var dst struct {
				K string `json:"k"`
			}
			_ = DecodeJSON(rec, req, &dst, bodyLimitN)
			if rec.Code != http.StatusOK || rec.Body.Len() != 0 {
				t.Fatalf("helper wrote a response: code=%d body=%q", rec.Code, rec.Body.String())
			}
		})
	}
}

// stagedBody returns data then err; wrapping *http.MaxBytesError with %w
// forces genuine errors.As classification instead of direct equality.
type stagedBody struct {
	data []byte
	err  error
	pos  int
}

func (s *stagedBody) Read(p []byte) (int, error) {
	if s.pos < len(s.data) {
		n := copy(p, s.data[s.pos:])
		s.pos += n
		return n, nil
	}
	return 0, s.err
}

func (s *stagedBody) Close() error { return nil }

func TestDecodeJSON_ClassifiesWrappedMaxBytesError(t *testing.T) {
	wrapped := fmt.Errorf("read request body: %w", &http.MaxBytesError{Limit: bodyLimitN})
	cases := []struct {
		name string
		body *stagedBody
	}{
		{"max_bytes_error_on_first_read", &stagedBody{err: wrapped}},
		// short valid JSON (well below N) first, then the wrapped error: the
		// first decode must succeed, so no MaxBytesReader limit can synthesize
		// this result — only the wrapped error on the post-value EOF read can.
		{"max_bytes_error_surfaced_after_full_data_at_eof_read", &stagedBody{data: []byte(`{"k":"v"}`), err: wrapped}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/decode", http.NoBody)
			req.Body = tc.body
			req.ContentLength = int64(len(tc.body.data))
			var dst struct {
				K string `json:"k"`
			}
			def := DecodeJSON(httptest.NewRecorder(), req, &dst, bodyLimitN)
			wantDefinition(t, def, CodePayloadTooLarge, http.StatusRequestEntityTooLarge)
		})
	}
}

func TestDecodeJSON_HandlerShortCircuitsUseCase(t *testing.T) {
	cases := []struct {
		name      string
		body      string
		wantCalls int
	}{
		{"malformed_body_never_invokes_use_case", `{"k":`, 0},
		{"second_value_never_invokes_use_case", `{"k":"v"} {"k":"v"}`, 0},
		{"oversized_body_never_invokes_use_case", mustJSONExact(int(bodyLimitN) + 1), 0},
		{"valid_body_invokes_use_case_exactly_once", `{"k":"v"}`, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var calls int
			handler := func(w http.ResponseWriter, r *http.Request) {
				var dst struct {
					K string `json:"k"`
				}
				if def := DecodeJSON(w, r, &dst, bodyLimitN); def != nil {
					WriteCatalogError(w, *def)
					return
				}
				calls++
			}
			rec := httptest.NewRecorder()
			handler(rec, newTestRequest(t, tc.body, true))
			if calls != tc.wantCalls {
				t.Fatalf("use-case calls = %d, want %d", calls, tc.wantCalls)
			}
		})
	}
}

// opaqueReader hides the concrete reader type so net/http uses chunked
// transfer encoding with no Content-Length.
type opaqueReader struct{ r io.Reader }

func (o opaqueReader) Read(p []byte) (int, error) { return o.r.Read(p) }

func TestDecodeJSON_RealServerChunkedBodyLimit(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ContentLength != -1 {
			t.Errorf("server ContentLength = %d, want -1", r.ContentLength)
		}
		if len(r.TransferEncoding) != 1 || r.TransferEncoding[0] != "chunked" {
			t.Errorf("TransferEncoding = %v, want [chunked]", r.TransferEncoding)
		}
		if got := r.Header.Get("Content-Length"); got != "" {
			t.Errorf("server observed Content-Length %q, want none", got)
		}
		var dst struct {
			K string `json:"k"`
		}
		if def := DecodeJSON(w, r, &dst, bodyLimitN); def != nil {
			WriteCatalogError(w, *def)
			return
		}
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	client := &http.Client{Timeout: 10 * time.Second}
	body := mustJSONExact(int(bodyLimitN) + 1)
	req, err := http.NewRequest(http.MethodPost, srv.URL, io.NopCloser(opaqueReader{r: strings.NewReader(body)}))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("client.Do: %v", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d body=%s, want 413", resp.StatusCode, respBody)
	}
	if got := atomic.LoadInt32(&calls); got != 0 {
		t.Fatalf("use-case calls = %d, want 0 on chunked N+1", got)
	}
}
