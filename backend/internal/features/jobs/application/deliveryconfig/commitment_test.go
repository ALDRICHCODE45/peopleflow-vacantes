package deliveryconfig_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
)

func TestDecodeCommitment(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       error
	}{
		{"client", `{"commitment_date":"2026-11-10","reason":"client_request"}`, nil},
		{"scope", `{"commitment_date":"2026-11-10","reason":"scope_change"}`, nil},
		{"delay", `{"commitment_date":"2026-11-10","reason":"internal_delay","note":"  ok  "}`, nil},
		{"other", `{"commitment_date":"2026-11-10","reason":"other","note":"  ok  "}`, nil},
		{"500 runes", `{"commitment_date":"2026-11-10","reason":"other","note":"` + strings.Repeat("é", 500) + `"}`, nil},
		{"missing note", `{"commitment_date":"2026-11-10","reason":"other"}`, deliveryconfig.ErrCommitmentNoteRequired},
		{"blank note", `{"commitment_date":"2026-11-10","reason":"other","note":"  "}`, deliveryconfig.ErrCommitmentNoteRequired},
		{"long note", `{"commitment_date":"2026-11-10","reason":"other","note":"` + strings.Repeat("a", 501) + `"}`, deliveryconfig.ErrCommitmentNoteRequired},
		{"note type", `{"commitment_date":"2026-11-10","reason":"other","note":1}`, drafts.ErrInvalidRequest},
		{"invalid date", `{"commitment_date":"2026-02-30","reason":"other","note":"ok"}`, drafts.ErrInvalidRequest},
		{"invalid reason", `{"commitment_date":"2026-11-10","reason":"bad"}`, drafts.ErrInvalidRequest},
		{"unknown", `{"commitment_date":"2026-11-10","reason":"client_request","x":1}`, drafts.ErrInvalidRequest},
		{"duplicate", `{"commitment_date":"2026-11-10","reason":"client_request","reason":"other"}`, drafts.ErrInvalidRequest},
		{"null", `null`, drafts.ErrInvalidRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := deliveryconfig.DecodeCommitment([]byte(tc.body))
			if !errors.Is(err, tc.want) {
				t.Fatalf("%+v %v want %v", got, err, tc.want)
			}
			if err == nil && got.Note != nil && strings.TrimSpace(*got.Note) != *got.Note {
				t.Fatal("untrimmed note")
			}
		})
	}
}
