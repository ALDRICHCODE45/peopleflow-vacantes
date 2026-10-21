package languages_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
	"golang.org/x/text/unicode/norm"
)

func TestCatalogInvariants(t *testing.T) {
	items := languages.All()
	if len(items) < 170 || len(items) > 200 {
		t.Fatalf("catalog size %d", len(items))
	}
	seen := map[string]bool{}
	for _, item := range items {
		if seen[item.Code] || !regexp.MustCompile(`^[a-z]{2,3}$`).MatchString(item.Code) {
			t.Fatalf("invalid/duplicate code %q", item.Code)
		}
		seen[item.Code] = true
		if item.Name == "" || !norm.NFC.IsNormalString(item.Name) {
			t.Errorf("non-NFC/empty name %q", item.Name)
		}
		if name, ok := languages.Lookup(item.Code); !ok || name != item.Name {
			t.Errorf("lookup %s", item.Code)
		}
		if strings.HasPrefix(item.Code, "q") && len(item.Code) == 3 {
			reason := languages.LocalUseReason(item.Code)
			if item.Code < "qaa" || item.Code > "qtz" || !strings.Contains(reason, "INALI "+item.Name) || !strings.Contains(reason, "no ISO code") {
				t.Errorf("undocumented/out-of-range local code %s", item.Code)
			}
		}
	}
	for code, name := range map[string]string{
		"nah": "Náhuatl", "yua": "Maya yucateco", "tzh": "Tseltal", "tzo": "Tsotsil", "qaa": "Mixteco", "zap": "Zapoteco", "qab": "Otomí", "qac": "Totonaco", "ctu": "Ch'ol", "qad": "Mazateco", "hus": "Huasteco", "qae": "Mazahua", "qaf": "Tlapaneco", "qag": "Chinanteco", "qah": "Purépecha", "qai": "Mixe", "qaj": "Tarahumara", "qak": "Zoque", "toj": "Tojolabal", "chf": "Chontal de Tabasco", "hch": "Huichol", "qal": "Amuzgo", "qam": "Chatino", "qan": "Tepehuano", "qao": "Triqui", "qap": "Popoluca", "qaq": "Cora", "yaq": "Yaqui", "mfy": "Mayo", "sei": "Seri",
	} {
		if got, ok := languages.Lookup(code); !ok || got != name {
			t.Errorf("required %s: got %q", code, got)
		}
	}
	for _, code := range []string{"", "ES", " es", "zz", "mix"} {
		if _, ok := languages.Lookup(code); ok {
			t.Errorf("unexpected %q", code)
		}
	}
	items[0].Name = "mutated"
	if languages.All()[0].Name == "mutated" {
		t.Fatal("mutable catalog leaked")
	}
}

func TestVocabularies(t *testing.T) {
	for _, tt := range []struct {
		values  []string
		want    string
		compare func(string, string) (int, bool)
	}{
		{languages.LanguageLevels(), "A1 A2 B1 B2 C1 C2 native", languages.CompareLanguageLevels},
		{languages.EducationLevels(), "secondary high_school technical tsu bachelor specialty master phd", languages.CompareEducationLevels},
	} {
		if strings.Join(tt.values, " ") != tt.want {
			t.Fatalf("vocabulary %v", tt.values)
		}
		for i, a := range tt.values {
			for j, b := range tt.values {
				got, ok := tt.compare(a, b)
				if !ok || (i < j && got >= 0) || (i == j && got != 0) || (i > j && got <= 0) {
					t.Errorf("compare %s %s: %d %v", a, b, got, ok)
				}
			}
		}
		for _, bad := range []string{"", "unknown", " A1", "a1"} {
			if _, ok := tt.compare(bad, tt.values[0]); ok {
				t.Errorf("accepted %q", bad)
			}
			if _, ok := tt.compare(tt.values[0], bad); ok {
				t.Errorf("accepted RHS %q", bad)
			}
		}
	}
	if strings.Join(languages.Seniorities(), " ") != "intern junior semi_senior senior lead manager director" {
		t.Fatal("seniorities")
	}
	if strings.Join(languages.EducationStatuses(), " ") != "in_progress paused completed incomplete" {
		t.Fatal("statuses")
	}
	for _, s := range languages.LanguageLevels() {
		if !languages.ValidLanguageLevel(s) {
			t.Fatal(s)
		}
	}
	for _, s := range languages.EducationLevels() {
		if !languages.ValidEducationLevel(s) {
			t.Fatal(s)
		}
	}
	if languages.ValidLanguageLevel("Nativo") || languages.ValidEducationLevel("Bachelor") {
		t.Fatal("invalid level accepted")
	}
	for _, s := range languages.Seniorities() {
		if !languages.ValidSeniority(s) {
			t.Fatal(s)
		}
	}
	for _, s := range languages.EducationStatuses() {
		if !languages.ValidEducationStatus(s) {
			t.Fatal(s)
		}
	}
	if languages.ValidSeniority("mid") || languages.ValidEducationStatus("Completed") {
		t.Fatal("invalid vocabulary accepted")
	}
	levels := languages.LanguageLevels()
	levels[0] = "bad"
	if languages.LanguageLevels()[0] != "A1" {
		t.Fatal("mutable vocabulary leaked")
	}
}

func TestYears(t *testing.T) {
	for _, tt := range []struct{ in, want string }{{"0", "0"}, {"0.0", "0"}, {"0.1", "0.1"}, {"1.5", "1.5"}, {"2", "2"}, {"2.0", "2"}, {"59.9", "59.9"}, {"60", "60"}, {"60.0", "60"}} {
		t.Run(tt.in, func(t *testing.T) {
			got, ok := languages.NormalizeYears(tt.in)
			if !ok || got != tt.want || !languages.ValidYears(tt.in) {
				t.Fatalf("got %q %v", got, ok)
			}
			again, ok := languages.NormalizeYears(got)
			if !ok || again != got {
				t.Fatal("not idempotent")
			}
		})
	}
	for _, s := range []string{"01", "1.50", "60.5", "-1", "", ".5", "61", "99.9", "100", " 2", "2 ", "2\n", "+2", "2.", "1e1", "２"} {
		t.Run("invalid_"+s, func(t *testing.T) {
			got, ok := languages.NormalizeYears(s)
			if ok || got != "" || languages.ValidYears(s) {
				t.Fatalf("accepted %q", s)
			}
		})
	}
}
