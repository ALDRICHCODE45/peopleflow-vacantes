package entities

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// annexPath is docs/contracts/audit-log-v1.md relative to this package
// (entities → domain → audit_events → features → internal → backend → repo).
const annexPath = "../../../../../../docs/contracts/audit-log-v1.md"

var annexRow = regexp.MustCompile("^\\| `([A-Za-z]+)` \\| ([a-z_]+) \\| (.+) \\|$")

// TestContractAnnexListsEveryCatalogType: the contract annex is the label table
// both sides start from (audit-log-v1 §8.2), so it must carry exactly one row
// per catalog type, with the catalog's category and a non-empty label.
func TestContractAnnexListsEveryCatalogType(t *testing.T) {
	raw, err := os.ReadFile(filepath.FromSlash(annexPath))
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	text := string(raw)
	start := strings.Index(text, "## Annex")
	if start < 0 {
		t.Fatal("contract has no Annex section")
	}
	annex := text[start:]
	if end := strings.Index(annex[len("## Annex"):], "\n## "); end >= 0 {
		annex = annex[:len("## Annex")+end]
	}
	rows := map[string]string{}
	for _, line := range strings.Split(annex, "\n") {
		m := annexRow.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		if _, dup := rows[m[1]]; dup {
			t.Errorf("annex lists %s twice", m[1])
		}
		rows[m[1]] = m[2]
		if strings.TrimSpace(m[3]) == "" {
			t.Errorf("annex row %s has no label", m[1])
		}
	}
	for _, spec := range Catalog() {
		category, ok := rows[spec.Type]
		if !ok {
			t.Errorf("annex has no row for %s", spec.Type)
			continue
		}
		if category != string(spec.Category) {
			t.Errorf("annex %s: category %q, catalog %q", spec.Type, category, spec.Category)
		}
		delete(rows, spec.Type)
	}
	for extra := range rows {
		t.Errorf("annex row %s is not in the catalog", extra)
	}
}
