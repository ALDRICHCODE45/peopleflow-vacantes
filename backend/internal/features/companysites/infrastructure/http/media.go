package http

import (
	"bytes"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

const (
	// multipartOverhead bounds everything in the request but the file bytes.
	multipartOverhead = 64 * 1024
	// transferTimeout lifts the server read/write deadlines for one video
	// upload or download (20 MiB over a slow link).
	transferTimeout = 2 * time.Minute
)

var errTooLarge = errors.New("site media upload too large")

// spoolError is a server-side failure of the temporary spool (not the client).
type spoolError struct{ error }

// trackedWriter records write errors so a full disk is told apart from a
// broken client body.
type trackedWriter struct {
	w   io.Writer
	err error
}

func (t *trackedWriter) Write(p []byte) (int, error) {
	n, err := t.w.Write(p)
	if err != nil {
		t.err = err
	}
	return n, err
}

func (h *Handler) WithMedia(store app.MediaStore, storage app.Storage) *Handler {
	h.mediaStore = store
	h.storage = storage
	return h
}
func mediaError(w http.ResponseWriter, code httpjson.Code) {
	httpjson.WriteCatalogError(w, httpjson.Resolve(code))
}
func (h *Handler) mediaReady(w http.ResponseWriter) bool {
	if h == nil || h.storage == nil || h.mediaStore == nil {
		mediaError(w, httpjson.CodeCVStorageUnavailable)
		return false
	}
	return true
}

// upload holds the file part: in memory when it fits an image (≤ 5 MiB) and
// the kind is not hero_video, else in a temporary spool file bounded to
// MaxVideoBytes + 1 bytes. The spool is removed on every path (discard).
type upload struct {
	data        []byte
	spool       *os.File
	size        int64
	filename    string
	contentType string
}

// content is the file as a seekable, random-access reader.
func (u *upload) content() interface {
	io.ReadSeeker
	io.ReaderAt
} {
	if u.spool != nil {
		return u.spool
	}
	return bytes.NewReader(u.data)
}

func (u *upload) discard() {
	if u.spool != nil {
		_ = u.spool.Close()
		_ = os.Remove(u.spool.Name())
		u.spool = nil
	}
}

// read stores the file part. kind is "" when the file comes before the kind
// field. Images keep the in-memory 5 MiB bound (errTooLarge past it); a known
// hero_video, or an unknown kind past 5 MiB, continues into the spool.
func (u *upload) read(part io.Reader, kind string) error {
	if kind != app.HeroVideoKind {
		data, err := io.ReadAll(io.LimitReader(part, app.MaxMediaBytes+1))
		if err != nil {
			return err
		}
		if len(data) <= app.MaxMediaBytes {
			u.data, u.size = data, int64(len(data))
			return nil
		}
		if kind != "" {
			return errTooLarge
		}
		part = io.MultiReader(bytes.NewReader(data), part)
	}
	f, err := os.CreateTemp("", "site-media-*.mp4")
	if err != nil {
		return spoolError{err}
	}
	u.spool = f
	tracked := &trackedWriter{w: f}
	n, err := io.Copy(tracked, io.LimitReader(part, app.MaxVideoBytes+1))
	if tracked.err != nil {
		return spoolError{tracked.err}
	}
	if err != nil {
		return err
	}
	if n > app.MaxVideoBytes {
		return errTooLarge
	}
	u.size = n
	if _, err = f.Seek(0, io.SeekStart); err != nil {
		return spoolError{err}
	}
	return nil
}

func (h *Handler) UploadMedia(w http.ResponseWriter, r *http.Request) {
	if !h.mediaReady(w) {
		return
	}
	cc, ok := company(w, r)
	if !ok {
		return
	}
	// Lift both server-wide deadlines: the read one for the body and the write one, which
	// counts from the request headers, so a slow but accepted upload still gets its answer.
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Now().Add(transferTimeout))
	_ = rc.SetWriteDeadline(time.Now().Add(transferTimeout))
	r.Body = http.MaxBytesReader(w, r.Body, app.MaxVideoBytes+multipartOverhead)
	reader, err := r.MultipartReader()
	if err != nil {
		mediaError(w, httpjson.CodeInvalidRequest)
		return
	}
	var kind string
	file := &upload{}
	defer file.discard()
	seen := map[string]bool{}
	for {
		part, e := reader.NextPart()
		if e == io.EOF {
			break
		}
		if e != nil {
			uploadReadError(w, e)
			return
		}
		name := part.FormName()
		if seen[name] || (name != "kind" && name != "file") {
			mediaError(w, httpjson.CodeInvalidRequest)
			return
		}
		seen[name] = true
		if name == "file" {
			file.filename, file.contentType = part.FileName(), part.Header.Get("Content-Type")
			if e := file.read(part, kind); e != nil {
				uploadReadError(w, e)
				return
			}
			continue
		}
		value, e := io.ReadAll(io.LimitReader(part, 65))
		if e != nil {
			uploadReadError(w, e)
			return
		}
		if len(value) > 64 {
			mediaError(w, httpjson.CodeInvalidRequest)
			return
		}
		kind = string(value)
	}
	// Consume any multipart epilogue under the same envelope bound before writing.
	if _, err := io.Copy(io.Discard, r.Body); err != nil {
		uploadReadError(w, err)
		return
	}
	if !seen["kind"] || !seen["file"] {
		mediaError(w, httpjson.CodeInvalidRequest)
		return
	}
	if !app.IsMediaKind(kind) {
		validation(w, []app.Field{{Field: "kind", Code: "invalid"}})
		return
	}
	if kind == app.HeroVideoKind {
		h.uploadVideo(w, r, cc, file)
		return
	}
	if file.spool != nil { // a file-first image past 5 MiB
		mediaError(w, httpjson.CodePayloadTooLarge)
		return
	}
	cleaned, typ, width, height, code := app.PrepareMediaKind(kind, file.data)
	if code != "" {
		mediaError(w, httpjson.Code(code))
		return
	}
	m := app.StoredMedia{Media: app.Media{Kind: kind, Width: app.Size(width), Height: app.Size(height)}, ContentType: typ}
	m, err = h.mediaStore.InsertMedia(r.Context(), cc.CompanyID, cc.UserID, m, cleaned, h.storage)
	writeInserted(w, m, err)
}

// uploadVideo validates the declared name/type, then the MP4 boxes, and stores
// the spool (or the small in-memory file) through Storage.PutStream.
func (h *Handler) uploadVideo(w http.ResponseWriter, r *http.Request, cc security.CompanyContext, file *upload) {
	if !declaredMP4(file.filename, file.contentType) {
		mediaError(w, httpjson.CodeUnsupportedMediaType)
		return
	}
	body := file.content()
	info, code := app.InspectVideo(body, file.size)
	switch code {
	case "":
	case "video_too_long":
		httpjson.WriteSiteVideoTooLong(w, app.MaxVideoDurationMS, info.DurationMS)
		return
	default:
		mediaError(w, httpjson.Code(code))
		return
	}
	if _, err := body.Seek(0, io.SeekStart); err != nil {
		mediaError(w, httpjson.CodeInternalError)
		return
	}
	duration := info.DurationMS
	m := app.StoredMedia{Media: app.Media{Kind: app.HeroVideoKind, Width: info.Width, Height: info.Height, DurationMS: &duration}, ContentType: app.VideoContentType}
	m, err := h.mediaStore.InsertMediaStream(r.Context(), cc.CompanyID, cc.UserID, m, body, file.size, h.storage)
	writeInserted(w, m, err)
}

// declaredMP4: the file name must end in .mp4 (any case) and the part's
// declared type, when present, must be video/mp4 or the generic
// application/octet-stream.
func declaredMP4(filename, contentType string) bool {
	if !strings.EqualFold(path.Ext(filename), ".mp4") {
		return false
	}
	if contentType == "" {
		return true
	}
	typ, _, err := mime.ParseMediaType(contentType)
	return err == nil && (typ == app.VideoContentType || typ == "application/octet-stream")
}

func writeInserted(w http.ResponseWriter, m app.StoredMedia, err error) {
	switch {
	case errors.Is(err, app.ErrMediaLimit):
		mediaError(w, httpjson.CodeMediaLimitReached)
	case err != nil:
		mediaError(w, httpjson.CodeInternalError)
	default:
		httpjson.WriteJSON(w, http.StatusCreated, m)
	}
}
func uploadReadError(w http.ResponseWriter, err error) {
	var large *http.MaxBytesError
	var spool spoolError
	switch {
	case errors.As(err, &large) || errors.Is(err, errTooLarge):
		mediaError(w, httpjson.CodePayloadTooLarge)
	case errors.As(err, &spool):
		mediaError(w, httpjson.CodeInternalError)
	default:
		mediaError(w, httpjson.CodeInvalidRequest)
	}
}

// GetMedia serves one media publicly, honoring a single Range (206 with
// Content-Range, 416 when unsatisfiable; several ranges are answered with the
// whole object). Images are opened whole (buffered by S3), hero videos through
// OpenRange (a file, or a streamed ranged S3 GET).
func (h *Handler) GetMedia(w http.ResponseWriter, r *http.Request) {
	// Error responses must not be heuristically cached (404 is cacheable by default).
	w.Header().Set("Cache-Control", "no-store")
	if !h.mediaReady(w) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		mediaError(w, httpjson.CodeNotFound)
		return
	}
	m, err := h.mediaStore.FindMedia(r.Context(), id)
	if errors.Is(err, app.ErrMediaNotFound) {
		mediaError(w, httpjson.CodeNotFound)
		return
	}
	if err != nil {
		mediaError(w, httpjson.CodeInternalError)
		return
	}
	var f io.ReadSeekCloser
	if m.Kind == app.HeroVideoKind {
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(transferTimeout))
		f, err = h.storage.OpenRange(r.Context(), m.StorageKey, m.ByteSize)
	} else {
		f, err = h.storage.Open(r.Context(), m.StorageKey)
	}
	if err != nil {
		openError(w, err)
		return
	}
	defer f.Close()
	header := w.Header()
	header.Set("Content-Type", m.ContentType) // set before ServeContent: never sniffed
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	if raw := r.Header.Get("Range"); raw != "" && !singleByteRange(raw) {
		// Several ranges, another unit or a malformed spec: ignore the header and
		// answer the whole file (RFC 9110 §14.2), as images did before Range support.
		r = r.Clone(r.Context())
		r.Header.Del("Range")
	}
	// No name and no modtime: no Last-Modified, no extension-based type.
	http.ServeContent(&mediaWriter{ResponseWriter: w, object: f, head: r.Method == http.MethodHead}, r, "", time.Time{}, f)
}

func openError(w http.ResponseWriter, err error) {
	if errors.Is(err, app.ErrMediaNotFound) || errors.Is(err, fs.ErrNotExist) {
		mediaError(w, httpjson.CodeNotFound)
	} else {
		mediaError(w, httpjson.CodeInternalError)
	}
}

// mediaWriter finalizes ServeContent's status: 200/206 get the immutable cache
// header, after a lazy object fetched exactly the bytes to send (a failure then
// answers the catalog error instead); ServeContent's own errors (416, 412) are
// answered with no-store and no body.
type mediaWriter struct {
	http.ResponseWriter
	object        io.ReadSeekCloser
	head          bool
	wrote, silent bool
}

func (w *mediaWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *mediaWriter) WriteHeader(code int) {
	if w.wrote {
		return
	}
	w.wrote = true
	header := w.Header()
	if code != http.StatusOK && code != http.StatusPartialContent {
		w.silent = true
		header.Set("Cache-Control", "no-store")
		header.Del("Content-Type")
		w.ResponseWriter.WriteHeader(code)
		return
	}
	if p, ok := w.object.(app.Prefetcher); ok && !w.head {
		n, _ := strconv.ParseInt(header.Get("Content-Length"), 10, 64)
		if err := p.Prefetch(n); err != nil {
			w.silent = true
			for _, key := range []string{"Content-Length", "Content-Range", "Accept-Ranges"} {
				header.Del(key)
			}
			openError(w.ResponseWriter, err)
			return
		}
	}
	header.Set("Cache-Control", "public, max-age=31536000, immutable")
	w.ResponseWriter.WriteHeader(code)
}

func (w *mediaWriter) Write(b []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	if w.silent {
		return len(b), nil
	}
	return w.ResponseWriter.Write(b)
}

// singleByteRange reports whether raw is exactly one satisfiable-looking byte range
// spec: "bytes=N-M" (N <= M), "bytes=N-" or "bytes=-K" (K > 0). Anything else is
// ignored by the caller instead of being answered 416.
func singleByteRange(raw string) bool {
	spec, ok := strings.CutPrefix(raw, "bytes=")
	if !ok || strings.Contains(spec, ",") {
		return false
	}
	first, last, ok := strings.Cut(strings.TrimSpace(spec), "-")
	if !ok {
		return false
	}
	digits := func(v string) bool {
		if v == "" || len(v) > 18 {
			return false
		}
		for _, c := range v {
			if c < '0' || c > '9' {
				return false
			}
		}
		return true
	}
	switch {
	case first == "":
		return digits(last) && strings.TrimLeft(last, "0") != ""
	case last == "":
		return digits(first)
	default:
		if !digits(first) || !digits(last) {
			return false
		}
		a, _ := strconv.ParseInt(first, 10, 64)
		b, _ := strconv.ParseInt(last, 10, 64)
		return a <= b
	}
}
