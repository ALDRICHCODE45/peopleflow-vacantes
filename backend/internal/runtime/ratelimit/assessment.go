// Package ratelimit provides in-process only, per-instance assessment limiting.
// Distributed limiting is later infrastructure. The key cap is fail-closed.
package ratelimit

import (
	"crypto/sha256"
	"encoding/hex"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
)

// Limits configures fixed windows and the maximum number of token and IP keys.
type Limits struct {
	PerToken     int
	PerIP        int
	UnknownPerIP int
	Window       time.Duration
	MaxKeys      int
}

func DefaultLimits() Limits {
	return Limits{PerToken: 300, PerIP: 600, UnknownPerIP: 30, Window: 10 * time.Minute, MaxKeys: 100000}
}

type counter struct {
	count          int
	expires        time.Time
	unknown        int
	unknownExpires time.Time
	// pending counts admitted requests still in flight on tokens not yet
	// proven valid. Each reserves an unknown-lookup slot until it settles.
	pending int
	// known marks a token key whose last real response proved it valid within
	// the token window; its requests neither reserve nor wait on reservations.
	known bool
}

// Assessment owns all counters; an IP key also owns its unknown-lookup window.
type Assessment struct {
	mu        sync.Mutex
	limits    Limits
	trusted   []netip.Prefix
	now       func() time.Time
	keys      map[string]*counter
	nextSweep time.Time
}

func NewAssessment(l Limits, trusted []netip.Prefix, now func() time.Time) *Assessment {
	if now == nil {
		now = time.Now
	}
	return &Assessment{limits: l, trusted: append([]netip.Prefix(nil), trusted...), now: now, keys: make(map[string]*counter)}
}

func (a *Assessment) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hash := sha256.Sum256([]byte(chi.URLParam(r, "token")))
		tokenKey := "token:" + hex.EncodeToString(hash[:])
		ipKey := "ip:" + a.clientIP(r)
		reserved, wait := a.admit(tokenKey, ipKey)
		if wait > 0 {
			httpjson.WriteRateLimited(w, wait)
			return
		}
		recorder := &catalogRecorder{ResponseWriter: w}
		// Deferred so a panicking handler still releases its reservation.
		defer func() { a.settle(tokenKey, ipKey, reserved, recorder.outcome()) }()
		next.ServeHTTP(recorder, r)
	})
}

// admit checks all budgets and reserves the request atomically. Rejections do
// not consume any budget or create keys. reserved reports whether the request
// holds an unknown-lookup reservation (tokens not yet proven valid).
func (a *Assessment) admit(tokenKey, ipKey string) (reserved bool, wait time.Duration) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	if !now.Before(a.nextSweep) {
		a.sweep(now)
		a.nextSweep = now.Add(a.limits.Window / 10)
	}
	known := false
	if c := a.keys[tokenKey]; c != nil && c.known && now.Before(c.expires) {
		known = true
	}
	checks := []struct {
		key   string
		limit int
	}{{tokenKey, a.limits.PerToken}, {ipKey, a.limits.PerIP}}
	missing := 0
	for _, check := range checks {
		c := a.keys[check.key]
		if c == nil {
			missing++
			continue
		}
		if now.Before(c.expires) && c.count >= check.limit {
			wait = max(wait, c.expires.Sub(now))
		}
	}
	if c := a.keys[ipKey]; c != nil {
		unknown := 0
		if now.Before(c.unknownExpires) {
			unknown = c.unknown
		}
		if unknown >= a.limits.UnknownPerIP {
			wait = max(wait, c.unknownExpires.Sub(now))
		} else if !known && unknown+c.pending >= a.limits.UnknownPerIP {
			// Only in-flight reservations block: they settle within a request.
			wait = max(wait, time.Second)
		}
	}
	if wait > 0 {
		return false, wait
	}
	if a.limits.PerToken <= 0 || a.limits.PerIP <= 0 || a.limits.UnknownPerIP <= 0 || a.limits.Window <= 0 {
		return false, time.Second
	}
	if missing > 0 && len(a.keys)+missing > a.limits.MaxKeys {
		// A capacity-triggered sweep also reclaims expirations between periodic sweeps.
		a.sweep(now)
		missing = 0
		for _, check := range checks {
			if a.keys[check.key] == nil {
				missing++
			}
		}
		if len(a.keys)+missing > a.limits.MaxKeys {
			return false, a.limits.Window
		}
	}
	for _, check := range checks {
		c := a.keys[check.key]
		if c == nil {
			c = &counter{}
			a.keys[check.key] = c
		}
		if !now.Before(c.expires) {
			c.count = 0
			c.known = false
			c.expires = now.Add(a.limits.Window)
		}
		c.count++
	}
	if known {
		return false, 0
	}
	a.keys[ipKey].pending++
	return true, 0
}

func (a *Assessment) sweep(now time.Time) {
	for key, c := range a.keys {
		if c.pending == 0 && !now.Before(c.expires) && !now.Before(c.unknownExpires) {
			delete(a.keys, key)
		}
	}
}

// outcome classifies the response for the limiter.
type outcome int

const (
	outcomeOther   outcome = iota // proves nothing (no write, 404, 5xx)
	outcomeKnown                  // a real handler answered for a valid token
	outcomeUnknown                // assessment_unavailable
)

// settle releases the admission's reservation, records whether the token was
// proven valid and, for an unknown token, counts the lookup. Keys with pending
// requests are never swept, so the admission's IP key still exists here.
func (a *Assessment) settle(tokenKey, ipKey string, reserved bool, o outcome) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if t := a.keys[tokenKey]; t != nil {
		t.known = o == outcomeKnown
	}
	c := a.keys[ipKey]
	if c == nil {
		return
	}
	if reserved {
		c.pending--
	}
	if o != outcomeUnknown {
		return
	}
	now := a.now()
	if !now.Before(c.unknownExpires) {
		c.unknown = 0
		c.unknownExpires = now.Add(a.limits.Window)
	}
	c.unknown++
}

type catalogRecorder struct {
	http.ResponseWriter
	code   string
	status int
}

func (w *catalogRecorder) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *catalogRecorder) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

// outcome: only a written non-404, non-5xx response proves the token valid;
// the catch-all 404 and server errors answer the same for any token.
func (w *catalogRecorder) outcome() outcome {
	switch {
	case w.code == string(httpjson.CodeAssessmentUnavailable):
		return outcomeUnknown
	case w.status == 0 || w.status == http.StatusNotFound || w.status >= 500:
		return outcomeOther
	default:
		return outcomeKnown
	}
}

func (w *catalogRecorder) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *catalogRecorder) RecordCatalogCode(code string) {
	w.code = code
	if outer, ok := w.ResponseWriter.(httpjson.CatalogCodeRecorder); ok {
		outer.RecordCatalogCode(code)
	}
}

func (a *Assessment) isTrusted(addr netip.Addr) bool {
	for _, prefix := range a.trusted {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

func (a *Assessment) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		// All malformed peers share one budget; never use attacker-controlled text.
		return "invalid"
	}
	peer = peer.Unmap()
	client := peer
	if a.isTrusted(peer) {
		parts := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
		hops := make([]netip.Addr, len(parts))
		valid := true
		for i, part := range parts {
			hop, err := netip.ParseAddr(strings.TrimSpace(part))
			if err != nil {
				valid = false
				break
			}
			hops[i] = hop.Unmap()
		}
		if valid {
			for i := len(hops) - 1; i >= 0; i-- {
				if !a.isTrusted(hops[i]) {
					client = hops[i]
					break
				}
			}
		}
	}
	if client.Is6() {
		return netip.PrefixFrom(client, 64).Masked().String()
	}
	return client.String()
}
