package s3

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

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
