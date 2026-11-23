package http

import (
	"io"
	nethttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// slowBody yields its chunks with a pause between them, so the whole body takes
// longer than the server's ReadTimeout.
type slowBody struct {
	chunks []string
	pause  time.Duration
}

func (b *slowBody) Read(p []byte) (int, error) {
	if len(b.chunks) == 0 {
		return 0, io.EOF
	}
	time.Sleep(b.pause)
	n := copy(p, b.chunks[0])
	b.chunks = b.chunks[1:]
	return n, nil
}

func slowUpload(t *testing.T, extend bool) (string, error) {
	t.Helper()
	got := make(chan string, 1)
	srv := httptest.NewUnstartedServer(nethttp.HandlerFunc(func(w nethttp.ResponseWriter, r *nethttp.Request) {
		if extend {
			extendTransferDeadline(w, true)
		}
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			got <- "error"
			nethttp.Error(w, "read", nethttp.StatusBadRequest)
			return
		}
		got <- string(raw)
	}))
	srv.Config.ReadTimeout = 150 * time.Millisecond
	srv.Start()
	defer srv.Close()
	body := &slowBody{chunks: []string{"a", "b", "c", "d"}, pause: 100 * time.Millisecond}
	req, err := nethttp.NewRequest(nethttp.MethodPost, srv.URL, body)
	if err != nil {
		t.Fatal(err)
	}
	req.ContentLength = 4
	resp, err := srv.Client().Do(req)
	if err == nil {
		resp.Body.Close()
	}
	select {
	case s := <-got:
		return s, nil
	case <-time.After(3 * time.Second):
		return "", err
	}
}

func TestExtendTransferDeadlineLetsASlowUploadFinish(t *testing.T) {
	if got, _ := slowUpload(t, false); got == "abcd" {
		t.Fatal("control: without the extension the server ReadTimeout must cut the slow body")
	}
	got, err := slowUpload(t, true)
	if got != "abcd" {
		t.Fatalf("with the extension the slow body must arrive whole, got %q (client err %v)", got, err)
	}
}

func TestExtendTransferDeadlineIgnoresWritersWithoutDeadlines(t *testing.T) {
	rec := httptest.NewRecorder()
	extendTransferDeadline(rec, true)
	extendTransferDeadline(rec, false)
	if rec.Code != nethttp.StatusOK || strings.TrimSpace(rec.Body.String()) != "" {
		t.Fatal("a recorder must be left untouched")
	}
}
