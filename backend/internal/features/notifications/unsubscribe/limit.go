package unsubscribe

import (
	"net/http"
	"net/netip"
	"sync"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/requestmeta"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

// Limits configures the per-IP fixed window and the key-table cap.
type Limits struct {
	PerIP   int
	Window  time.Duration
	MaxKeys int
}

// DefaultLimits is §Unsubscribe: 60 requests / 10 min per IP, per instance.
func DefaultLimits() Limits { return Limits{PerIP: 60, Window: 10 * time.Minute, MaxKeys: 100000} }

// Limiter is the in-process, per-instance limit of the public unsubscribe
// routes. The client is the address requestmeta resolved before every route
// (L6): the BFF-attested X-PF-Client-IP when the proxy secret matches, else
// the TCP peer or, only behind TRUSTED_PROXY_CIDRS, the forwarded client — so
// behind the frontend pass-through each client has its own budget and no
// untrusted header creates one. IPv6 clients share their /64. Every admitted
// request counts; a rejection consumes nothing. A full key table fails closed.
type Limiter struct {
	mu        sync.Mutex
	limits    Limits
	now       func() time.Time
	keys      map[string]*window
	nextSweep time.Time
}

type window struct {
	count   int
	expires time.Time
}

func NewLimiter(l Limits, now func() time.Time) *Limiter {
	if now == nil {
		now = time.Now
	}
	return &Limiter{limits: l, now: now, keys: map[string]*window{}}
}

func (l *Limiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if wait := l.admit(clientKey(r)); wait > 0 {
			httpjson.WriteRateLimited(w, wait)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (l *Limiter) admit(key string) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.limits.PerIP <= 0 || l.limits.Window <= 0 || l.limits.MaxKeys <= 0 {
		return time.Second
	}
	now := l.now()
	if !now.Before(l.nextSweep) {
		l.sweep(now)
		l.nextSweep = now.Add(l.limits.Window / 10)
	}
	c := l.keys[key]
	if c != nil && now.Before(c.expires) && c.count >= l.limits.PerIP {
		return c.expires.Sub(now)
	}
	if c == nil {
		if len(l.keys) >= l.limits.MaxKeys {
			l.sweep(now)
			if len(l.keys) >= l.limits.MaxKeys {
				return l.limits.Window
			}
		}
		c = &window{}
		l.keys[key] = c
	}
	if !now.Before(c.expires) {
		c.count, c.expires = 0, now.Add(l.limits.Window)
	}
	c.count++
	return 0
}

func (l *Limiter) sweep(now time.Time) {
	for key, c := range l.keys {
		if !now.Before(c.expires) {
			delete(l.keys, key)
		}
	}
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
