package migrations_test

import (
	"io/fs"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
)

// TestMigrationsFSContainsEmbeddedMigrations proves the embed wrapper exposes
// the migration `*.sql` files as ascending, goose-named read-only entries.
//
// RED-critical: against the nil/empty scaffold this fails exactly with
// "nil/empty FS contains no migrations".
func TestMigrationsFSContainsEmbeddedMigrations(t *testing.T) {
	if migrations.MigrationsFS == nil {
		t.Fatal("nil/empty FS contains no migrations")
	}
	entries, err := fs.ReadDir(migrations.MigrationsFS, ".")
	if err != nil {
		t.Fatalf("nil/empty FS contains no migrations: read failed: %v", err)
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			t.Errorf("embedded FS must contain only .sql migrations, got entry %q", e.Name())
			continue
		}
		names = append(names, e.Name())
	}
	if len(names) == 0 {
		t.Fatal("nil/empty FS contains no migrations")
	}
	sorted := append([]string(nil), names...)
	sort.Strings(sorted)
	for i, name := range names {
		if name != sorted[i] {
			t.Fatalf("embedded migrations are not ascending: %v", names)
		}
		if !regexp.MustCompile(`^000\d+_.*\.sql$`).MatchString(name) {
			t.Errorf("embedded entry %q does not match goose naming 000NN_name.sql", name)
		}
	}
}
