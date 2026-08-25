package valueobjects

import (
	"errors"
	"testing"
)

// TestParseApplicationSource covers the closed-set parser for the source
// column (design D6 + the spec scenario "out-of-vocabulary source is
// rejected"). The match is case + whitespace tolerant (mirroring
// ParseMemberRole). Unknown values return ErrInvalidSource.
func TestParseApplicationSource(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		want    ApplicationSource
		wantErr bool
	}{
		{"referral lowercase", "referral", Referral, false},
		{"linkedin", "linkedin", LinkedIn, false},
		{"job_board snake", "job_board", JobBoard, false},
		{"direct", "direct", Direct, false},
		{"other", "other", Other, false},
		{"REFERRAL uppercase", "REFERRAL", Referral, false},
		{"  LinkedIn  whitespace + mixed case", "  LinkedIn  ", LinkedIn, false},
		{"empty string", "", UnknownApplicationSource, true},
		{"newspaper (out of vocabulary)", "newspaper", UnknownApplicationSource, true},
		{"google (out of vocabulary)", "google", UnknownApplicationSource, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := ParseApplicationSource(c.in)
			if c.wantErr {
				if !errors.Is(err, ErrInvalidSource) {
					t.Errorf("ParseApplicationSource(%q): want ErrInvalidSource, got %v", c.in, err)
				}
				if got != UnknownApplicationSource {
					t.Errorf("ParseApplicationSource(%q): want UnknownApplicationSource on err, got %v", c.in, got)
				}
				return
			}
			if err != nil {
				t.Errorf("ParseApplicationSource(%q): unexpected err %v", c.in, err)
			}
			if got != c.want {
				t.Errorf("ParseApplicationSource(%q): want %v, got %v", c.in, c.want, got)
			}
		})
	}
}

// TestApplicationSource_String pins the canonical lowercase wire form for
// every member, including the UnknownApplicationSource zero value (which
// renders as "unknown_source" so the JSON encoder never produces an empty
// string for a corrupted row).
func TestApplicationSource_String(t *testing.T) {
	cases := []struct {
		s    ApplicationSource
		want string
	}{
		{UnknownApplicationSource, "unknown_source"},
		{Referral, "referral"},
		{LinkedIn, "linkedin"},
		{JobBoard, "job_board"},
		{Direct, "direct"},
		{Other, "other"},
	}
	for _, c := range cases {
		if got := c.s.String(); got != c.want {
			t.Errorf("ApplicationSource(%d).String(): want %q, got %q", c.s, c.want, got)
		}
	}
}
