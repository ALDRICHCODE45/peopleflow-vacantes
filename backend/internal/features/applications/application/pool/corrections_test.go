package pool

import (
	"encoding/json"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
)

func TestCorrectedContactNeverAliasesOriginal(t *testing.T) {
	for _, tc := range []struct {
		name, corrections    string
		wantEmail, wantPhone *string
	}{
		{"unchanged", `{}`, str("original@example.test"), str("+523311111111")},
		{"set", `{"email":"corrected@example.test","phone":"+523322222222"}`, str("corrected@example.test"), str("+523322222222")},
		{"clear", `{"email":null,"phone":null}`, nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			original := board.Contact{Email: str("original@example.test"), Phone: str("+523311111111")}
			var corrections map[string]json.RawMessage
			if err := json.Unmarshal([]byte(tc.corrections), &corrections); err != nil {
				t.Fatal(err)
			}
			got, err := CorrectedContact(original, corrections)
			if err != nil {
				t.Fatal(err)
			}
			for _, pair := range [][2]*string{{got.Email, tc.wantEmail}, {got.Phone, tc.wantPhone}} {
				if (pair[0] == nil) != (pair[1] == nil) || (pair[0] != nil && *pair[0] != *pair[1]) {
					t.Fatal("wrong effective contact", got)
				}
			}
			if got.Email != nil {
				*got.Email = "mutated"
			}
			if got.Phone != nil {
				*got.Phone = "mutated"
			}
			if *original.Email != "original@example.test" || *original.Phone != "+523311111111" {
				t.Fatal("original contact aliased")
			}
		})
	}
}
func str(s string) *string { return &s }
