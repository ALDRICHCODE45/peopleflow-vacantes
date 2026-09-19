// C12V: behavior-first tests for the package-owned explanatory-docs validator
// (proposal §9.12 / Task 8.1). Every fixture is an in-memory four-document set;
// the real documentation tree is never read for a decision here.
package closurereport

import (
	"slices"
	"strings"
	"testing"
)

// The clean fixtures carry every package-owned canonical marker exactly once,
// no stale literal, no unlabelled locked-non-goal topic, and no normative token.
const (
	cleanReadmeBody  = "# PeopleFlow\n\nEl modelo de datos tiene 9 tablas.\n"
	cleanRoadmapBody = "# ROADMAP\n\n" +
		"- Migraciones goose hasta `00011`.\n" +
		"- Rutas `/me/profile/languages` y `/readyz`.\n" +
		"- Auth de producción `JWKS`; industria inválida responde `industry_unavailable`.\n" +
		"- Binarios `cmd/migrate` y `cmd/postconfirmation`.\n"
	cleanArchitectureBody = "# Arquitectura\n\n" +
		"- 9 tablas en 7 features.\n" +
		"- Guard `archguard`; feature `features/audit_events`.\n" +
		"- Excepciones documentadas: `audit_events/domain`.\n"
	cleanDataModelBody = "# Modelo\n\n" +
		"- 9 tablas.\n" +
		"- Índice `jobs_company_id_idx`.\n" +
		"- Migrar con `cmd/migrate`.\n" +
		"- Vocabulario cerrado: `CompanyUpdated`.\n"
)

// findingKey is the ordered, comparable projection of one finding.
type findingKey struct {
	rule string
	path docID
	line int
}

// cleanDocs is the minimal four-document set that satisfies every rule.
func cleanDocs() map[docID]string {
	return map[docID]string{
		docReadme:       cleanReadmeBody,
		docRoadmap:      cleanRoadmapBody,
		docArchitecture: cleanArchitectureBody,
		docDataModel:    cleanDataModelBody,
	}
}

// cleanDoc returns one clean fixture document body.
func cleanDoc(path docID) string { return cleanDocs()[path] }

// docBody joins explicit document lines into one body, so a fixture pins its own
// line numbers instead of depending on a concatenation offset.
func docBody(lines ...string) string { return strings.Join(lines, "\n") + "\n" }

// docsWith replaces one fixed document body in the clean set.
func docsWith(path docID, body string) map[docID]string {
	docs := cleanDocs()
	docs[path] = body
	return docs
}

// wantFindingKeys asserts the exact ordered (rule, path, line) projection and
// that every finding carries a non-empty detail.
func wantFindingKeys(t *testing.T, got []DocFinding, want []findingKey) {
	t.Helper()
	keys := make([]findingKey, 0, len(got))
	for _, finding := range got {
		keys = append(keys, findingKey{finding.Rule, docID(finding.Path), finding.Line})
		if finding.Detail == "" {
			t.Fatalf("finding %+v must carry a detail", finding)
		}
	}
	if !slices.Equal(keys, want) {
		t.Fatalf("findings = %#v, want exact ordered %#v", keys, want)
	}
}

// wantRuleFire asserts at least one finding carries the exact rule ID.
func wantRuleFire(t *testing.T, got []DocFinding, rule string) {
	t.Helper()
	if !slices.ContainsFunc(got, func(finding DocFinding) bool { return finding.Rule == rule }) {
		t.Fatalf("rule %q produced no finding: %#v", rule, got)
	}
}

// checkDocs runs the validator over one document set and fails on an error.
func checkDocs(t *testing.T, docs map[docID]string) []DocFinding {
	t.Helper()
	findings, err := checkExplanatoryDocs(docs)
	if err != nil {
		t.Fatalf("checkExplanatoryDocs: %v", err)
	}
	return findings
}

// TestCheckExplanatoryDocs_CleanFixedSetIsDeterministicallyEmpty proves a clean
// document set yields an intentional non-nil empty result, and that the fixture
// is genuinely rule-satisfying: every canonical marker of every rule is present
// and no stale literal or locked non-goal topic is, so the empty result cannot
// come from an inert rule table.
func TestCheckExplanatoryDocs_CleanFixedSetIsDeterministicallyEmpty(t *testing.T) {
	docs := cleanDocs()
	got := checkDocs(t, docs)

	if got == nil {
		t.Fatal("a clean document set must return an intentional non-nil empty slice")
	}
	if len(got) != 0 {
		t.Fatalf("clean fixed documents produced findings: %#v", got)
	}

	for _, rule := range docRules {
		for _, path := range rulePaths(rule) {
			body := docs[path]
			for _, marker := range rule.Canonical {
				if !strings.Contains(body, marker) {
					t.Fatalf("clean fixture %s must carry the canonical marker %q of rule %s", path, marker, rule.ID)
				}
			}
			for _, stale := range rule.Stale {
				if strings.Contains(body, stale) {
					t.Fatalf("clean fixture %s must not carry the stale literal %q of rule %s", path, stale, rule.ID)
				}
			}
			for _, topic := range rule.Topics {
				if strings.Contains(body, topic) {
					t.Fatalf("clean fixture %s must not mention the unlabelled topic %q of rule %s", path, topic, rule.ID)
				}
			}
		}
	}
}

// TestCheckExplanatoryDocs_StaleClaimRequiresCanonicalReplacement pins the
// stale+canonical pair contract: a stale claim always blocks, and removing it
// without stating the delivered fact blocks too.
func TestCheckExplanatoryDocs_StaleClaimRequiresCanonicalReplacement(t *testing.T) {
	tests := []struct {
		name string
		docs map[docID]string
		want []findingKey
	}{
		{
			name: "stale claim present blocks and names its line",
			docs: docsWith(docRoadmap,
				cleanDoc(docRoadmap)+"- Migraciones goose aplicadas (versión 8).\n"),
			want: []findingKey{{"docs-roadmap-migration-version", docRoadmap, 7}},
		},
		{
			name: "stale claim removed but the canonical replacement missing blocks",
			docs: docsWith(docRoadmap, strings.Replace(cleanDoc(docRoadmap), "00011", "", 1)),
			want: []findingKey{{"docs-roadmap-migration-version", docRoadmap, 1}},
		},
		{
			name: "delivered fact documented without any stale claim is clean",
			docs: docsWith(docRoadmap, cleanDoc(docRoadmap)+"- Migraciones goose hasta la 00011 entregada.\n"),
			want: []findingKey{},
		},
		{
			name: "one canonical marker can be missing from a multi-marker rule",
			docs: docsWith(docDataModel, strings.Replace(cleanDoc(docDataModel), "jobs_company_id_idx", "", 1)),
			want: []findingKey{{"docs-model-jobs-schema", docDataModel, 1}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wantFindingKeys(t, checkDocs(t, tt.docs), tt.want)
		})
	}
}

// TestCheckExplanatoryDocs_RequiredMarkerOmission pins the delivered fact a
// document omits entirely: the canonical marker itself is the violation.
func TestCheckExplanatoryDocs_RequiredMarkerOmission(t *testing.T) {
	tests := []struct {
		name string
		docs map[docID]string
		want []findingKey
	}{
		{
			name: "cmd/migrate omission blocks the ROADMAP",
			docs: docsWith(docRoadmap, strings.Replace(cleanDoc(docRoadmap), "cmd/migrate", "", 1)),
			want: []findingKey{{"docs-roadmap-migrate-marker", docRoadmap, 1}},
		},
		{
			name: "the delivered binary documented is clean",
			docs: docsWith(docRoadmap, cleanDoc(docRoadmap)+"- `cmd/migrate` y `make db-migrate`.\n"),
			want: []findingKey{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wantFindingKeys(t, checkDocs(t, tt.docs), tt.want)
		})
	}
}

// TestCheckExplanatoryDocs_InvitationsDDLIsAlwaysForbidden proves current-looking
// SQL DDL for the locked invitations non-goal is forbidden in every document,
// even next to a future/non-MVP marker, while a short future-labelled note stays
// allowed.
func TestCheckExplanatoryDocs_InvitationsDDLIsAlwaysForbidden(t *testing.T) {
	const invitationsDDL = "```sql\nCREATE TABLE invitations (\n    id UUID PRIMARY KEY\n);\n```\n"

	t.Run("the DDL blocks even under a future marker", func(t *testing.T) {
		docs := docsWith(docDataModel, cleanDoc(docDataModel)+
			"- Invitaciones (future/non-MVP).\n\n"+invitationsDDL)
		wantFindingKeys(t, checkDocs(t, docs), []findingKey{
			{"docs-invitations-ddl", docDataModel, 10},
			{"docs-model-invitations", docDataModel, 10},
		})
	})

	t.Run("the DDL is forbidden in a document that owns no invitations section", func(t *testing.T) {
		docs := docsWith(docReadme, cleanReadmeBody+invitationsDDL)
		wantFindingKeys(t, checkDocs(t, docs), []findingKey{
			{"docs-invitations-ddl", docReadme, 5},
		})
	})

	t.Run("a short future-labelled note stays allowed", func(t *testing.T) {
		docs := docsWith(docDataModel, cleanDoc(docDataModel)+
			"- Invitaciones (future/non-MVP): no existe `invitations` en el modelo entregado.\n")
		wantFindingKeys(t, checkDocs(t, docs), []findingKey{})
	})
}

// TestCheckExplanatoryDocs_FutureMarkerLocality pins the exact marker locality
// contract: the marker must label the topic in its own Markdown block (paragraph
// or list item) or anywhere in its heading-bounded section, and a sibling block
// or a sibling section is never enough.
func TestCheckExplanatoryDocs_FutureMarkerLocality(t *testing.T) {
	topic := "workers"

	tests := []struct {
		name string
		body string
		want []findingKey
	}{
		{
			name: "unlabelled paragraph blocks",
			body: cleanDoc(docArchitecture) + "\nEl módulo workers queda fuera del MVP actual.\n",
			want: []findingKey{{"docs-arch-future-topics", docArchitecture, 7}},
		},
		{
			name: "marker in the same list item is enough",
			body: cleanDoc(docArchitecture) + "- Módulo `workers` Go (future/non-MVP: fase AWS).\n",
			want: []findingKey{},
		},
		{
			name: "marker in the same fenced block is enough",
			body: cleanDoc(docArchitecture) + "```\n/workers\n(future/non-MVP)\n```\n",
			want: []findingKey{},
		},
		{
			name: "marker in a sibling list item is not enough",
			body: cleanDoc(docArchitecture) + "- Módulo `workers` Go.\n- Otra cosa (future/non-MVP).\n",
			want: []findingKey{{"docs-arch-future-topics", docArchitecture, 6}},
		},
		{
			name: "marker in the same heading-bounded section is enough",
			body: cleanDoc(docArchitecture) + "\n## 2. Árbol\n\nSección completa (future/non-MVP).\n\n" +
				"/workers vive aparte.\n",
			want: []findingKey{},
		},
		{
			name: "marker in a previous section is not enough",
			body: cleanDoc(docArchitecture) + "\n## 2. Primera (future/non-MVP)\n\n## 3. Segunda\n\n" +
				"/workers vive aparte.\n",
			want: []findingKey{{"docs-arch-future-topics", docArchitecture, 11}},
		},
		{
			name: "adjacent previous-section heading without a blank line is not enough",
			body: cleanDoc(docArchitecture) + "\n## 2. Primera (future/non-MVP)\n## 3. Segunda\n/workers vive aparte.\n",
			want: []findingKey{{"docs-arch-future-topics", docArchitecture, 9}},
		},
		{
			name: "ordered sibling item with a tab separator is not enough",
			body: cleanDoc(docArchitecture) + "1)\tMódulo `workers` Go.\n2)\tOtra cosa (future/non-MVP).\n",
			want: []findingKey{{"docs-arch-future-topics", docArchitecture, 6}},
		},
		{
			name: "ordered item labelled in its own item is enough",
			body: cleanDoc(docArchitecture) + "1.\tMódulo `workers` Go (future/non-MVP).\n",
			want: []findingKey{},
		},
		{
			name: "earlier item's blank-separated continuation does not label a later sibling",
			body: cleanDoc(docArchitecture) +
				"- Otra cosa.\n\n  Continuación (future/non-MVP).\n\n- Módulo `workers` Go.\n",
			want: []findingKey{{"docs-arch-future-topics", docArchitecture, 10}},
		},
		{
			name: "earlier item's fenced block does not label a later sibling",
			body: cleanDoc(docArchitecture) +
				"- Otra cosa.\n\n  ```\n  future/non-MVP\n  ```\n\n- Módulo `workers` Go.\n",
			want: []findingKey{{"docs-arch-future-topics", docArchitecture, 12}},
		},
		{
			name: "same item's own continuation is enough",
			body: cleanDoc(docArchitecture) +
				"- Módulo `workers` Go.\n\n  Continuación (future/non-MVP).\n",
			want: []findingKey{},
		},
		{
			name: "tab-indented continuation of an earlier item does not label a later sibling",
			body: cleanDoc(docArchitecture) +
				"- Otra cosa.\n\n\tContinuación (future/non-MVP).\n\n- Módulo `workers` Go.\n",
			want: []findingKey{{"docs-arch-future-topics", docArchitecture, 10}},
		},
		{
			name: "same item's tab-indented continuation is enough",
			body: cleanDoc(docArchitecture) +
				"- Módulo `workers` Go.\n\n\tContinuación (future/non-MVP).\n",
			want: []findingKey{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !strings.Contains(tt.body, topic) {
				t.Fatalf("fixture %q must carry the topic %q", tt.name, topic)
			}
			wantFindingKeys(t, checkDocs(t, docsWith(docArchitecture, tt.body)), tt.want)
		})
	}
}

// TestCheckExplanatoryDocs_NormativeTokensOnlyOutsideFencedCode pins the global
// literal MUST/SHALL rule: it applies to every document, respects fenced code,
// and matches whole tokens only.
func TestCheckExplanatoryDocs_NormativeTokensOnlyOutsideFencedCode(t *testing.T) {
	tests := []struct {
		name string
		path docID
		body string
		want []findingKey
	}{
		{
			name: "literal MUST outside fenced code blocks",
			path: docReadme,
			body: cleanReadmeBody + "\nEl validador MUST fallar.\n",
			want: []findingKey{{ruleNormativeToken, docReadme, 5}},
		},
		{
			name: "literal SHALL outside fenced code blocks",
			path: docRoadmap,
			body: cleanDoc(docRoadmap) + "- El reporte SHALL fallar.\n",
			want: []findingKey{{ruleNormativeToken, docRoadmap, 7}},
		},
		{
			name: "both tokens on one line produce one ordered finding each",
			path: docReadme,
			body: cleanReadmeBody + "\nMUST y SHALL juntos.\n",
			want: []findingKey{
				{ruleNormativeToken, docReadme, 5},
				{ruleNormativeToken, docReadme, 5},
			},
		},
		{
			name: "fenced code is excluded",
			path: docDataModel,
			body: cleanDoc(docDataModel) + "\n```sql\n-- MUST SHALL\n```\n",
			want: []findingKey{},
		},
		{
			name: "tokens glued into longer words are not normative",
			path: docReadme,
			body: cleanReadmeBody + "\nMUSTARD y SHALLOW.\n",
			want: []findingKey{},
		},
		{
			name: "shorter fence inside a longer fence does not close it",
			path: docReadme,
			body: docBody(
				"# PeopleFlow",
				"",
				"El modelo de datos tiene 9 tablas.",
				"",
				"````",
				"```",
				"MUST dentro",
				"````",
				"",
				"MUST fuera",
			),
			want: []findingKey{{ruleNormativeToken, docReadme, 10}},
		},
		{
			name: "mismatched fence characters do not close the block",
			path: docReadme,
			body: docBody(
				"# PeopleFlow",
				"",
				"El modelo de datos tiene 9 tablas.",
				"",
				"```",
				"~~~",
				"MUST dentro",
				"```",
				"",
				"MUST fuera",
			),
			want: []findingKey{{ruleNormativeToken, docReadme, 10}},
		},
		{
			name: "a fence line carrying an info string does not close the block",
			path: docReadme,
			body: docBody(
				"# PeopleFlow",
				"",
				"El modelo de datos tiene 9 tablas.",
				"",
				"```",
				"```sql",
				"MUST dentro",
				"```",
			),
			want: []findingKey{},
		},
		{
			name: "a longer compatible closing fence closes the block",
			path: docReadme,
			body: docBody(
				"# PeopleFlow",
				"",
				"El modelo de datos tiene 9 tablas.",
				"",
				"```",
				"MUST dentro",
				"`````",
				"",
				"MUST fuera",
			),
			want: []findingKey{{ruleNormativeToken, docReadme, 9}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wantFindingKeys(t, checkDocs(t, docsWith(tt.path, tt.body)), tt.want)
		})
	}
}

// TestCheckExplanatoryDocs_MultipleFindingsAreSortedDeterministically pins the
// cross-document ordering contract (path, rule, line, detail) and its stability
// across repeated runs.
func TestCheckExplanatoryDocs_MultipleFindingsAreSortedDeterministically(t *testing.T) {
	docs := map[docID]string{
		docReadme:       "# PeopleFlow\n\nEl modelo de datos Postgres (9 tablas).\n\nUn párrafo SHALL normativo.\n",
		docRoadmap:      cleanDoc(docRoadmap) + "- Decisión abierta: Hoy lo garantiza el FK (DB).\n",
		docArchitecture: cleanDoc(docArchitecture) + "- /companies → companies, company_members, invitations\n",
		docDataModel: cleanDoc(docDataModel) +
			"- `created_by` UUID\n\n```sql\nCREATE TABLE invitations (\n    id UUID\n);\n```\n",
	}
	want := []findingKey{
		{ruleNormativeToken, docReadme, 5},
		{"docs-readme-table-count", docReadme, 3},
		{"docs-roadmap-industry-gate", docRoadmap, 7},
		{"docs-arch-invitations", docArchitecture, 6},
		{"docs-invitations-ddl", docDataModel, 10},
		{"docs-model-invitations", docDataModel, 10},
		{"docs-model-jobs-schema", docDataModel, 7},
	}

	first := checkDocs(t, docs)
	wantFindingKeys(t, first, want)
	if second := checkDocs(t, docs); !slices.Equal(first, second) {
		t.Fatalf("validator output is not deterministic:\n first: %#v\nsecond: %#v", first, second)
	}
	for _, finding := range first {
		if !strings.Contains(finding.Detail, "\"") {
			t.Fatalf("finding detail %q must name the literal that produced it", finding.Detail)
		}
	}
}

// TestCheckExplanatoryDocs_FixedPathSetCannotBeNarrowedOrWidened proves the
// validated document set is package-owned: a missing or extra document is an
// error, never a partially clean observation.
func TestCheckExplanatoryDocs_FixedPathSetCannotBeNarrowedOrWidened(t *testing.T) {
	tests := []struct {
		name string
		docs map[docID]string
		want string
	}{
		{
			name: "missing document is a failed observation",
			docs: func() map[docID]string {
				docs := cleanDocs()
				delete(docs, docRoadmap)
				return docs
			}(),
			want: string(docRoadmap),
		},
		{
			name: "extra document is rejected",
			docs: func() map[docID]string {
				docs := cleanDocs()
				docs[docID("docs/decision-frontend-hosting.md")] = "# otro\n"
				return docs
			}(),
			want: "docs/decision-frontend-hosting.md",
		},
		{
			name: "nil document set is a failed observation",
			docs: nil,
			want: string(docReadme),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			findings, err := checkExplanatoryDocs(tt.docs)
			if err == nil {
				t.Fatalf("checkExplanatoryDocs must fail closed; got findings %#v", findings)
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error %q must name the offending path %q", err, tt.want)
			}
			if findings != nil {
				t.Fatalf("a failed observation must return no findings: %#v", findings)
			}
		})
	}
}

// TestCheckExplanatoryDocs_EveryRuleTableEntryIsLive proves no rule is inert: a
// stale, forbidden, or topic literal always fires its own rule, and a missing
// canonical marker always fires its own rule.
func TestCheckExplanatoryDocs_EveryRuleTableEntryIsLive(t *testing.T) {
	for _, rule := range docRules {
		t.Run(rule.ID, func(t *testing.T) {
			for _, path := range rulePaths(rule) {
				docs := cleanDocs()
				switch {
				case len(rule.Stale) > 0:
					body := docs[path]
					for _, literal := range rule.Stale {
						body += "- " + literal + "\n"
					}
					docs[path] = body
				case len(rule.Canonical) > 0:
					body := docs[path]
					for _, marker := range rule.Canonical {
						body = strings.Replace(body, marker, "", 1)
					}
					docs[path] = body
				default:
					body := docs[path]
					for _, topic := range rule.Topics {
						body += "- " + topic + "\n"
					}
					docs[path] = body
				}
				wantRuleFire(t, checkDocs(t, docs), rule.ID)
			}
		})
	}
}

// wantRuleInventory is the C12V-a rule inventory pinned independently of
// docRules: the exact stable rule IDs the accepted drift contract requires
// (25 document rules plus the global literal MUST/SHALL rule), sorted. Because it
// is authored from the contract rather than read from the table, a rule that is
// silently dropped, renamed, or added fails this guard even though a test that
// merely iterates docRules would still pass.
var wantRuleInventory = []string{
	"docs-arch-audit-ownership",
	"docs-arch-context-count",
	"docs-arch-future-topics",
	"docs-arch-import-exceptions",
	"docs-arch-invitations",
	"docs-arch-lint",
	"docs-arch-table-count",
	"docs-invitations-ddl",
	"docs-model-audit-vocabulary",
	"docs-model-cv-lifecycle",
	"docs-model-eventing",
	"docs-model-invitations",
	"docs-model-jobs-schema",
	"docs-model-migration-tool",
	"docs-model-rds",
	"docs-model-recruiter-search",
	"docs-model-table-count",
	"docs-normative-token",
	"docs-readme-aws-phase-topics",
	"docs-readme-table-count",
	"docs-roadmap-auth-mode",
	"docs-roadmap-healthz-db",
	"docs-roadmap-industry-gate",
	"docs-roadmap-languages-route",
	"docs-roadmap-migrate-marker",
	"docs-roadmap-migration-version",
	"docs-roadmap-postconfirmation",
}

// TestCheckExplanatoryDocs_RequiredRuleInventoryIsExact pins the required rule
// inventory by stable ID and count against the independently authored list, so
// coverage cannot shrink by editing docRules alone.
func TestCheckExplanatoryDocs_RequiredRuleInventoryIsExact(t *testing.T) {
	if !slices.IsSorted(wantRuleInventory) {
		t.Fatal("the pinned rule inventory must be sorted for an exact comparison")
	}
	got := make([]string, 0, len(docRules)+1)
	for _, rule := range docRules {
		got = append(got, rule.ID)
	}
	got = append(got, ruleNormativeToken)
	slices.Sort(got)

	if len(got) != len(wantRuleInventory) {
		t.Fatalf("rule inventory has %d rules %v, want the %d independently pinned rules %v",
			len(got), got, len(wantRuleInventory), wantRuleInventory)
	}
	if !slices.Equal(got, wantRuleInventory) {
		t.Fatalf("rule inventory = %v, want the pinned inventory %v", got, wantRuleInventory)
	}
	if len(slices.Compact(slices.Clone(got))) != len(got) {
		t.Fatalf("rule inventory carries duplicate IDs: %v", got)
	}
}

// TestCheckExplanatoryDocs_AtxHeadingsAllowUpToThreeLeadingSpaces pins CommonMark
// ATX recognition: a heading indented by up to three spaces still starts a new
// section, so an earlier section's marker stops labelling it, while four spaces is
// indented code and starts no section at all.
func TestCheckExplanatoryDocs_AtxHeadingsAllowUpToThreeLeadingSpaces(t *testing.T) {
	tests := []struct {
		name   string
		indent string
		want   []findingKey
	}{
		{name: "one leading space starts a new section", indent: " ",
			want: []findingKey{{"docs-arch-future-topics", docArchitecture, 9}}},
		{name: "two leading spaces start a new section", indent: "  ",
			want: []findingKey{{"docs-arch-future-topics", docArchitecture, 9}}},
		{name: "three leading spaces start a new section", indent: "   ",
			want: []findingKey{{"docs-arch-future-topics", docArchitecture, 9}}},
		{name: "four leading spaces are indented code, not a heading", indent: "    ",
			want: []findingKey{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body := cleanDoc(docArchitecture) + "\n## 2. Primera (future/non-MVP)\n" +
				tt.indent + "## 3. Segunda\n/workers vive aparte.\n"
			wantFindingKeys(t, checkDocs(t, docsWith(docArchitecture, body)), tt.want)
		})
	}
}

// TestCheckExplanatoryDocs_FenceOpenerIndentation pins the fenced-code opener
// indentation rule: up to three leading spaces may open a fence (which then
// encloses what follows), while four spaces is indented code and opens no fence,
// so a later outside normative token is still observed.
func TestCheckExplanatoryDocs_FenceOpenerIndentation(t *testing.T) {
	tests := []struct {
		name   string
		indent string
		want   []findingKey
	}{
		{name: "no leading space opens a fence", indent: "", want: []findingKey{}},
		{name: "one leading space opens a fence", indent: " ", want: []findingKey{}},
		{name: "two leading spaces open a fence", indent: "  ", want: []findingKey{}},
		{name: "three leading spaces open a fence", indent: "   ", want: []findingKey{}},
		{name: "four leading spaces open no fence", indent: "    ",
			want: []findingKey{{ruleNormativeToken, docReadme, 8}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body := docBody(
				"# PeopleFlow",
				"",
				"El modelo de datos tiene 9 tablas.",
				"",
				tt.indent+"```",
				tt.indent+"código",
				"",
				"MUST fuera",
			)
			wantFindingKeys(t, checkDocs(t, docsWith(docReadme, body)), tt.want)
		})
	}
}

// TestCheckExplanatoryDocs_FenceInfoStrings pins the opening-fence info-string
// rule: a backtick fence whose info string carries a backtick is not an opener at
// all, so the normative tokens after it stay prose and the later outside one is
// still observed, while a tilde fence accepts the same info string.
func TestCheckExplanatoryDocs_FenceInfoStrings(t *testing.T) {
	tests := []struct {
		name string
		open string
		want []findingKey
	}{
		{name: "a backtick info string opens a fence", open: "```sql", want: []findingKey{}},
		{name: "a tilde info string may carry a backtick", open: "~~~sql`x", want: []findingKey{}},
		{name: "a backtick inside a backtick info string invalidates the opener", open: "```sql`x",
			want: []findingKey{{ruleNormativeToken, docReadme, 6}, {ruleNormativeToken, docReadme, 8}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body := docBody(
				"# PeopleFlow",
				"",
				"El modelo de datos tiene 9 tablas.",
				"",
				tt.open,
				"MUST dentro",
				"",
				"MUST fuera",
			)
			wantFindingKeys(t, checkDocs(t, docsWith(docReadme, body)), tt.want)
		})
	}
}

// TestCheckExplanatoryDocs_ListPaddingOwnership pins list-item content-column
// semantics: the padding after a marker (several spaces, or a tab advancing to the
// next tab stop) sets where the item's content column starts, so a shallower
// continuation marker belongs to no item and never labels it, while a continuation
// indented to the item's content column does.
func TestCheckExplanatoryDocs_ListPaddingOwnership(t *testing.T) {
	tests := []struct {
		name string
		body string
		want []findingKey
	}{
		{
			name: "three spaces of padding make a two-space continuation a different block",
			body: cleanDoc(docArchitecture) +
				"-   Módulo `workers` Go.\n  continuado (future/non-MVP).\n",
			want: []findingKey{{"docs-arch-future-topics", docArchitecture, 6}},
		},
		{
			name: "a continuation at the item's content column still labels it",
			body: cleanDoc(docArchitecture) +
				"-   Módulo `workers` Go.\n    continuado (future/non-MVP).\n",
			want: []findingKey{},
		},
		{
			name: "tab padding makes a two-space continuation a different block",
			body: cleanDoc(docArchitecture) +
				"-\tMódulo `workers` Go.\n  continuado (future/non-MVP).\n",
			want: []findingKey{{"docs-arch-future-topics", docArchitecture, 6}},
		},
		{
			name: "ordered marker padding behaves the same",
			body: cleanDoc(docArchitecture) +
				"1.   Módulo `workers` Go.\n   continuado (future/non-MVP).\n",
			want: []findingKey{{"docs-arch-future-topics", docArchitecture, 6}},
		},
		{
			name: "a continuation at the ordered item's content column still labels it",
			body: cleanDoc(docArchitecture) +
				"1.   Módulo `workers` Go.\n     continuado (future/non-MVP).\n",
			want: []findingKey{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wantFindingKeys(t, checkDocs(t, docsWith(docArchitecture, tt.body)), tt.want)
		})
	}
}
