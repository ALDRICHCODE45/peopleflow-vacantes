// Package clientip resolves the client address of a request from the TCP peer
// and, only when that peer is a trusted proxy, from X-Forwarded-For. It is the
// single trusted-proxy rule shared by the assessment rate limiter and the
// request metadata middleware.
package clientip

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// IsTrusted reports whether addr is inside one of the trusted proxy networks.
func IsTrusted(trusted []netip.Prefix, addr netip.Addr) bool {
	for _, prefix := range trusted {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

// Resolve returns the client address: the TCP peer, or the rightmost untrusted
// X-Forwarded-For hop when the peer is a trusted proxy. A malformed header
// falls back to the peer. A malformed peer yields the invalid zero Addr; the
// caller decides how to bucket or store it. IPv4-mapped addresses are unmapped.
func Resolve(r *http.Request, trusted []netip.Prefix) netip.Addr {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}
	}
	peer = peer.Unmap()
	if !IsTrusted(trusted, peer) {
		return peer
	}
	parts := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	hops := make([]netip.Addr, len(parts))
	for i, part := range parts {
		hop, err := netip.ParseAddr(strings.TrimSpace(part))
		if err != nil {
			return peer
		}
		hops[i] = hop.Unmap()
	}
	for i := len(hops) - 1; i >= 0; i-- {
		if !IsTrusted(trusted, hops[i]) {
			return hops[i]
		}
	}
	return peer
}
