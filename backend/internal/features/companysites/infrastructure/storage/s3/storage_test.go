package s3

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
)

func testStorage(t *testing.T, endpoint, prefix string) *Storage {
	t.Helper()
	t.Setenv("AWS_ACCESS_KEY_ID", "local-test")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "local-test-secret")
	s, err := New(context.Background(), Options{Bucket: "private-bucket", Region: "us-east-1", Prefix: prefix, Endpoint: endpoint, ForcePathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func TestNewEndpointPolicy(t *testing.T) {
	for _, tc := range []struct {
		name, appEnv, envKey, shared, explicit string
		invalid                                bool
	}{
		{name: "production standard AWS", appEnv: "production"},
		{name: "production global env", appEnv: "production", envKey: "AWS_ENDPOINT_URL", invalid: true},
		{name: "production service env", appEnv: "production", envKey: "AWS_ENDPOINT_URL_S3", invalid: true},
		{name: "production explicit", appEnv: "production", explicit: "http://secret.invalid", invalid: true},
		{name: "production shared global", appEnv: "production", shared: "endpoint_url = http://secret.invalid\n", invalid: true},
		{name: "production shared service", appEnv: "production", shared: "services = local\n[services local]\ns3 =\n  endpoint_url = http://secret.invalid\n", invalid: true},
		{name: "production ignored shared", appEnv: "production", shared: "ignore_configured_endpoint_urls = true\nendpoint_url = http://secret.invalid\n", invalid: true},
		{name: "local ignores inherited global", appEnv: "local", envKey: "AWS_ENDPOINT_URL"},
		{name: "local ignores inherited service", appEnv: "local", envKey: "AWS_ENDPOINT_URL_S3"},
		{name: "local ignores shared global", appEnv: "local", shared: "endpoint_url = http://secret.invalid\n"},
		{name: "local ignores shared service", appEnv: "local", shared: "services = local\n[services local]\ns3 =\n  endpoint_url = http://secret.invalid\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("APP_ENV", tc.appEnv)
			for _, key := range []string{"AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_S3", "AWS_IGNORE_CONFIGURED_ENDPOINT_URLS"} {
				t.Setenv(key, "")
				if err := os.Unsetenv(key); err != nil {
					t.Fatal(err)
				}
			}
			if tc.envKey != "" {
				t.Setenv(tc.envKey, "http://secret.invalid")
			}
			dir := t.TempDir()
			configPath := filepath.Join(dir, "config")
			if err := os.WriteFile(configPath, []byte("[default]\n"+tc.shared), 0600); err != nil {
				t.Fatal(err)
			}
			t.Setenv("AWS_CONFIG_FILE", configPath)
			t.Setenv("AWS_PROFILE", "default")
			t.Setenv("AWS_SHARED_CREDENTIALS_FILE", filepath.Join(dir, "absent"))
			t.Setenv("AWS_EC2_METADATA_DISABLED", "true")
			s, err := New(context.Background(), Options{Bucket: "private-bucket", Region: "us-east-1", Endpoint: tc.explicit})
			if (err != nil) != tc.invalid {
				t.Fatalf("err=%v invalid=%v", err, tc.invalid)
			}
			if err != nil {
				if s != nil || strings.Contains(err.Error(), "secret") || errors.Unwrap(err) != nil {
					t.Fatal("unsafe endpoint configuration error")
				}
				return
			}
			if s.client.Options().BaseEndpoint != nil {
				t.Fatal("inherited endpoint survived")
			}
		})
	}
	t.Run("local explicit endpoint is used", func(t *testing.T) {
		t.Setenv("APP_ENV", "local")
		t.Setenv("AWS_ENDPOINT_URL_S3", "http://secret.invalid")
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "local bytes") }))
		defer server.Close()
		s := testStorage(t, server.URL, "")
		body, err := s.Open(context.Background(), "key")
		if err != nil {
			t.Fatal(err)
		}
		defer body.Close()
		got, err := io.ReadAll(body)
		if err != nil || string(got) != "local bytes" {
			t.Fatalf("got=%q err=%v", got, err)
		}
	})
}

func TestStorageRoundTrip(t *testing.T) {
	for _, prefix := range []string{"", "sites/images/"} {
		t.Run(prefix, func(t *testing.T) {
			objects := map[string][]byte{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("X-Amz-Acl") != "" {
					t.Error("ACL must not be sent")
				}
				switch r.Method {
				case "PUT":
					objects[r.URL.Path], _ = io.ReadAll(r.Body)
				case "GET":
					data, ok := objects[r.URL.Path]
					if !ok {
						w.WriteHeader(404)
						_, _ = io.WriteString(w, `<Error><Code>NoSuchKey</Code><Message>secret bucket key</Message></Error>`)
						return
					}
					_, _ = w.Write(data)
				case "DELETE":
					delete(objects, r.URL.Path)
					w.WriteHeader(204)
				}
			}))
			defer server.Close()
			s := testStorage(t, server.URL, prefix)
			data := []byte("unchanged image bytes")
			key, err := s.Put(context.Background(), data)
			if err != nil {
				t.Fatal(err)
			}
			random := strings.TrimPrefix(key, strings.TrimSuffix(prefix, "/"))
			random = strings.TrimPrefix(random, "/")
			if decoded, err := hex.DecodeString(random); err != nil || len(decoded) != 32 || strings.ToLower(random) != random {
				t.Fatal(key)
			}
			if prefix != "" && !strings.HasPrefix(key, prefix) {
				t.Fatal(key)
			}
			second, err := s.Put(context.Background(), data)
			if err != nil || second == key {
				t.Fatal("keys must be random")
			}
			body, err := s.Open(context.Background(), key)
			if err != nil {
				t.Fatal(err)
			}
			got, _ := io.ReadAll(body)
			body.Close()
			if !bytes.Equal(got, data) {
				t.Fatal(string(got))
			}
			if err := s.Delete(context.Background(), key); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Open(context.Background(), key); !errors.Is(err, app.ErrMediaNotFound) {
				t.Fatal(err)
			}
		})
	}
}
func TestStorageFailureBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"bare 404", 404, "", app.ErrMediaNotFound},
		{"NoSuchKey", 404, `<Error><Code>NoSuchKey</Code><Message>secret</Message></Error>`, app.ErrMediaNotFound},
		{"NotFound", 404, `<Error><Code>NotFound</Code></Error>`, app.ErrMediaNotFound},
		{"access denied", 403, `<Error><Code>AccessDenied</Code><Message>secret</Message><RequestId>secret</RequestId></Error>`, app.ErrStorageUnavailable},
		{"oversized", 200, strings.Repeat("x", app.MaxMediaBytes+1), app.ErrStorageUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, tc.body)
			}))
			defer server.Close()
			s := testStorage(t, server.URL, "")
			body, err := s.Open(context.Background(), "secret-key")
			if body != nil || err != tc.want {
				t.Fatalf("body=%v err=%v", body, err)
			}
		})
	}
	t.Run("network", func(t *testing.T) {
		server := httptest.NewServer(http.NotFoundHandler())
		endpoint := server.URL
		server.Close()
		s := testStorage(t, endpoint, "")
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, put := s.Put(ctx, []byte("x"))
		_, get := s.Open(ctx, "secret-key")
		del := s.Delete(ctx, "secret-key")
		for _, err := range []error{put, get, del} {
			if err != app.ErrStorageUnavailable || errors.Unwrap(err) != nil {
				t.Fatalf("unsanitized error: %v", err)
			}
		}
	})
	t.Run("truncated body", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Length", "100")
			_, _ = io.WriteString(w, "short")
		}))
		defer server.Close()
		s := testStorage(t, server.URL, "")
		body, err := s.Open(context.Background(), "private-key")
		if body != nil || err != app.ErrStorageUnavailable {
			t.Fatalf("body=%v err=%v", body, err)
		}
	})
	t.Run("advertised bound", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Length", "5242881")
			w.WriteHeader(200)
		}))
		defer server.Close()
		s := testStorage(t, server.URL, "")
		body, err := s.Open(context.Background(), "private-key")
		if body != nil || err != app.ErrStorageUnavailable {
			t.Fatalf("body=%v err=%v", body, err)
		}
	})
	t.Run("put bound", func(t *testing.T) {
		s := testStorage(t, "http://127.0.0.1:1", "")
		if _, err := s.Put(context.Background(), make([]byte, app.MaxMediaBytes+1)); err != app.ErrStorageUnavailable {
			t.Fatal(err)
		}
	})
}

// rangeServer serves one object honoring single "bytes=a-b" ranges and records
// every GET Range header.
func rangeServer(t *testing.T, data []byte, ranges *[]string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*ranges = append(*ranges, r.Header.Get("Range"))
		var a, b int
		if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &a, &b); err != nil || a > b || b >= len(data) {
			w.WriteHeader(416)
			_, _ = io.WriteString(w, `<Error><Code>InvalidRange</Code></Error>`)
			return
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", a, b, len(data)))
		w.Header().Set("Content-Length", strconv.Itoa(b-a+1))
		w.WriteHeader(206)
		_, _ = w.Write(data[a : b+1])
	}))
	t.Cleanup(server.Close)
	return server
}

func TestStoragePutStream(t *testing.T) {
	var got []byte
	var length string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		length = r.Header.Get("Content-Length")
		got, _ = io.ReadAll(r.Body)
	}))
	defer server.Close()
	s := testStorage(t, server.URL, "videos")
	data := bytes.Repeat([]byte{9}, app.MaxMediaBytes+1) // above the image cap
	key, err := s.PutStream(context.Background(), bytes.NewReader(data), int64(len(data)))
	if err != nil || !strings.HasPrefix(key, "videos/") || !bytes.Equal(got, data) || length != strconv.Itoa(len(data)) {
		t.Fatalf("key=%q err=%v len=%d header=%q", key, err, len(got), length)
	}
	for _, size := range []int64{0, app.MaxVideoBytes + 1} {
		if _, err := s.PutStream(context.Background(), bytes.NewReader(nil), size); err != app.ErrStorageUnavailable {
			t.Fatal(size, err)
		}
	}
}

func TestStorageOpenIsSeekable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "image bytes") }))
	defer server.Close()
	body, err := testStorage(t, server.URL, "").Open(context.Background(), "key")
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	if n, err := body.Seek(0, io.SeekEnd); n != 11 || err != nil {
		t.Fatal(n, err)
	}
	_, _ = body.Seek(6, io.SeekStart)
	if got, _ := io.ReadAll(body); string(got) != "bytes" {
		t.Fatal(string(got))
	}
}

func TestStorageOpenRange(t *testing.T) {
	data := []byte("0123456789abcdefghij")
	var ranges []string
	s := testStorage(t, rangeServer(t, data, &ranges).URL, "")
	ctx := context.Background()
	obj, err := s.OpenRange(ctx, "key", int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	defer obj.Close()
	if len(ranges) != 0 {
		t.Fatal("OpenRange must not fetch", ranges)
	}
	if n, _ := obj.Seek(0, io.SeekEnd); n != 20 {
		t.Fatal(n)
	}
	// Prefetch issues exactly the ranged GET the response needs.
	_, _ = obj.Seek(10, io.SeekStart)
	if err := obj.(app.Prefetcher).Prefetch(5); err != nil {
		t.Fatal(err)
	}
	got := make([]byte, 5)
	if _, err := io.ReadFull(obj, got); err != nil || string(got) != "abcde" {
		t.Fatal(string(got), err)
	}
	// Reading on (no prefetch) or after a seek opens the remaining range.
	_, _ = obj.Seek(2, io.SeekStart)
	rest, err := io.ReadAll(obj)
	if err != nil || string(rest) != string(data[2:]) {
		t.Fatal(string(rest), err)
	}
	want := []string{"bytes=10-14", "bytes=2-19"}
	if !reflect.DeepEqual(ranges, want) {
		t.Fatal(ranges)
	}
	if _, err := obj.Seek(-1, io.SeekStart); err == nil {
		t.Fatal("negative seek")
	}
}

func TestStorageOpenRangeFailures(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		length string
		body   string
		want   error
	}{
		{"not found", 404, "", `<Error><Code>NoSuchKey</Code><Message>secret</Message></Error>`, app.ErrMediaNotFound},
		{"denied", 403, "", `<Error><Code>AccessDenied</Code><Message>secret</Message></Error>`, app.ErrStorageUnavailable},
		{"short range", 206, "3", "abc", app.ErrStorageUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tc.length != "" {
					w.Header().Set("Content-Length", tc.length)
					w.Header().Set("Content-Range", "bytes 0-2/10")
				}
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, tc.body)
			}))
			defer server.Close()
			obj, err := testStorage(t, server.URL, "").OpenRange(context.Background(), "secret-key", 10)
			if err != nil {
				t.Fatal(err)
			}
			defer obj.Close()
			if err := obj.(app.Prefetcher).Prefetch(10); err != tc.want {
				t.Fatal(err)
			}
			// A failed prefetch never falls back to another request.
			if _, err := obj.Read(make([]byte, 4)); err != tc.want {
				t.Fatal(err)
			}
		})
	}
	t.Run("truncated stream", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Length", "10")
			w.Header().Set("Content-Range", "bytes 0-9/10")
			w.WriteHeader(206)
			_, _ = io.WriteString(w, "short")
		}))
		defer server.Close()
		obj, _ := testStorage(t, server.URL, "").OpenRange(context.Background(), "secret-key", 10)
		defer obj.Close()
		if err := obj.(app.Prefetcher).Prefetch(10); err != nil {
			t.Fatal(err)
		}
		if _, err := io.ReadAll(obj); err != app.ErrStorageUnavailable {
			t.Fatal(err)
		}
	})
	t.Run("bounds", func(t *testing.T) {
		s := testStorage(t, "http://127.0.0.1:1", "")
		for _, size := range []int64{-1, app.MaxVideoBytes + 1} {
			if _, err := s.OpenRange(context.Background(), "k", size); err != app.ErrStorageUnavailable {
				t.Fatal(size, err)
			}
		}
	})
}

// The ranged read streams: Prefetch returns once headers arrive, long before
// the body is complete, so nothing buffers the object.
func TestStorageOpenRangeStreams(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "8")
		w.Header().Set("Content-Range", "bytes 0-7/8")
		w.WriteHeader(206)
		_, _ = io.WriteString(w, "head")
		w.(http.Flusher).Flush()
		<-release
		_, _ = io.WriteString(w, "tail")
	}))
	defer server.Close()
	defer close(release)
	obj, _ := testStorage(t, server.URL, "").OpenRange(context.Background(), "key", 8)
	defer obj.Close()
	done := make(chan error, 1)
	go func() { done <- obj.(app.Prefetcher).Prefetch(8) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Prefetch waited for the whole body")
	}
	got := make([]byte, 4)
	if _, err := io.ReadFull(obj, got); err != nil || string(got) != "head" {
		t.Fatal(string(got), err)
	}
}
