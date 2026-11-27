package unsubscribe

import (
	"container/list"
	"net/http"
	"net/netip"
	"sync"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/requestmeta"
)

// Limits configures the two fixed-window budgets and the per-table key cap.
type Limits struct {
	// PerIP bounds invalid-token requests per client IP (the probing vector).
	PerIP int
	// PerToken bounds valid-token requests per preference key (idempotent).
	PerToken int
	Window   time.Duration
	MaxKeys  int
}

// DefaultLimits is §Unsubscribe: 60 invalid requests / 10 min per IP and
// 10 valid requests / 10 min per token, per instance.
func DefaultLimits() Limits {
	return Limits{PerIP: 60, PerToken: 10, Window: 10 * time.Minute, MaxKeys: 100000}
}

// Limiter is the in-process, per-instance limit of the public unsubscribe
// routes, applied by the handler once the token is checked:
//   - an invalid token counts against its client IP — the address requestmeta
//     resolved before every route (L6): the BFF-attested X-PF-Client-IP when
//     the proxy secret matches, else the TCP peer or, only behind
//     TRUSTED_PROXY_CIDRS, the forwarded client; IPv6 shares its /64;
//   - a valid token counts against its preference key only, so one IP
//     relaying many people's one-clicks (a mail provider, the BFF) never loses
//     a legitimate unsubscribe.
//
// Rejections consume nothing. A full table never refuses a new key (see
// windows).
type Limiter struct {
	invalid, valid *windows
}

func NewLimiter(l Limits, now func() time.Time) *Limiter {
	if now == nil {
		now = time.Now
	}
	return &Limiter{
		invalid: newWindows(l.PerIP, l.Window, l.MaxKeys, now),
		valid:   newWindows(l.PerToken, l.Window, l.MaxKeys, now),
	}
}

// AdmitInvalid counts an invalid-token request against its client IP; a
// positive wait means 429.
func (l *Limiter) AdmitInvalid(r *http.Request) time.Duration { return l.invalid.admit(clientKey(r)) }

// AdmitValid counts a valid-token request against its preference key.
func (l *Limiter) AdmitValid(k domain.PreferenceKey) time.Duration {
	return l.valid.admit(k.User.String() + "/" + k.Company.String() + "/" + string(k.Type))
}

// windows is one table of fixed-window counters with bounded memory and O(1)
// amortized work per request under its mutex (no full sweep):
//   - fresh holds keys with one request in their window, ordered by window
//     start (= expiry order): expired ones are popped from the front, and the
//     oldest is evicted when the table is full — losing at most one request of
//     budget, never a client that spent more;
//   - held holds keys with two or more requests, in promotion order; they are
//     evicted (oldest first) only when no fresh key is left.
type windows struct {
	mu          sync.Mutex
	limit       int
	window      time.Duration
	maxKeys     int
	now         func() time.Time
	keys        map[string]*list.Element
	fresh, held *list.List
}

type entry struct {
	key     string
	count   int
	expires time.Time
	held    bool
}

func newWindows(limit int, window time.Duration, maxKeys int, now func() time.Time) *windows {
	return &windows{limit: limit, window: window, maxKeys: maxKeys, now: now,
		keys: map[string]*list.Element{}, fresh: list.New(), held: list.New()}
}

func (w *windows) admit(key string) time.Duration {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.limit <= 0 || w.window <= 0 || w.maxKeys <= 0 {
		return time.Second // misconfigured: refuse rather than serve unlimited
	}
	now := w.now()
	w.reclaim(now)
	if el, ok := w.keys[key]; ok {
		e := el.Value.(*entry)
		if now.Before(e.expires) {
			if e.count >= w.limit {
				return e.expires.Sub(now)
			}
			e.count++
			if !e.held {
				// Second request: protect it from flood eviction.
				w.fresh.Remove(el)
				e.held = true
				w.keys[key] = w.held.PushBack(e)
			}
			return 0
		}
		// Expired: a new window, back to fresh.
		w.remove(el)
	}
	if len(w.keys) >= w.maxKeys {
		w.evict()
	}
	e := &entry{key: key, count: 1, expires: now.Add(w.window)}
	w.keys[key] = w.fresh.PushBack(e)
	return 0
}

// reclaim pops expired entries from both fronts (amortized O(1): each entry
// is popped once). held is in promotion order, so an expired entry behind a
// live one waits for a later call or for eviction; it never blocks anyone.
func (w *windows) reclaim(now time.Time) {
	for _, l := range []*list.List{w.fresh, w.held} {
		for el := l.Front(); el != nil && !now.Before(el.Value.(*entry).expires); el = l.Front() {
			w.remove(el)
		}
	}
}

func (w *windows) evict() {
	if el := w.fresh.Front(); el != nil {
		w.remove(el)
		return
	}
	if el := w.held.Front(); el != nil {
		w.remove(el)
	}
}

func (w *windows) remove(el *list.Element) {
	e := el.Value.(*entry)
	if e.held {
		w.held.Remove(el)
	} else {
		w.fresh.Remove(el)
	}
	delete(w.keys, e.key)
}

func (w *windows) len() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.keys)
}

// clientKey never uses caller text: a missing or unparseable client shares
// one "unknown" bucket.
func clientKey(r *http.Request) string {
	meta, ok := requestmeta.FromContext(r.Context())
	if !ok || meta.IP == nil || !meta.IP.IsValid() {
		return "unknown"
	}
	ip := meta.IP.Unmap()
	if ip.Is6() {
		return netip.PrefixFrom(ip, 64).Masked().String()
	}
	return ip.String()
}
