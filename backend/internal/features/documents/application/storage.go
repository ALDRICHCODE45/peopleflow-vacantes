package documents

import (
	"context"
	"errors"
	"io"
	"time"
)

// OrphanGrace is how long an unreferenced object is left alone (D25). An upload streams into storage
// before its rows exist, so an object younger than this may still belong to an in-flight request.
const OrphanGrace = time.Hour

var (
	// ErrNotFound is returned by Storage.Open when the key has no object.
	ErrNotFound = errors.New("document object not found")
	// ErrInvalidKey is returned for a key that is not 64 lowercase hex characters.
	ErrInvalidKey = errors.New("invalid document storage key")
	// ErrStorageUnavailable hides every provider/filesystem failure; adapters never leak its cause.
	ErrStorageUnavailable = errors.New("document storage unavailable")
)

// Object is one stored object as seen by Reconcile. Key is the adapter-independent 64-hex key (never a path or a prefix).
type Object struct {
	Key     string
	ModTime time.Time
}

// Storage is the streaming port of document files (D24). It is deliberately not cvs.Storage, whose Put takes a []byte.
type Storage interface {
	// Put streams r into a new random 64-hex key. It never stores more than maxBytes: a longer body removes the partial
	// object and returns ErrTooLarge. A failing r aborts the write, removes the partial object and returns r's error
	// (errors.Is-compatible); a storage failure is ErrStorageUnavailable. size is the number of bytes stored.
	Put(ctx context.Context, r io.Reader, maxBytes int64) (key string, size int64, err error)
	// Open returns a streaming reader (S3: the GetObject body, never buffered). A missing key is ErrNotFound.
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	// Delete is idempotent: a missing key is nil.
	Delete(ctx context.Context, key string) error
	// Objects lists every object of the adapter's namespace (local: the root; S3: the prefix) for Reconcile.
	Objects(ctx context.Context) ([]Object, error)
}

// BoundedReader hands at most max bytes of r to its consumer, counts them and remembers why reading stopped, so an adapter
// can tell «the caller's body failed» from «the provider failed» and a longer body from a legal one. The one extra byte it
// looks at (max+1) is never passed on.
type BoundedReader struct {
	ctx context.Context
	r   io.Reader
	max int64
	n   int64
	err error
}

// NewBoundedReader wraps r. ctx is checked before every read.
func NewBoundedReader(ctx context.Context, r io.Reader, max int64) *BoundedReader {
	return &BoundedReader{ctx: ctx, r: r, max: max}
}

func (b *BoundedReader) Read(p []byte) (int, error) {
	if b.err != nil {
		return 0, b.err
	}
	if err := b.ctx.Err(); err != nil {
		b.err = err
		return 0, err
	}
	if len(p) == 0 {
		return 0, nil
	}
	// Look at most one byte past the limit.
	if room := b.max + 1 - b.n; int64(len(p)) > room {
		p = p[:room]
	}
	n, err := b.r.Read(p)
	b.n += int64(n)
	if b.n > b.max {
		// The byte beyond max is dropped: the consumer never sees more than max.
		b.n = b.max
		n--
		b.err = ErrTooLarge
		return n, b.err
	}
	if err != nil && err != io.EOF {
		b.err = err
	}
	return n, err
}

// N is the number of bytes handed to the consumer (never above max).
func (b *BoundedReader) N() int64 { return b.n }

// Err is the first non-EOF reason reading stopped: ErrTooLarge, the context error or the source's error. Nil after a clean EOF.
func (b *BoundedReader) Err() error { return b.err }

// ReconcileOrphans deletes every object that referenced reports false for and that is at least OrphanGrace old at now (D25).
// Young, future-dated and undated objects are kept without asking referenced. A failed lookup, listing or deletion stops
// the run: the function fails closed and never deletes on doubt.
func ReconcileOrphans(ctx context.Context, storage Storage, now time.Time, referenced func(context.Context, string) (bool, error)) error {
	objects, err := storage.Objects(ctx)
	if err != nil {
		return err
	}
	for _, obj := range objects {
		if err := ctx.Err(); err != nil {
			return err
		}
		if obj.ModTime.IsZero() || now.Sub(obj.ModTime) < OrphanGrace {
			continue
		}
		keep, err := referenced(ctx, obj.Key)
		if err != nil {
			return err
		}
		if keep {
			continue
		}
		if err := storage.Delete(ctx, obj.Key); err != nil {
			return err
		}
	}
	return nil
}
