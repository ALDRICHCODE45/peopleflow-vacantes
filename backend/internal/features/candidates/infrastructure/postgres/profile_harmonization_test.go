package postgres

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestDecimalYearsPreserved(t *testing.T) {
	for _, tc := range []struct{ input, want string }{{"0", "0"}, {"1.5", "1.5"}, {"59.9", "59.9"}, {"60.0", "60"}} {
		t.Run(tc.input, func(t *testing.T) {
			var n pgtype.Numeric
			if err := n.Scan(tc.input); err != nil {
				t.Fatal(err)
			}
			got, err := numericToYears(n)
			if err != nil || got == nil || *got != tc.want {
				t.Fatalf("got %v, %v", got, err)
			}
			roundTrip, err := numericToYears(yearsToNumeric(got))
			if err != nil || roundTrip == nil || *roundTrip != tc.want {
				t.Fatalf("round trip %v, %v", roundTrip, err)
			}
		})
	}
	if got, err := numericToYears(pgtype.Numeric{}); got != nil || err != nil {
		t.Fatalf("null: %v %v", got, err)
	}
}

func TestProfileRuntimeHasNoRollbackMetadataDependency(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("source location unavailable")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(file), "../../../../.."))
	for _, path := range []string{"db/queries/candidates.sql", "internal/db/candidates.sql.go", "internal/features/candidates/infrastructure/postgres/candidateRepository.go"} {
		raw, err := os.ReadFile(filepath.Join(root, path))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), "candidate_language_0039_backup") || strings.Contains(string(raw), "candidate_profile_0039_fields") {
			t.Errorf("runtime rollback dependency in %s", path)
		}
	}
}
