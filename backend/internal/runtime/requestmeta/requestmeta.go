// Package requestmeta captures where a request came from (client IP, browser)
// for the audit log (audit-log-v1 §4). The Next BFF proves it is the BFF with a
// shared secret and forwards the real client data; any other caller gets the
// address the API itself observes. The secret is only compared, never stored,
// logged or echoed.
package requestmeta

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"net/netip"
	"strings"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/clientip"
)

const (
	// SourceBFF marks metadata forwarded by the Next server with the shared secret.
	SourceBFF = "bff"
	// SourcePeer marks metadata observed by the API (TCP peer or trusted proxy chain).
	SourcePeer = "peer"

	headerProxySecret = "X-PF-Proxy-Secret"
	headerClientIP    = "X-PF-Client-IP"
	headerClientUA    = "X-PF-Client-User-Agent"

	// maxUserAgentBytes bounds the stored browser string.
	maxUserAgentBytes = 512
)

// Meta is the request metadata the audit adapter persists. IP and UserAgent are
// nil when unknown; IPSource is always SourceBFF or SourcePeer.
type Meta struct {
	IP        *netip.Addr
	UserAgent *string
	IPSource  string
}

// Config configures the middleware. An empty ProxySecret means no header is
// ever trusted (local dev). TrustedProxies is the TRUSTED_PROXY_CIDRS list.
type Config struct {
	ProxySecret    string
	TrustedProxies []netip.Prefix
}

type contextKey struct{}

// NewContext returns ctx carrying meta. Middleware uses it; tests and
// non-request callers may too.
func NewContext(ctx context.Context, meta Meta) context.Context {
	return context.WithValue(ctx, contextKey{}, meta)
}

// FromContext returns the request metadata, or false for a context without it
// (system jobs, tests).
func FromContext(ctx context.Context) (Meta, bool) {
	meta, ok := ctx.Value(contextKey{}).(Meta)
	return meta, ok
}

// Middleware stores the request Meta in the context. It never rejects a
// request and writes nothing to the response.
func Middleware(cfg Config) func(http.Handler) http.Handler {
	var secretDigest [sha256.Size]byte
	enabled := cfg.ProxySecret != ""
	if enabled {
		secretDigest = sha256.Sum256([]byte(cfg.ProxySecret))
	}
	trusted := append([]netip.Prefix(nil), cfg.TrustedProxies...)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var meta Meta
			if enabled && secretMatches(secretDigest, r.Header.Get(headerProxySecret)) {
				meta = Meta{IP: parseIP(r.Header.Get(headerClientIP)), UserAgent: userAgent(r.Header.Get(headerClientUA)), IPSource: SourceBFF}
			} else {
				meta = Meta{IP: addrPtr(clientip.Resolve(r, trusted)), UserAgent: userAgent(r.Header.Get("User-Agent")), IPSource: SourcePeer}
			}
			next.ServeHTTP(w, r.WithContext(NewContext(r.Context(), meta)))
		})
	}
}

// secretMatches compares fixed-size digests so neither the content nor the
// length of the configured secret is observable through timing.
func secretMatches(want [sha256.Size]byte, got string) bool {
	sum := sha256.Sum256([]byte(got))
	return subtle.ConstantTimeCompare(want[:], sum[:]) == 1
}

func parseIP(value string) *netip.Addr {
	addr, err := netip.ParseAddr(strings.TrimSpace(value))
	if err != nil {
		return nil
	}
	return addrPtr(addr)
}

// addrPtr drops the IPv6 zone (inet cannot hold it) and unmaps IPv4-in-IPv6.
func addrPtr(addr netip.Addr) *netip.Addr {
	if !addr.IsValid() {
		return nil
	}
	addr = addr.Unmap().WithZone("")
	return &addr
}

// userAgent keeps at most 512 bytes, cut at a UTF-8 boundary. Invalid bytes are
// replaced first: PostgreSQL text refuses them, and a failed audit insert would
// fail the audited request.
func userAgent(value string) *string {
	value = strings.TrimSpace(strings.ToValidUTF8(value, "\uFFFD"))
	if len(value) > maxUserAgentBytes {
		cut := maxUserAgentBytes
		for cut > 0 && !utf8.RuneStart(value[cut]) {
			cut--
		}
		value = value[:cut]
	}
	if value == "" {
		return nil
	}
	return &value
}
