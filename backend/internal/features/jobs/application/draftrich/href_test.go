package draftrich_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftrich"
)

func TestValidateHref(t *testing.T) {
	tests := []struct {
		name, href string
		valid      bool
	}{
		{"https", "https://example.com/", true},
		{"preserve spelling", "HTTPS://EXAMPLE.com:443/a%2fb?q=@#TOP", true},
		{"international host and path", "https://mañana.com/diseño", true},
		{"punycode", "https://xn--maana-pta.com/", true},
		{"known accepted mismatch", "https://xn--.com/", true},
		{"ipv6", "https://[::1]/", true},
		{"browser ipv4", "https://127.1/", true},
		{"largest port", "https://example.com:65535/", true},
		{"empty port retained", "https://example.com:/", true},
		{"escaped host", "https://%68ost.com/", true},
		{"malformed path escape retained", "https://example.com/%zz", true},
		{"http", "http://example.com/", false},
		{"javascript", "javascript:alert(1)", false},
		{"data", "data:text/html,test", false},
		{"relative", "/jobs", false},
		{"scheme relative", "//example.com/", false},
		{"empty", "", false},
		{"single slash", "https:/example.com", false},
		{"empty authority", "https:///example.com", false},
		{"missing host", "https://", false},
		{"credentials", "https://user:pass@example.com/", false},
		{"empty credentials", "https://@example.com/", false},
		{"escaped at in host", "https://user%40example.com/", false},
		{"backslash", "https://example.com\\evil", false},
		{"bom", "https://example.com/\ufeff", false},
		{"port overflow", "https://example.com:65536/", false},
		{"port text", "https://example.com:abc/", false},
		{"bad ipv6", "https://[::1/", false},
		{"ipv6 zone", "https://[fe80::1%25eth0]/", false},
		{"bad ipv4", "https://999.1.1.1/", false},
		{"encoded host control", "https://host%00.com/", false},
		{"invalid utf8", "https://example.com/\xff", false},
	}
	prefix := "https://example.com/"
	tests = append(tests,
		struct {
			name, href string
			valid      bool
		}{"codepoint boundary", prefix + strings.Repeat("😀", 2048-len(prefix)), true},
		struct {
			name, href string
			valid      bool
		}{"over boundary", prefix + strings.Repeat("😀", 2049-len(prefix)), false},
	)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := draftrich.ValidateHref(tt.href)
			if tt.valid {
				if err != nil || got != tt.href {
					t.Fatalf("got %q, %v; want unchanged href", got, err)
				}
			} else if !errors.Is(err, draftrich.ErrInvalidHref) || got != "" {
				t.Fatalf("got %q, %v; want empty and ErrInvalidHref", got, err)
			}
		})
	}
}

func TestValidateHrefRejectsRawWhitespaceAndControls(t *testing.T) {
	forbidden := []rune{' ', 0x85, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000}
	for r := rune(0x2000); r <= 0x200a; r++ {
		forbidden = append(forbidden, r)
	}
	for r := rune(0); r <= 0x1f; r++ {
		forbidden = append(forbidden, r)
	}
	for r := rune(0x7f); r <= 0x9f; r++ {
		forbidden = append(forbidden, r)
	}
	for _, r := range forbidden {
		t.Run(string(r), func(t *testing.T) {
			got, err := draftrich.ValidateHref("https://example.com/a" + string(r) + "b")
			if got != "" || !errors.Is(err, draftrich.ErrInvalidHref) {
				t.Fatalf("U+%04X: got %q, %v", r, got, err)
			}
		})
	}
}
