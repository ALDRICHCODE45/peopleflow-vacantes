package content_test

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/content"
)

// Only tests read the authoring documents. Production has no filesystem dependency.
func readDoc(t *testing.T, name string) string {
	t.Helper()
	path := filepath.Join("../../../../..", "docs/psychometrics", name)
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "\r") {
		t.Fatalf("%s: expected UTF-8 with LF", path)
	}
	return string(b)
}

func table(t *testing.T, doc, header string) [][]string {
	t.Helper()
	lines := strings.Split(doc, "\n")
	var rows [][]string
	found := false
	for n, line := range lines {
		if line == header {
			if found {
				t.Fatalf("duplicate table header %q", header)
			}
			found = true
			continue
		}
		if !found {
			continue
		}
		if !strings.HasPrefix(line, "|") {
			if len(rows) > 0 {
				break
			}
			continue
		}
		if strings.HasPrefix(line, "|---") {
			continue
		}
		cells := strings.Split(strings.Trim(line, "|"), "|")
		expected := len(strings.Split(strings.Trim(header, "|"), "|"))
		if len(cells) != expected {
			t.Fatalf("table %q line %d: ambiguous column count", header, n+1)
		}
		for i := range cells {
			cells[i] = strings.TrimSpace(cells[i])
		}
		rows = append(rows, cells)
	}
	if len(rows) == 0 {
		t.Fatalf("missing/empty table %q", header)
	}
	return rows
}

func integer(t *testing.T, s string) int {
	t.Helper()
	n, err := strconv.Atoi(s)
	if err != nil {
		t.Fatalf("integer %q: %v", s, err)
	}
	return n
}

func captures(t *testing.T, s, pattern string) []string {
	t.Helper()
	m := regexp.MustCompile(pattern).FindStringSubmatch(s)
	if m == nil {
		t.Fatalf("documentation no longer matches %q: %s", pattern, s)
	}
	return m[1:]
}

func quote(t *testing.T, s, anchor string) string {
	t.Helper()
	return captures(t, s, regexp.QuoteMeta(anchor)+"«([^»]+)»")[0]
}

func section(t *testing.T, s, start, end string) string {
	t.Helper()
	_, s, ok := strings.Cut(s, start)
	if !ok {
		t.Fatalf("missing %q", start)
	}
	if end != "" {
		var found bool
		s, _, found = strings.Cut(s, end)
		if !found {
			t.Fatalf("missing %q", end)
		}
	}
	return strings.Trim(s, "\n")
}

func documentFromDocs(t *testing.T) content.Document {
	t.Helper()
	items := readDoc(t, "item-bank-v1.md")
	bands := readDoc(t, "bands-and-competencies-v1.md")
	quality := readDoc(t, "quality-signals-v1.md")
	library := readDoc(t, "interpretation-library-v1.md")
	interview := readDoc(t, "interview-bank-v1.md")
	notice := readDoc(t, "consent-notice-v1.md")
	readme := readDoc(t, "README.md")
	d := content.Document{
		ContentVersion:         captures(t, readme, "content_version = (psychometrics\\.content\\.v[0-9]+)")[0],
		ScoringVersion:         captures(t, readme, "scoring_version = (psychometrics\\.scoring\\.v[0-9]+)")[0],
		Test:                   "ipip60-mx",
		Instruction:            quote(t, items, "Candidate instruction: "),
		Attribution:            captures(t, items, "Attribution: ([^\\n]+)")[0],
		InterpretationPrepend:  quote(t, library, "Always prepend: "),
		Hypothesis:             quote(t, bands, "Display this sentence alongside every competency: "),
		InterpretationHeadings: []string{},
	}
	for _, m := range regexp.MustCompile("«([^»]+)»").FindAllStringSubmatch(strings.Split(library, "Always prepend:")[0], -1) {
		d.InterpretationHeadings = append(d.InterpretationHeadings, m[1])
	}
	for _, r := range table(t, items, "| Value | Candidate option |") {
		d.Scale = append(d.Scale, content.Option{Value: integer(t, r[0]), Label: r[1]})
	}
	for _, r := range table(t, items, "| Facet id | Source code and English name | Hosted label → PeopleFlow label |") {
		label := captures(t, r[2], " → (.+)$")[0]
		d.Facets = append(d.Facets, content.Facet{ID: r[0], Label: label})
	}
	for _, r := range table(t, bands, "| Facet id | band.low | band.medium | band.high |") {
		found := false
		for i := range d.Facets {
			if d.Facets[i].ID == r[0] {
				d.Facets[i].BandTexts = append([]string{}, r[1:]...)
				found = true
			}
		}
		if !found {
			t.Fatalf("%s: band text without facet", r[0])
		}
	}
	for _, r := range table(t, items, "| Number | Item id | Facet: English / PeopleFlow Spanish | Key | English provenance | Hosted Spanish provenance | Corrected Spanish | Note |") {
		code := strings.ToLower(strings.Fields(r[2])[0])
		facetID := "facet." + code
		label := captures(t, r[2], " / (.+)$")[0]
		known := false
		for _, facet := range d.Facets {
			if facet.ID == facetID && facet.Label == label {
				known = true
			}
		}
		if !known {
			line := strings.Count(strings.Split(items, "| "+r[0]+" | "+r[1]+" |")[0], "\n") + 1
			t.Fatalf("item-bank-v1.md:%d: %s facet label inconsistent with facet map", line, r[1])
		}
		d.Items = append(d.Items, content.Item{ID: r[1], Number: integer(t, r[0]), FacetID: facetID, Key: r[3], Text: r[6]})
	}
	for _, r := range table(t, items, "| Position | Item id |") {
		d.Order = append(d.Order, content.Position{Position: integer(t, r[0]), ID: r[1]})
	}
	for _, r := range table(t, quality, "| Attention id | Candidate text | Expected response |") {
		pos := 0
		for _, p := range d.Order {
			if p.ID == r[0] {
				pos = p.Position
			}
		}
		d.Attention = append(d.Attention, content.AttentionItem{ID: r[0], Text: r[1], Expected: integer(t, r[2]), Position: pos})
	}
	for _, r := range table(t, bands, "| Band id | Spanish label | Exact facet sum | Exact general explanation |") {
		bounds := captures(t, r[2], "^([0-9]+)–([0-9]+) inclusive$")
		d.Bands = append(d.Bands, content.Band{ID: r[0], Label: r[1], Min: integer(t, bounds[0]), Max: integer(t, bounds[1]), Explanation: r[3]})
	}
	for _, r := range table(t, bands, "| Competency id | Spanish name | Definition shown to recruiter | Linked facets and direction | Editorial rationale / evidence boundary |") {
		c := content.Competency{ID: r[0], Name: r[1], Definition: r[2], Rationale: r[4]}
		for _, link := range strings.Split(r[3], "; ") {
			m := captures(t, link, "^([A-Z][0-9]) (positive|negative)$")
			c.Facets = append(c.Facets, content.FacetLink{ID: "facet." + strings.ToLower(m[0]), Direction: m[1]})
		}
		d.Competencies = append(d.Competencies, c)
	}
	for _, r := range table(t, library, "| Library id | Competency id | Band id | Cómo se puede ver en el trabajo | Fortalezas | Áreas a desarrollar |") {
		d.Library = append(d.Library, content.Interpretation{
			ID:              r[0],
			CompetencyID:    r[1],
			Band:            r[2],
			WorkText:        strings.ReplaceAll(r[3], "<br>", "\n"),
			StrengthsText:   strings.ReplaceAll(r[4], "<br>", "\n"),
			DevelopmentText: strings.ReplaceAll(r[5], "<br>", "\n"),
		})
	}
	for _, r := range table(t, interview, "| Question id | Competency id | Band/focus selector | Question | What a good answer shows |") {
		d.Questions = append(d.Questions, content.Question{ID: r[0], CompetencyID: r[1], Selector: r[2], Text: r[3], GoodAnswerChecklist: r[4]})
	}
	d.STAR = quote(t, interview, "For **every** selected question, append this fixed STAR follow-up: ")
	d.InterviewIntroduction = quote(t, interview, "Candidate-facing introduction: ")
	d.InterviewerInstruction = quote(t, interview, "Recruiter instruction: ")
	rules := section(t, interview, "## Deterministic guide selection\n", "")
	d.Selection = content.SelectionRules{
		MaxQuestions:        integer(t, captures(t, rules, "at most ([0-9]+)")[0]),
		BlockSlots:          wordNumber(t, captures(t, rules, "one of ([a-z]+) block slots")[0]),
		OrdinaryWithQuality: wordNumber(t, captures(t, rules, "first ([a-z]+) ordinary blocks, then append")[0]),
		QuestionsPerBlock:   integer(t, captures(t, rules, "questions 1 and ([0-9]+)")[0]),
		ImportanceOrder:     strings.Split(captures(t, rules, "job importance \\(([^)]+)\\)")[0], ", "),
		FocusOrder:          strings.Split(captures(t, rules, "focus priority \\(([^)]+)\\)")[0], ", "),
		QualityFallback:     captures(t, bands, "if none, attach to (comp\\.[a-z]+)")[0],
		Rules:               rules,
	}
	for _, r := range table(t, quality, "| Signal id | Calculation / boundary | Mild | Strong |") {
		sig := content.Signal{ID: r[0], Calculation: r[1], Mild: r[2], Strong: r[3]}
		sig.MildMin = integer(t, captures(t, r[2], "([0-9]+)")[0])
		if r[0] != "signal.changes" {
			n := integer(t, captures(t, r[3], "([0-9]+)")[0])
			sig.StrongMin = &n
		}
		switch r[0] {
		case "signal.attention":
			sig.Denominator = integer(t, captures(t, r[1], "denominator ([0-9]+)")[0])
		case "signal.fast":
			sig.Denominator = integer(t, captures(t, r[1], "divide by ([0-9]+)")[0])
			sig.FastBelowMS = integer(t, captures(t, r[1], "strictly below ([0-9]+) ms")[0])
			sig.RequiresCompleteTiming = strings.Contains(r[1], "Require valid time for all 60 or mark unknown")
		case "signal.changes":
			sig.Denominator = integer(t, captures(t, r[1], "across ([0-9]+) personality")[0])
			sig.AlwaysKnownV1 = strings.Contains(quality, "`signal.changes` is always known")
		}
		d.Quality.Signals = append(d.Quality.Signals, sig)
	}
	for _, r := range table(t, quality, "| Tier id | Recruiter label | Exact rule, in priority order |") {
		d.Quality.Tiers = append(d.Quality.Tiers, content.Tier{ID: r[0], Label: r[1], Rule: r[2]})
		if r[0] == "tier.relevantes" {
			d.Quality.RelevantMildMin = integer(t, captures(t, r[2], "at least ([0-9]+) mild")[0])
			if strings.HasPrefix(r[2], "Any strong signal OR") {
				d.Quality.RelevantStrongMin = 1
			}
		}
		if r[0] == "tier.algunas" {
			d.Quality.SomeMildCount = integer(t, captures(t, r[2], "Exactly ([0-9]+) mild")[0])
		}
	}
	d.Quality.Semantics = section(t, quality, "### Time and answer-change semantics\n", "## Deterministic tiers")
	for _, r := range table(t, quality, "| Id / condition | Exact Spanish text |") {
		d.Quality.Messages = append(d.Quality.Messages, content.Message{ID: r[0], Text: r[1]})
	}
	d.Notice = content.Notice{
		Version: captures(t, notice, "Versión del aviso: `([^`]+)`")[0],
		Text:    section(t, notice, "## Inicio del aviso\n", "## Fin del aviso"),
	}
	d.Notice.SHA256 = fmt.Sprintf("%x", sha256.Sum256([]byte(d.Notice.Text)))
	return d
}

func wordNumber(t *testing.T, word string) int {
	t.Helper()
	switch word {
	case "four":
		return 4
	case "three":
		return 3
	}
	t.Fatalf("unknown numeric word %q", word)
	return 0
}
