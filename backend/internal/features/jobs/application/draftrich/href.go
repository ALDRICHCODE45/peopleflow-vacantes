// Package draftrich validates rich vacancy draft content.
package draftrich

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	whatwg "github.com/nlnwa/whatwg-url/url"
)

// ErrInvalidHref indicates that a rich-editor link violates the HTTPS policy.
var ErrInvalidHref = errors.New("invalid rich link href")

// ValidateHref accepts explicit absolute HTTPS links without credentials, raw
// controls, Unicode whitespace, backslashes or BOMs, up to 2048 codepoints.
// It returns the original string, never the parser's normalized serialization.
// It does not fetch destinations, classify content or guarantee browser parity.
func ValidateHref(href string) (string, error) {
	const prefix = "https://"
	if !utf8.ValidString(href) || utf8.RuneCountInString(href) > 2048 {
		return "", ErrInvalidHref
	}
	for _, r := range href {
		if r == '\\' || r == '\ufeff' || r <= 0x1f || (r >= 0x7f && r <= 0x9f) || unicode.IsSpace(r) {
			return "", ErrInvalidHref
		}
	}
	if len(href) < len(prefix) || !strings.EqualFold(href[:len(prefix)], prefix) {
		return "", ErrInvalidHref
	}
	// Check the raw authority before WHATWG can repair missing slashes or
	// discard empty credentials. An @ in a path/query is not a credential.
	authority := href[len(prefix):]
	if end := strings.IndexAny(authority, "/?#"); end >= 0 {
		authority = authority[:end]
	}
	if authority == "" || strings.Contains(authority, "@") {
		return "", ErrInvalidHref
	}
	u, err := whatwg.Parse(href)
	if err != nil || u == nil || u.Scheme() != "https" || u.Hostname() == "" || u.Username() != "" || u.Password() != "" {
		return "", ErrInvalidHref
	}
	return href, nil
}
