package localbootstrap

import (
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
)

func TestParseOperatorLine(t *testing.T) {
	tests := []struct {
		name     string
		line     string
		wantDec  OperatorDecision
		wantCode string
	}{
		{name: "approve exact", line: "approve OPERATIONCODE1234567890A", wantDec: DecisionApprove, wantCode: "OPERATIONCODE1234567890A"},
		{name: "approve with surrounding spaces", line: "  approve   OPERATIONCODE1234567890A  ", wantDec: DecisionApprove, wantCode: "OPERATIONCODE1234567890A"},
		{name: "reject", line: "reject", wantDec: DecisionReject},
		{name: "reject with spaces", line: "  reject  ", wantDec: DecisionReject},
		{name: "uppercase approve rejected", line: "APPROVE CODE", wantDec: DecisionInvalid},
		{name: "bare approve rejected", line: "approve", wantDec: DecisionInvalid},
		{name: "approve with extra token rejected", line: "approve CODE EXTRA", wantDec: DecisionInvalid},
		{name: "reject with extra token rejected", line: "reject extra", wantDec: DecisionInvalid},
		{name: "empty rejected", line: "", wantDec: DecisionInvalid},
		{name: "garbage rejected", line: "yes", wantDec: DecisionInvalid},
		{name: "command injection rejected", line: "approve CODE; rm -rf /", wantDec: DecisionInvalid},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dec, code := ParseOperatorLine(tt.line)
			if dec != tt.wantDec || code != tt.wantCode {
				t.Errorf("ParseOperatorLine(%q) = (%v, %q), want (%v, %q)", tt.line, dec, code, tt.wantDec, tt.wantCode)
			}
		})
	}
}

func TestSanitizeForTerminal(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "plain text preserved", in: "user@example.com", want: "user@example.com"},
		{name: "ansi escape removed", in: "a\x1b[31mb", want: "a[31mb"},
		{name: "newline replaced with space", in: "a\nb", want: "a b"},
		{name: "carriage return replaced with space", in: "a\rb", want: "a b"},
		{name: "bell removed", in: "a\x07b", want: "ab"},
		{name: "c1 control removed", in: "a\u0085b", want: "ab"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SanitizeForTerminal(tt.in)
			if got != tt.want {
				t.Errorf("SanitizeForTerminal(%q) = %q, want %q", tt.in, got, tt.want)
			}
			for _, r := range got {
				if r == '\n' || r == '\r' || (r < 0x20) || (r >= 0x7f && r <= 0x9f) {
					t.Fatalf("SanitizeForTerminal leaked a control character in %q", got)
				}
			}
		})
	}
}

func TestApprovalPrompt_AllowedFieldsOnly(t *testing.T) {
	cand := Candidate{
		Subject:       "secret-subject-value",
		Email:         "user@example.com",
		FullName:      "Secret Name Value",
		UserType:      valueobjects.UserRecruiter,
		Database:      DatabaseTarget{Host: "127.0.0.1", Port: "5432", Name: "local_db"},
		OperationCode: "OPERATIONCODE1234567890A",
	}
	prompt := ApprovalPrompt(cand, "https://issuer.example")

	for _, want := range []string{
		"user@example.com",
		"https://issuer.example",
		"recruiter",
		"users-only",
		"127.0.0.1:5432/local_db",
		"OPERATIONCODE1234567890A",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt does not contain %q:\n%s", want, prompt)
		}
	}
	for _, forbidden := range []string{"secret-subject-value", "Secret Name Value"} {
		if strings.Contains(prompt, forbidden) {
			t.Errorf("prompt leaks %q:\n%s", forbidden, prompt)
		}
	}
}

func TestApprovalPrompt_SanitizesDisplayedValues(t *testing.T) {
	cand := Candidate{
		Subject:       "sub-1",
		Email:         "user@example.com\x1b[2J\ninjected",
		FullName:      "Ada",
		UserType:      valueobjects.UserRecruiter,
		Database:      DatabaseTarget{Host: "127.0.0.1", Port: "5432", Name: "local_db"},
		OperationCode: "OPERATIONCODE1234567890A",
	}
	prompt := ApprovalPrompt(cand, "https://issuer.example\ninjected")

	if strings.Contains(prompt, "\x1b") {
		t.Errorf("prompt contains an ANSI escape: %q", prompt)
	}
	for _, line := range strings.Split(strings.TrimSuffix(prompt, "\n"), "\n") {
		if strings.Contains(line, "injected") && strings.HasPrefix(strings.TrimSpace(line), "injected") {
			t.Errorf("prompt gained an injected line: %q", prompt)
		}
	}
}
