// C12V: the package-owned explanatory-docs validator behind proposal §9
// criterion 12 (Task 8.1 / A2).
//
// The validator is pure: it reads no file, accepts no caller-supplied path, and
// knows nothing beyond the four fixed Task 8.1 documents and the enumerated
// literal rules below. It is deliberately NOT a general semantic checker — every
// rule is a literal locality rule over the approved current drift, so nothing
// here claims to understand prose.
//
// Correcting the documents is mechanical: each rule names the exact literals to
// remove (Stale/Topics) and the exact literals the delivered fact must then be
// described with (Canonical), so deleting a stale claim is never enough by
// itself, and every finding detail names the offending literal.
package closurereport

import (
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"
)

// docID is one fixed explanatory document: the repository-relative path that
// also identifies it in a finding.
type docID string

// The four Task 8.1 documents. This set is package-owned and fixed: no caller
// can supply, narrow, or widen it.
const (
	docReadme       docID = "README.md"
	docRoadmap      docID = "docs/ROADMAP.md"
	docArchitecture docID = "docs/arquitectura-backend-proyecto-04.md"
	docDataModel    docID = "docs/modelo-de-datos-proyecto-04.md"
	// docAll marks a rule that applies to every fixed document.
	docAll docID = ""
)

// explanatoryDocPaths is the fixed document set, in deterministic order.
var explanatoryDocPaths = []docID{docReadme, docRoadmap, docArchitecture, docDataModel}

// futureMarker is the exact marker proposal §7/A2 requires on retained locked
// non-goal material.
const futureMarker = "future/non-MVP"

// ruleNormativeToken is the rule ID of the global literal MUST/SHALL check.
const ruleNormativeToken = "docs-normative-token"

// normativeTokens are the literal normative tokens explanatory docs must not
// carry outside fenced code.
var normativeTokens = []string{"MUST", "SHALL"}

// normativeTokenPattern matches a standalone normative token: a token glued into
// a longer word (for example `MUSTARD`) is not normative language.
var normativeTokenPattern = regexp.MustCompile(`\b(?:MUST|SHALL)\b`)

// DocFinding is one deterministic explanatory-docs drift finding. Line is the
// 1-based line the finding anchors to: the line carrying a stale, forbidden, or
// unlabelled token, or line 1 for a document-scoped absent canonical marker.
type DocFinding struct {
	Rule   string
	Path   string
	Line   int
	Detail string
}

// docRuleKind is how one rule evaluates its literals.
type docRuleKind int

const (
	// ruleStaleClaim: every Stale occurrence is a finding, and every Canonical
	// marker must be present: a delivered fact still described by the document
	// needs its canonical replacement, not only the stale phrase's absence.
	ruleStaleClaim docRuleKind = iota
	// ruleRequiredMarker: every Canonical marker must be present — a delivered
	// fact the document omits entirely.
	ruleRequiredMarker
	// ruleForbiddenLiteral: every Stale occurrence is always a finding, even when
	// a future/non-MVP marker sits next to it.
	ruleForbiddenLiteral
	// ruleFutureTopic: a locked non-goal topic may stay only when the exact
	// future/non-MVP marker labels it in the same Markdown block or section.
	ruleFutureTopic
)

// docRule is one package-owned explanatory-docs rule. Path is the single fixed
// document the rule applies to, or docAll for every document.
type docRule struct {
	ID        string
	Path      docID
	Kind      docRuleKind
	Stale     []string
	Canonical []string
	Topics    []string
}

// docRules is the approved current drift, as literal locality rules. Counts are
// the delivered ones: 9 tables (8 entity tables plus the `industries` reference
// catalog) and 7 feature directories.
var docRules = []docRule{
	{ID: "docs-roadmap-migration-version", Path: docRoadmap, Kind: ruleStaleClaim,
		Stale: []string{"versión 8"}, Canonical: []string{"00011"}},
	{ID: "docs-roadmap-languages-route", Path: docRoadmap, Kind: ruleStaleClaim,
		Stale: []string{"/me/languages"}, Canonical: []string{"/me/profile/languages"}},
	{ID: "docs-roadmap-healthz-db", Path: docRoadmap, Kind: ruleStaleClaim,
		Stale: []string{"(pinguea DB)"}, Canonical: []string{"/readyz"}},
	{ID: "docs-roadmap-auth-mode", Path: docRoadmap, Kind: ruleStaleClaim,
		Stale: []string{"WithPEM"}, Canonical: []string{"JWKS"}},
	{ID: "docs-roadmap-industry-gate", Path: docRoadmap, Kind: ruleStaleClaim,
		Stale: []string{"Hoy lo garantiza el FK"}, Canonical: []string{"industry_unavailable"}},
	{ID: "docs-roadmap-postconfirmation", Path: docRoadmap, Kind: ruleStaleClaim,
		Stale: []string{"Lambda PostConfirmation"}, Canonical: []string{"cmd/postconfirmation"}},
	{ID: "docs-roadmap-migrate-marker", Path: docRoadmap, Kind: ruleRequiredMarker,
		Canonical: []string{"cmd/migrate"}},
	{ID: "docs-readme-table-count", Path: docReadme, Kind: ruleStaleClaim,
		Stale: []string{"Postgres (9 tablas)"}, Canonical: []string{"9 tablas"}},
	{ID: "docs-readme-aws-phase-topics", Path: docReadme, Kind: ruleFutureTopic,
		Topics: []string{"AWS", "RDS", "ECS", "EventBridge", "SQS", "Terraform", "workers"}},
	{ID: "docs-arch-table-count", Path: docArchitecture, Kind: ruleStaleClaim,
		Stale: []string{"Postgres (9 tablas)"}, Canonical: []string{"9 tablas"}},
	{ID: "docs-arch-context-count", Path: docArchitecture, Kind: ruleStaleClaim,
		Stale: []string{"5 contexts cubren las 9 tablas"}, Canonical: []string{"7 features"}},
	{ID: "docs-arch-invitations", Path: docArchitecture, Kind: ruleFutureTopic,
		Topics: []string{"invitations"}},
	{ID: "docs-arch-future-topics", Path: docArchitecture, Kind: ruleFutureTopic,
		Topics: []string{"workers", "Terraform", "EventBridge", "SQS", "outbox"}},
	{ID: "docs-arch-lint", Path: docArchitecture, Kind: ruleStaleClaim,
		Stale: []string{"go-arch-lint"}, Canonical: []string{"archguard"}},
	{ID: "docs-arch-audit-ownership", Path: docArchitecture, Kind: ruleStaleClaim,
		Stale: []string{"Definir dónde vive"}, Canonical: []string{"features/audit_events"}},
	{ID: "docs-arch-import-exceptions", Path: docArchitecture, Kind: ruleStaleClaim,
		Stale: []string{"Una feature **NUNCA** importa"}, Canonical: []string{"audit_events/domain"}},
	{ID: "docs-model-rds", Path: docDataModel, Kind: ruleFutureTopic,
		Topics: []string{"RDS"}},
	{ID: "docs-model-table-count", Path: docDataModel, Kind: ruleStaleClaim,
		Stale: []string{"9 de entidad + el catálogo"}, Canonical: []string{"9 tablas"}},
	{ID: "docs-model-invitations", Path: docDataModel, Kind: ruleFutureTopic,
		Topics: []string{"invitations"}},
	{ID: "docs-model-jobs-schema", Path: docDataModel, Kind: ruleStaleClaim,
		Stale: []string{"created_by", "jobs_seniority_idx"}, Canonical: []string{"jobs_company_id_idx"}},
	{ID: "docs-model-recruiter-search", Path: docDataModel, Kind: ruleFutureTopic,
		Topics: []string{"Reclutador busca candidatos", "reclutadores buscan candidatos", "búsquedas de reclutadores"}},
	{ID: "docs-model-cv-lifecycle", Path: docDataModel, Kind: ruleFutureTopic,
		Topics: []string{"S3", "anonimiz"}},
	{ID: "docs-model-migration-tool", Path: docDataModel, Kind: ruleStaleClaim,
		Stale: []string{"Elegir herramienta de migraciones"}, Canonical: []string{"cmd/migrate"}},
	{ID: "docs-model-audit-vocabulary", Path: docDataModel, Kind: ruleStaleClaim,
		Stale: []string{"InvitationSent"}, Canonical: []string{"CompanyUpdated"}},
	{ID: "docs-model-eventing", Path: docDataModel, Kind: ruleFutureTopic,
		Topics: []string{"EventBridge"}},
	{ID: "docs-invitations-ddl", Path: docAll, Kind: ruleForbiddenLiteral,
		Stale: []string{"CREATE TABLE invitations"}},
}

// rulePaths returns the fixed documents one rule applies to, in deterministic
// order.
func rulePaths(rule docRule) []docID {
	if rule.Path != docAll {
		return []docID{rule.Path}
	}
	return explanatoryDocPaths
}

// checkExplanatoryDocs validates the four fixed explanatory documents and
// returns their findings sorted by path, rule, line, and detail. docs must carry
// exactly the four fixed paths: a missing document is a failed observation, not
// a clean one, and an extra path is rejected, so the validated set can never be
// narrowed or widened by a caller. A clean document set yields an intentional
// non-nil empty slice.
func checkExplanatoryDocs(docs map[docID]string) ([]DocFinding, error) {
	if err := checkFixedDocSet(docs); err != nil {
		return nil, err
	}
	findings := []DocFinding{}
	for _, path := range explanatoryDocPaths {
		findings = append(findings, checkFixedDoc(path, docs[path])...)
	}
	sortDocFindings(findings)
	return findings, nil
}

// checkFixedDocSet rejects a document set that is not exactly the four fixed
// documents: a missing document is a failed observation, and an extra one is an
// attempt to widen the validated set.
func checkFixedDocSet(docs map[docID]string) error {
	for _, path := range explanatoryDocPaths {
		if _, ok := docs[path]; !ok {
			return fmt.Errorf("closurereport: explanatory document %s was not observed", path)
		}
	}
	for path := range docs {
		if !slices.Contains(explanatoryDocPaths, path) {
			return fmt.Errorf("closurereport: %s is outside the fixed explanatory document set", path)
		}
	}
	return nil
}

// checkFixedDoc evaluates every rule that applies to one fixed document plus the
// global literal MUST/SHALL rule. It is pure: the document body is the only
// input, and no other document, path, or caller state is consulted.
func checkFixedDoc(path docID, body string) []DocFinding {
	layout := newMarkdownLayout(body)
	findings := normativeFindings(path, layout)
	for _, rule := range docRules {
		if rule.Path != docAll && rule.Path != path {
			continue
		}
		findings = append(findings, rule.findings(path, layout)...)
	}
	return findings
}

// findings reports the explanatory-docs drift one rule observes in one document.
func (r docRule) findings(path docID, layout markdownLayout) []DocFinding {
	findings := []DocFinding{}
	switch r.Kind {
	case ruleStaleClaim:
		findings = append(findings, r.literalFindings(path, layout, "stale literal %q remains")...)
		findings = append(findings, r.missingMarkerFindings(path, layout)...)
	case ruleForbiddenLiteral:
		findings = append(findings, r.literalFindings(path, layout, "forbidden literal %q")...)
	case ruleRequiredMarker:
		findings = append(findings, r.missingMarkerFindings(path, layout)...)
	case ruleFutureTopic:
		findings = append(findings, r.topicFindings(path, layout)...)
	}
	return findings
}

// literalFindings reports one finding per line carrying one of the rule's
// literals. A literal repeated on one line is one finding, and the same literal
// on two lines is two findings, so the report names every offending line once.
func (r docRule) literalFindings(path docID, layout markdownLayout, format string) []DocFinding {
	findings := []DocFinding{}
	for _, literal := range r.Stale {
		for index, line := range layout.lines {
			if strings.Contains(line, literal) {
				findings = append(findings, DocFinding{
					Rule:   r.ID,
					Path:   string(path),
					Line:   index + 1,
					Detail: fmt.Sprintf(format, literal),
				})
			}
		}
	}
	return findings
}

// missingMarkerFindings reports one document-scoped finding per canonical marker
// the document does not carry: a delivered fact the document still describes is
// not corrected by deleting the stale claim alone, so the canonical replacement
// is required too. The finding anchors to line 1 because an absent marker has no
// line of its own.
func (r docRule) missingMarkerFindings(path docID, layout markdownLayout) []DocFinding {
	findings := []DocFinding{}
	for _, marker := range r.Canonical {
		if slices.ContainsFunc(layout.lines, func(line string) bool { return strings.Contains(line, marker) }) {
			continue
		}
		findings = append(findings, DocFinding{
			Rule:   r.ID,
			Path:   string(path),
			Line:   1,
			Detail: fmt.Sprintf("canonical marker %q is absent", marker),
		})
	}
	return findings
}

// topicFindings reports one finding per locked non-goal topic occurrence that the
// exact future/non-MVP marker does not label.
func (r docRule) topicFindings(path docID, layout markdownLayout) []DocFinding {
	findings := []DocFinding{}
	for _, topic := range r.Topics {
		for index, line := range layout.lines {
			if !strings.Contains(line, topic) || layout.labelsTopic(index) {
				continue
			}
			findings = append(findings, DocFinding{
				Rule:   r.ID,
				Path:   string(path),
				Line:   index + 1,
				Detail: fmt.Sprintf("locked non-goal topic %q has no %q marker in its Markdown block", topic, futureMarker),
			})
		}
	}
	return findings
}

// normativeFindings reports the global literal MUST/SHALL rule for one document:
// every normative token outside fenced code blocks, in token order.
func normativeFindings(path docID, layout markdownLayout) []DocFinding {
	findings := []DocFinding{}
	for index, line := range layout.lines {
		if layout.fenced[index] {
			continue
		}
		for _, token := range normativeTokens {
			if !slices.Contains(normativeTokenPattern.FindAllString(line, -1), token) {
				continue
			}
			findings = append(findings, DocFinding{
				Rule:   ruleNormativeToken,
				Path:   string(path),
				Line:   index + 1,
				Detail: fmt.Sprintf("normative literal %q outside fenced code", token),
			})
		}
	}
	return findings
}

// sortDocFindings orders findings by path, rule, line, and detail so the report
// is deterministic for identical documents.
func sortDocFindings(findings []DocFinding) {
	sort.Slice(findings, func(i, j int) bool {
		left, right := findings[i], findings[j]
		if left.Path != right.Path {
			return left.Path < right.Path
		}
		if left.Rule != right.Rule {
			return left.Rule < right.Rule
		}
		if left.Line != right.Line {
			return left.Line < right.Line
		}
		return left.Detail < right.Detail
	})
}

// markdownLayout is the parsed Markdown structure one document is evaluated
// against: its lines, fenced-code flags, block spans, heading-bounded section
// spans, and list-item ownership.
type markdownLayout struct {
	lines    []string
	fenced   []bool
	blocks   [][2]int
	sections [][2]int
	owners   []int
}

// newMarkdownLayout parses one document body into its Markdown layout.
func newMarkdownLayout(body string) markdownLayout {
	lines := docLines(body)
	fenced := fencedLines(lines)
	return markdownLayout{
		lines:    lines,
		fenced:   fenced,
		blocks:   markdownBlocks(lines, fenced),
		sections: markdownSections(lines, fenced),
		owners:   markdownItemOwners(lines),
	}
}

// labelsTopic reports whether the exact future/non-MVP marker labels the topic on
// one line: in the topic's own Markdown block, or elsewhere in the same
// heading-bounded section under the same list-item ownership. A marker that
// belongs to another list item therefore never labels this line, whether it sits
// in the sibling item, in that item's blank-separated continuation block, or in a
// fenced block nested inside it.
func (l markdownLayout) labelsTopic(index int) bool {
	if l.spanLabelsTopic(l.blocks[index], index) {
		return true
	}
	return l.spanLabelsTopic(l.sections[index], index)
}

// spanLabelsTopic reports whether one line span carries the exact marker on a
// line owned by the same list item as the topic line (no list item owns either
// line when neither is inside a list).
func (l markdownLayout) spanLabelsTopic(span [2]int, index int) bool {
	for i := span[0]; i < span[1] && i < len(l.lines); i++ {
		if strings.Contains(l.lines[i], futureMarker) && l.owners[i] == l.owners[index] {
			return true
		}
	}
	return false
}

// docLines splits one document into lines; index i is 1-based line i+1.
func docLines(body string) []string { return strings.Split(body, "\n") }

// fenceMarker returns the fence character and run length of one fence delimiter
// line, plus whether the line is a delimiter at all. A fence opener may be
// indented by at most three columns, since four or more is an indented code block,
// and a backtick fence's info string may not contain a backtick, so a line such as
// ```sql`x opens no fence at all.
func fenceMarker(line string) (byte, int, bool) {
	offset, column := lineIndent(line)
	if column > 3 {
		return 0, 0, false
	}
	rest := line[offset:]
	if len(rest) < 3 {
		return 0, 0, false
	}
	char := rest[0]
	if char != '`' && char != '~' {
		return 0, 0, false
	}
	run := 0
	for run < len(rest) && rest[run] == char {
		run++
	}
	if run < 3 || (char == '`' && strings.Contains(rest[run:], "`")) {
		return 0, 0, false
	}
	return char, run, true
}

// fenceCloses reports whether one fence delimiter line closes a fence opened with
// the same character and at least the opener's run length. A closer carries
// nothing after its run but spaces or tabs, so an opening fence with an info
// string (````sql`) never closes a block.
func fenceCloses(line string, openChar byte, openRun int) bool {
	char, run, ok := fenceMarker(line)
	if !ok || char != openChar || run < openRun {
		return false
	}
	return strings.TrimLeft(line[lineIndentOffset(line)+run:], " \t") == ""
}

// lineIndentOffset returns the byte offset at which one line's content starts.
func lineIndentOffset(line string) int {
	offset, _ := lineIndent(line)
	return offset
}

// fencedLines reports whether each line belongs to a fenced code block, including
// the fence delimiter lines. Opener character and run length are tracked, so a
// mismatched fence character and a shorter run inside a longer fence neither
// toggle nor close the block.
func fencedLines(lines []string) []bool {
	flags := make([]bool, len(lines))
	var openChar byte
	openRun := 0
	for index, line := range lines {
		if openRun == 0 {
			if char, run, ok := fenceMarker(line); ok {
				flags[index] = true
				openChar, openRun = char, run
			}
			continue
		}
		flags[index] = true
		if fenceCloses(line, openChar, openRun) {
			openChar, openRun = 0, 0
		}
	}
	return flags
}

// markdownBlocks returns the [start,end) line range of the Markdown block that
// contains each line: a fenced code block, one heading line with the lines it
// bounds, one list item with its continuation lines, or a paragraph. A heading
// always starts a new block, so adjacent headings with no blank line between them
// can never merge two sections into one block.
func markdownBlocks(lines []string, fenced []bool) [][2]int {
	ranges := make([][2]int, len(lines))
	start := -1
	flush := func(end int) {
		if start < 0 {
			return
		}
		for i := start; i < end && i < len(lines); i++ {
			ranges[i] = [2]int{start, end}
		}
		start = -1
	}
	for index, line := range lines {
		if isBlank(line) && !fenced[index] {
			flush(index)
			continue
		}
		if start < 0 {
			start = index
			continue
		}
		if fenced[index] != fenced[index-1] || (!fenced[index] && startsNewMarkdownBlock(line)) {
			flush(index)
			start = index
		}
	}
	flush(len(lines))
	return ranges
}

// startsNewMarkdownBlock reports whether one line begins a new semantic Markdown
// block inside a paragraph run: a list item or an ATX heading.
func startsNewMarkdownBlock(line string) bool {
	if _, ok := headingLevel(line); ok {
		return true
	}
	return startsListItem(line)
}

// markdownSections returns the [start,end) heading-bounded section of each line:
// the nearest preceding heading up to the next heading of the same or shallower
// level, so a marker inside a nested subsection also labels its parent section by
// design. Headings inside fenced code are not headings.
func markdownSections(lines []string, fenced []bool) [][2]int {
	type heading struct{ line, level int }
	headings := []heading{}
	for index, line := range lines {
		if fenced[index] {
			continue
		}
		if level, ok := headingLevel(line); ok {
			headings = append(headings, heading{index, level})
		}
	}
	ranges := make([][2]int, len(lines))
	for index, current := range headings {
		end := len(lines)
		for _, next := range headings[index+1:] {
			if next.level <= current.level {
				end = next.line
				break
			}
		}
		for i := current.line; i < end; i++ {
			ranges[i] = [2]int{current.line, end}
		}
	}
	return ranges
}

// markdownItemOwners returns the index of the list item that owns each line, or
// -1 when no list item does. An item owns its marker line, its continuation lines
// (lazy, indented, blank-separated, or fenced) while they start at or past the
// item's content column, and nothing after a line that starts a block outside the
// item. Ownership is what keeps a marker in one item — or in that item's
// continuation block or nested fence — from labelling a sibling item.
func markdownItemOwners(lines []string) []int {
	owners := make([]int, len(lines))
	current := -1
	content := 0
	for index, line := range lines {
		owners[index] = -1
		if isBlank(line) {
			continue
		}
		if startsListItem(line) {
			current = index
			content = listItemContentColumn(line)
			owners[index] = current
			continue
		}
		if _, column := lineIndent(line); current >= 0 && column >= content {
			owners[index] = current
			continue
		}
		current = -1
	}
	return owners
}

// headingLevel returns the ATX heading level of one line. A heading may be
// indented by at most three spaces; four or more spaces is an indented code block,
// not a heading.
func headingLevel(line string) (int, bool) {
	indent := 0
	for indent < len(line) && line[indent] == ' ' {
		indent++
	}
	if indent > 3 {
		return 0, false
	}
	level := 0
	for indent+level < len(line) && line[indent+level] == '#' {
		level++
	}
	if level == 0 || level > 6 {
		return 0, false
	}
	if index := indent + level; index == len(line) || line[index] == ' ' || line[index] == '\t' {
		return level, true
	}
	return 0, false
}

// lineIndent returns the byte offset at which one line's content starts and the
// column it starts at, expanding each tab to the next four-column tab stop, so a
// tab-indented continuation is still recognized as indented past its item's
// content column.
func lineIndent(line string) (int, int) {
	offset, column := 0, 0
	for offset < len(line) {
		switch line[offset] {
		case ' ':
			column++
		case '\t':
			column += 4 - column%4
		default:
			return offset, column
		}
		offset++
	}
	return offset, column
}

// listItemContentColumn returns the column where a list item's content starts, or
// 0 when the line does not begin a list item.
func listItemContentColumn(line string) int {
	offset, column := lineIndent(line)
	return column + listItemMarkerLen(line[offset:], column)
}

// listItemMarkerLen returns the width of one list item's marker plus the padding
// that separates it from the item's content, and 0 when the line does not begin a
// list item. startColumn is the column at which the marker begins, so a tab in the
// padding advances to the next four-column tab stop. One to four columns of
// padding set the content column; more than four — like an empty item — leaves it
// at marker+1, which is CommonMark's indented-content rule.
func listItemMarkerLen(rest string, startColumn int) int {
	marker := listMarkerWidth(rest)
	if marker == 0 {
		return 0
	}
	after := rest[marker:]
	padding := 0
	consumed := 0
	for consumed < len(after) && (after[consumed] == ' ' || after[consumed] == '\t') {
		if after[consumed] == ' ' {
			padding++
		} else {
			padding += 4 - (startColumn+marker+padding)%4
		}
		consumed++
	}
	switch {
	case after == "":
		// An empty item still starts its content one column past the marker.
		return marker + 1
	case padding == 0:
		// No separator: the marker is glued to its text, so this is not a list item.
		return 0
	case padding > 4:
		return marker + 1
	default:
		return marker + padding
	}
}

// listMarkerWidth returns the width of one list item marker prefix, and 0 when the
// line does not begin with an unordered (`-`, `*`, `+`) or ordered (`1.`, `1)`)
// marker. An ordered marker takes at most nine digits, and a marker character
// repeated without a separator (for example a `---` thematic break) never counts.
func listMarkerWidth(rest string) int {
	switch {
	case strings.HasPrefix(rest, "-"), strings.HasPrefix(rest, "*"), strings.HasPrefix(rest, "+"):
		return 1
	}
	digits := 0
	for digits < len(rest) && digits < 9 && rest[digits] >= '0' && rest[digits] <= '9' {
		digits++
	}
	if digits == 0 || digits >= len(rest) || (rest[digits] != '.' && rest[digits] != ')') {
		return 0
	}
	return digits + 1
}

// startsListItem reports whether one line begins a Markdown list item. Unordered
// markers (`-`, `*`, `+`) and ordered markers (`1.`, `1)`) are recognized, and a
// tab may separate the marker from its content.
func startsListItem(line string) bool {
	offset, column := lineIndent(line)
	return listItemMarkerLen(line[offset:], column) > 0
}

// isBlank reports whether one line carries only whitespace.
func isBlank(line string) bool { return strings.TrimSpace(line) == "" }
