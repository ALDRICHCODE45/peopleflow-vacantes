package postgres

import (
	"github.com/jackc/pgx/v5/pgtype"
	"testing"
)

func TestLegacyDecimalYears(t *testing.T) {
	for _, tc := range []struct {
		input string
		want  int
	}{{"0", 0}, {"1.5", 1}, {"59.9", 59}, {"60.0", 60}} {
		t.Run(tc.input, func(t *testing.T) {
			var n pgtype.Numeric
			if err := n.Scan(tc.input); err != nil {
				t.Fatal(err)
			}
			got, err := numericToLegacyYears(n)
			if err != nil || got == nil || *got != tc.want {
				t.Fatalf("got %v, %v", got, err)
			}
		})
	}
	got, err := numericToLegacyYears(pgtype.Numeric{})
	if got != nil || err != nil {
		t.Fatalf("null: %v %v", got, err)
	}
}
