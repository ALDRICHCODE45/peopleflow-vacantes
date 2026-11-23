package s3

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"testing/iotest"
	"time"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
)

var hex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)

// hermeticAWS keeps the SDK away from the developer's profile, metadata service and endpoint overrides.
func hermeticAWS(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("AWS_ACCESS_KEY_ID", "local-test")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "local-test-secret")
	t.Setenv("AWS_CONFIG_FILE", filepath.Join(dir, "config"))
	t.Setenv("AWS_SHARED_CREDENTIALS_FILE", filepath.Join(dir, "absent"))
	t.Setenv("AWS_EC2_METADATA_DISABLED", "true")
	t.Setenv("AWS_PROFILE", "")
	for _, key := range []string{"AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_S3", "AWS_IGNORE_CONFIGURED_ENDPOINT_URLS", "AWS_PROFILE"} {
		t.Setenv(key, "")
		if err := os.Unsetenv(key); err != nil {
			t.Fatal(err)
		}
	}
}

func newStorage(t *testing.T, endpoint, prefix string) *Storage {
	t.Helper()
	hermeticAWS(t)
	t.Setenv("APP_ENV", "local")
	s, err := New(context.Background(), Options{Bucket: "private-bucket", Region: "us-east-1", Prefix: prefix, Endpoint: endpoint, ForcePathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// fakeS3 is a path-style S3 that understands PutObject, multipart uploads, GetObject, DeleteObject and ListObjectsV2.
type fakeS3 struct {
	t  *testing.T
	mu sync.Mutex
	// objects maps "/bucket/key" to its bytes and modification time.
	objects  map[string][]byte
	modified map[string]time.Time
	uploads  map[string]map[int][]byte // uploadID -> part number -> bytes
	aborted  int
	parts    int
	partSeen chan struct{}
	pageSize int
	status   int // when non-zero every request answers it with an AccessDenied body that must never reach callers
}

func newFakeS3(t *testing.T) (*fakeS3, *httptest.Server) {
	f := &fakeS3{t: t, objects: map[string][]byte{}, modified: map[string]time.Time{}, uploads: map[string]map[int][]byte{}, partSeen: make(chan struct{}), pageSize: 1000}
	server := httptest.NewServer(f)
	t.Cleanup(server.Close)
	return f, server
}

func (f *fakeS3) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.objects)
}

func (f *fakeS3) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.Header.Get("X-Amz-Acl") != "" {
		f.t.Error("ACL must not be sent")
	}
	if f.status != 0 {
		w.WriteHeader(f.status)
		_, _ = io.WriteString(w, `<Error><Code>AccessDenied</Code><Message>secret detail</Message><RequestId>secret</RequestId></Error>`)
		return
	}
	q := r.URL.Query()
	switch {
	case r.Method == "POST" && q.Has("uploads"):
		id := fmt.Sprintf("upload-%d", len(f.uploads)+1)
		f.uploads[id] = map[int][]byte{}
		_, _ = fmt.Fprintf(w, `<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><UploadId>%s</UploadId></InitiateMultipartUploadResult>`, id)
	case r.Method == "PUT" && q.Has("uploadId"):
		n, _ := strconv.Atoi(q.Get("partNumber"))
		data, _ := io.ReadAll(r.Body)
		f.uploads[q.Get("uploadId")][n] = data
		f.parts++
		if f.parts == 1 {
			close(f.partSeen)
		}
		w.Header().Set("ETag", fmt.Sprintf(`"part-%d"`, n))
	case r.Method == "POST" && q.Has("uploadId"):
		parts := f.uploads[q.Get("uploadId")]
		var numbers []int
		for n := range parts {
			numbers = append(numbers, n)
		}
		sort.Ints(numbers)
		var all []byte
		for _, n := range numbers {
			all = append(all, parts[n]...)
		}
		f.objects[r.URL.Path], f.modified[r.URL.Path] = all, time.Now()
		delete(f.uploads, q.Get("uploadId"))
		_, _ = io.WriteString(w, `<CompleteMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><ETag>"etag"</ETag></CompleteMultipartUploadResult>`)
	case r.Method == "DELETE" && q.Has("uploadId"):
		delete(f.uploads, q.Get("uploadId"))
		f.aborted++
		w.WriteHeader(204)
	case r.Method == "PUT":
		data, _ := io.ReadAll(r.Body)
		f.objects[r.URL.Path], f.modified[r.URL.Path] = data, time.Now()
		w.Header().Set("ETag", `"etag"`)
	case r.Method == "GET" && q.Get("list-type") == "2":
		f.list(w, r)
	case r.Method == "GET":
		data, ok := f.objects[r.URL.Path]
		if !ok {
			w.WriteHeader(404)
			_, _ = io.WriteString(w, `<Error><Code>NoSuchKey</Code><Message>secret bucket key</Message></Error>`)
			return
		}
		_, _ = w.Write(data)
	case r.Method == "DELETE":
		delete(f.objects, r.URL.Path)
		w.WriteHeader(204)
	default:
		w.WriteHeader(400)
	}
}

func (f *fakeS3) list(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	prefix := "/private-bucket/" + q.Get("prefix")
	var names []string
	for name := range f.objects {
		if strings.HasPrefix(name, prefix) {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	start := 0
	if token := q.Get("continuation-token"); token != "" {
		start, _ = strconv.Atoi(token)
	}
	end := start + f.pageSize
	truncated := end < len(names)
	if end > len(names) {
		end = len(names)
	}
	type content struct {
		Key          string
		LastModified string
	}
	out := struct {
		XMLName               xml.Name `xml:"ListBucketResult"`
		IsTruncated           bool
		NextContinuationToken string `xml:",omitempty"`
		Contents              []content
	}{IsTruncated: truncated}
	if truncated {
		out.NextContinuationToken = strconv.Itoa(end)
	}
	for _, name := range names[start:end] {
		out.Contents = append(out.Contents, content{Key: strings.TrimPrefix(name, "/private-bucket/"), LastModified: f.modified[name].UTC().Format(time.RFC3339)})
	}
	_ = xml.NewEncoder(w).Encode(out)
}

// onlyKey returns the single stored object's bare 64-hex key.
func (f *fakeS3) onlyKey(prefix string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.objects) != 1 {
		f.t.Fatalf("objects=%d", len(f.objects))
	}
	for name := range f.objects {
		return strings.TrimPrefix(strings.TrimPrefix(name, "/private-bucket/"), prefix)
	}
	return ""
}

// patternReader yields a deterministic, non-repeating-at-part-boundaries byte stream and a running hash.
type patternReader struct {
	left int
	pos  int
	hash interface {
		Write([]byte) (int, error)
	}
}

func (p *patternReader) Read(b []byte) (int, error) {
	if p.left == 0 {
		return 0, io.EOF
	}
	if len(b) > p.left {
		b = b[:p.left]
	}
	for i := range b {
		b[i] = byte((p.pos + i) * 31 >> 3)
	}
	p.pos += len(b)
	p.left -= len(b)
	if p.hash != nil {
		_, _ = p.hash.Write(b)
	}
	return len(b), nil
}

func TestNewEndpointPolicy(t *testing.T) {
	for _, tc := range []struct {
		name, appEnv, envKey, explicit string
		invalid                        bool
	}{
		{name: "production standard AWS", appEnv: "production"},
		{name: "production explicit endpoint", appEnv: "production", explicit: "http://secret.invalid", invalid: true},
		{name: "production global env", appEnv: "production", envKey: "AWS_ENDPOINT_URL", invalid: true},
		{name: "production service env", appEnv: "production", envKey: "AWS_ENDPOINT_URL_S3", invalid: true},
		{name: "local ignores inherited env", appEnv: "local", envKey: "AWS_ENDPOINT_URL_S3"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			hermeticAWS(t)
			t.Setenv("APP_ENV", tc.appEnv)
			if tc.envKey != "" {
				t.Setenv(tc.envKey, "http://secret.invalid")
			}
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
}

func TestPutOpenDeleteSmall(t *testing.T) {
	for _, prefix := range []string{"documents/v1", "a/b/c", ""} {
		t.Run("prefix "+prefix, func(t *testing.T) {
			fake, server := newFakeS3(t)
			s := newStorage(t, server.URL, prefix)
			data := []byte("%PDF-1 contrato firmado")
			stored, size, err := s.Put(context.Background(), bytes.NewReader(data), documents.MaxBytes)
			if err != nil {
				t.Fatal(err)
			}
			if !hex64.MatchString(stored) || size != int64(len(data)) {
				t.Fatalf("key=%q size=%d", stored, size)
			}
			// The adapter, not the caller, owns the prefix: the object lives under <prefix>/<key>.
			want := "/private-bucket/" + stored
			if prefix != "" {
				want = "/private-bucket/" + prefix + "/" + stored
			}
			fake.mu.Lock()
			_, found := fake.objects[want]
			fake.mu.Unlock()
			if !found {
				t.Fatalf("object not stored at %s", want)
			}
			second, _, err := s.Put(context.Background(), bytes.NewReader(data), documents.MaxBytes)
			if err != nil || second == stored {
				t.Fatalf("keys must be random: %v", err)
			}
			body, err := s.Open(context.Background(), stored)
			if err != nil {
				t.Fatal(err)
			}
			got, err := io.ReadAll(body)
			_ = body.Close()
			if err != nil || !bytes.Equal(got, data) {
				t.Fatalf("got %q err=%v", got, err)
			}
			if err := s.Delete(context.Background(), stored); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Open(context.Background(), stored); !errors.Is(err, documents.ErrNotFound) {
				t.Fatalf("open after delete: %v", err)
			}
			// Deleting what is not there is fine.
			if err := s.Delete(context.Background(), stored); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// The reader blocks after 6 MiB until the first part has reached the server: an adapter that buffered the whole object
// before uploading would never let that happen.
func TestPutStreamsMultipartWithoutBufferingTheObject(t *testing.T) {
	fake, server := newFakeS3(t)
	s := newStorage(t, server.URL, "documents/v1")
	const total = documents.MaxBytes // 10 MiB: exactly two 5 MiB parts
	want := sha256.New()
	src := &patternReader{left: total, hash: want}
	gated := &gatedReader{r: src, after: 6 << 20, gate: fake.partSeen}
	stored, size, err := s.Put(context.Background(), gated, documents.MaxBytes)
	if err != nil {
		t.Fatalf("put: %v (gate fired: %v)", err, gated.timedOut)
	}
	if size != total {
		t.Fatalf("size=%d", size)
	}
	fake.mu.Lock()
	parts, aborted := fake.parts, fake.aborted
	fake.mu.Unlock()
	if parts < 2 || aborted != 0 {
		t.Fatalf("parts=%d aborted=%d: expected a multipart upload", parts, aborted)
	}
	body, err := s.Open(context.Background(), stored)
	if err != nil {
		t.Fatal(err)
	}
	got := sha256.New()
	n, err := io.Copy(got, body)
	_ = body.Close()
	if err != nil || n != total || !bytes.Equal(got.Sum(nil), want.Sum(nil)) {
		t.Fatalf("round trip changed the bytes: n=%d err=%v", n, err)
	}
}

type gatedReader struct {
	r        io.Reader
	after    int
	read     int
	gate     <-chan struct{}
	timedOut bool
}

func (g *gatedReader) Read(p []byte) (int, error) {
	if g.read >= g.after && !g.timedOut {
		select {
		case <-g.gate:
		case <-time.After(10 * time.Second):
			g.timedOut = true
			return 0, errors.New("upload did not start before the body ended: the adapter buffers the whole object")
		}
	}
	if g.read < g.after && len(p) > g.after-g.read {
		p = p[:g.after-g.read]
	}
	n, err := g.r.Read(p)
	g.read += n
	return n, err
}

func TestPutSizeCap(t *testing.T) {
	fake, server := newFakeS3(t)
	s := newStorage(t, server.URL, "documents/v1")
	ctx := context.Background()
	// Exactly the limit is stored (single part).
	if _, size, err := s.Put(ctx, &patternReader{left: 1000}, 1000); err != nil || size != 1000 {
		t.Fatalf("at limit: size=%d err=%v", size, err)
	}
	if fake.count() != 1 {
		t.Fatalf("objects=%d", fake.count())
	}
	// One byte over, single part: nothing is left behind.
	if _, _, err := s.Put(ctx, &patternReader{left: 1001}, 1000); !errors.Is(err, documents.ErrTooLarge) {
		t.Fatalf("over limit: %v", err)
	}
	if fake.count() != 1 {
		t.Fatalf("over-limit object stored: %d", fake.count())
	}
	// One byte over in the middle of a multipart upload: the upload is aborted, nothing completes.
	limit := int64(9 << 20)
	if _, _, err := s.Put(ctx, &patternReader{left: int(limit) + 1}, limit); !errors.Is(err, documents.ErrTooLarge) {
		t.Fatalf("multipart over limit: %v", err)
	}
	fake.mu.Lock()
	pending, objects := len(fake.uploads), len(fake.objects)
	fake.mu.Unlock()
	if pending != 0 || objects != 1 {
		t.Fatalf("multipart over limit left state: uploads=%d objects=%d", pending, objects)
	}
	if _, _, err := s.Put(ctx, bytes.NewReader(nil), 0); err == nil {
		t.Fatal("non-positive limit accepted")
	}
}

func TestPutReturnsReaderErrorsAndStoresNothing(t *testing.T) {
	fake, server := newFakeS3(t)
	s := newStorage(t, server.URL, "documents/v1")
	boom := errors.New("client disconnected")
	if _, _, err := s.Put(context.Background(), io.MultiReader(strings.NewReader("partial"), iotest.ErrReader(boom)), documents.MaxBytes); !errors.Is(err, boom) {
		t.Fatalf("single part: %v", err)
	}
	// Failing after the first full part also aborts the multipart upload.
	if _, _, err := s.Put(context.Background(), io.MultiReader(&patternReader{left: 6 << 20}, iotest.ErrReader(boom)), documents.MaxBytes); !errors.Is(err, boom) {
		t.Fatalf("multipart: %v", err)
	}
	fake.mu.Lock()
	pending, objects := len(fake.uploads), len(fake.objects)
	fake.mu.Unlock()
	if pending != 0 || objects != 0 {
		t.Fatalf("state left behind: uploads=%d objects=%d", pending, objects)
	}
}

func TestOpenStreamsWithoutBuffering(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "10")
		_, _ = io.WriteString(w, "01234")
		w.(http.Flusher).Flush()
		<-release
		_, _ = io.WriteString(w, "56789")
	}))
	defer server.Close()
	defer close(release)
	s := newStorage(t, server.URL, "documents/v1")
	type result struct {
		body io.ReadCloser
		err  error
	}
	opened := make(chan result, 1)
	go func() {
		body, err := s.Open(context.Background(), strings.Repeat("a", 64))
		opened <- result{body, err}
	}()
	select {
	case res := <-opened:
		if res.err != nil {
			t.Fatal(res.err)
		}
		defer res.body.Close()
		first := make([]byte, 5)
		if _, err := io.ReadFull(res.body, first); err != nil || string(first) != "01234" {
			t.Fatalf("first chunk: %q %v", first, err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Open waited for the whole object: it buffers")
	}
}

func TestOpenAndDeleteErrorBoundaries(t *testing.T) {
	key := strings.Repeat("b", 64)
	for _, tc := range []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"bare 404", 404, "", documents.ErrNotFound},
		{"NoSuchKey", 404, `<Error><Code>NoSuchKey</Code><Message>secret</Message></Error>`, documents.ErrNotFound},
		{"NotFound", 404, `<Error><Code>NotFound</Code></Error>`, documents.ErrNotFound},
		{"access denied", 403, `<Error><Code>AccessDenied</Code><Message>secret</Message><RequestId>secret</RequestId></Error>`, documents.ErrStorageUnavailable},
		{"server error", 500, `<Error><Code>InternalError</Code></Error>`, documents.ErrStorageUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, tc.body)
			}))
			defer server.Close()
			s := newStorage(t, server.URL, "documents/v1")
			body, err := s.Open(context.Background(), key)
			if body != nil || err != tc.want {
				t.Fatalf("body=%v err=%v", body, err)
			}
		})
	}
	t.Run("delete of a missing key is nil, a denial is sanitized", func(t *testing.T) {
		fake, server := newFakeS3(t)
		s := newStorage(t, server.URL, "documents/v1")
		if err := s.Delete(context.Background(), key); err != nil {
			t.Fatal(err)
		}
		fake.status = 403
		if err := s.Delete(context.Background(), key); err != documents.ErrStorageUnavailable {
			t.Fatalf("err=%v", err)
		}
	})
	t.Run("invalid keys never reach the network", func(t *testing.T) {
		s := newStorage(t, "http://127.0.0.1:1", "documents/v1")
		for _, bad := range []string{"", "short", "../" + key, strings.ToUpper(key), key + "/"} {
			if _, err := s.Open(context.Background(), bad); !errors.Is(err, documents.ErrInvalidKey) {
				t.Errorf("Open(%q)=%v", bad, err)
			}
			if err := s.Delete(context.Background(), bad); !errors.Is(err, documents.ErrInvalidKey) {
				t.Errorf("Delete(%q)=%v", bad, err)
			}
		}
	})
	t.Run("network", func(t *testing.T) {
		server := httptest.NewServer(http.NotFoundHandler())
		endpoint := server.URL
		server.Close()
		s := newStorage(t, endpoint, "documents/v1")
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_, _, put := s.Put(ctx, strings.NewReader("x"), 10)
		_, get := s.Open(ctx, key)
		del := s.Delete(ctx, key)
		_, list := s.Objects(ctx)
		for _, err := range []error{put, get, del, list} {
			if err != documents.ErrStorageUnavailable || errors.Unwrap(err) != nil {
				t.Fatalf("unsanitized error: %v", err)
			}
		}
	})
}

func TestObjectsPagesAndStaysInsideThePrefix(t *testing.T) {
	fake, server := newFakeS3(t)
	fake.pageSize = 2
	s := newStorage(t, server.URL, "documents/v1")
	ctx := context.Background()
	var want []string
	for i := 0; i < 5; i++ {
		stored, _, err := s.Put(ctx, strings.NewReader("doc"), 10)
		if err != nil {
			t.Fatal(err)
		}
		want = append(want, stored)
	}
	// Neighbours of other namespaces and non-key objects under the prefix are never reported.
	fake.mu.Lock()
	for name, data := range map[string]string{
		"/private-bucket/documents/v10/" + strings.Repeat("c", 64):       "x",
		"/private-bucket/sites/v1/" + strings.Repeat("d", 64):            "x",
		"/private-bucket/documents/v1/notes.txt":                         "x",
		"/private-bucket/documents/v1/nested/" + strings.Repeat("e", 64): "x",
	} {
		fake.objects[name], fake.modified[name] = []byte(data), time.Now()
	}
	fake.mu.Unlock()
	objects, err := s.Objects(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, o := range objects {
		if o.ModTime.IsZero() || time.Since(o.ModTime) > time.Minute {
			t.Fatalf("modification time not carried: %+v", o)
		}
		got = append(got, o.Key)
	}
	sort.Strings(got)
	sort.Strings(want)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("objects=%v want %v", got, want)
	}
}
