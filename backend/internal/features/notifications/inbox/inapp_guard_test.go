package inbox

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// notifications-v2 D6 / §In-app off: a hidden row (notifications.in_app =
// false) must never be listed, counted, faceted or marked, so every scope
// filter of db/queries/notifications.sql (`<alias>.recipient_kind = …`) is
// paired with `AND <alias>.in_app` for the same alias in the same query scope
// (the innermost enclosing parentheses: a CTE, subquery or LATERAL body), so
// each occurrence needs its own predicate. Line and block comments are
// stripped first. A future query that forgets it fails here.
const notificationQueriesPath = "../../../../db/queries/notifications.sql"

// inAppExempt lists statements that read the caller scope on purpose without
// the in_app predicate (the contract allows "the sender's explicit
// exception"). Empty until the sender ships (E6).
var inAppExempt = map[string]bool{}

var (
	sqlNameRe       = regexp.MustCompile(`(?m)^-- name: (\w+)`)
	scopeRe         = regexp.MustCompile(`(?:(\w+)\.)?recipient_kind\s*=`)
	lineCommentRe   = regexp.MustCompile(`--[^\n]*`)
	blockCommentRe  = regexp.MustCompile(`(?s)/\*.*?\*/`)
	inAppPredicateF = `(?i)\bAND\s+%s\.in_app\b`
	equalsTrueRe    = regexp.MustCompile(`(?i)^\s*=\s*true\b`)
	equalsRe        = regexp.MustCompile(`(?i)^\s*(=|<>|!=|IS\b)`)
)

// hasInApp reports whether body filters `AND <alias>.in_app` (optionally
// `= true`) inside the query scope that starts at the opening parenthesis
// scope (-1 = the statement's top level); any other comparison, or a
// predicate of an enclosing or nested scope, does not count.
func hasInApp(body string, regions []int, scope int, alias string) bool {
	re := regexp.MustCompile(strings.Replace(inAppPredicateF, "%s", regexp.QuoteMeta(alias), 1))
	for _, loc := range re.FindAllStringIndex(body, -1) {
		if regions[loc[0]] != scope {
			continue
		}
		rest := body[loc[1]:]
		if !equalsRe.MatchString(rest) || equalsTrueRe.MatchString(rest) {
			return true
		}
	}
	return false
}

// scopeRegions maps every byte of body to the index of the opening
// parenthesis of its innermost enclosing parentheses (-1 at the top level);
// parentheses inside single-quoted literals are ignored.
func scopeRegions(body string) []int {
	regions := make([]int, len(body))
	var stack []int
	inLiteral := false
	for i := 0; i < len(body); i++ {
		c := body[i]
		switch {
		case inLiteral:
			if c == '\'' {
				inLiteral = false
			}
		case c == '\'':
			inLiteral = true
		case c == '(':
			stack = append(stack, i)
		case c == ')' && len(stack) > 0:
			stack = stack[:len(stack)-1]
		}
		regions[i] = -1
		if len(stack) > 0 {
			regions[i] = stack[len(stack)-1]
		}
	}
	return regions
}

// splitStatements maps each `-- name:` statement to its SQL without comments.
func splitStatements(src string) map[string]string {
	out := map[string]string{}
	locs := sqlNameRe.FindAllStringSubmatchIndex(src, -1)
	for i, loc := range locs {
		end := len(src)
		if i+1 < len(locs) {
			end = locs[i+1][0]
		}
		name := src[loc[2]:loc[3]]
		out[name] = lineCommentRe.ReplaceAllString(blockCommentRe.ReplaceAllString(src[loc[1]:end], ""), "")
	}
	return out
}

// scopedWithoutInApp returns "<statement>: <reason>" for every scope filter
// not paired with `AND <alias>.in_app`, and the names of the scoped statements.
func scopedWithoutInApp(src string) (violations, scoped []string) {
	stmts := splitStatements(src)
	names := make([]string, 0, len(stmts))
	for name := range stmts {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		body := stmts[name]
		matches := scopeRe.FindAllStringSubmatchIndex(body, -1)
		if len(matches) == 0 {
			continue
		}
		scoped = append(scoped, name)
		if inAppExempt[name] {
			continue
		}
		regions := scopeRegions(body)
		for _, m := range matches {
			if m[2] < 0 {
				violations = append(violations, name+": unqualified recipient_kind filter")
				continue
			}
			alias := body[m[2]:m[3]]
			if !hasInApp(body, regions, regions[m[0]], alias) {
				violations = append(violations, fmt.Sprintf("%s: %s.recipient_kind at byte %d without AND %s.in_app in the same scope", name, alias, m[0], alias))
			}
		}
	}
	return violations, scoped
}

func TestScopedInboxQueriesFilterInApp(t *testing.T) {
	raw, err := os.ReadFile(notificationQueriesPath)
	if err != nil {
		t.Fatal(err)
	}
	violations, scoped := scopedWithoutInApp(string(raw))
	for _, v := range violations {
		t.Error(v)
	}
	// The guard is not vacuous: the nine statements of §Backend facts (ten scope
	// filters, the grouped list has two) are found as scoped.
	for _, name := range []string{
		"ListNotificationAttention", "ListNotificationGroups", "ListMemberNotificationSamples",
		"CountUnreadNotifications", "MarkNotificationsRead", "MarkNotificationsUnread",
		"MarkAllNotificationsRead", "ListNotificationFacetTypes", "ListNotificationFacetJobs",
	} {
		if !contains(scoped, name) {
			t.Errorf("%s is not detected as a scoped statement", name)
		}
	}
	for name := range inAppExempt {
		if !contains(scoped, name) {
			t.Errorf("exemption %s matches no scoped statement", name)
		}
	}
}

// The guard itself: a missing, wrong-alias or commented-out predicate is
// reported; a qualified predicate (or `= true`) passes.
func TestInAppGuardDetectsMissingPredicate(t *testing.T) {
	for _, tc := range []struct {
		name, sql string
		bad       bool
	}{
		{"missing", "-- name: Q :one\nSELECT 1 FROM notifications n WHERE n.recipient_kind = $1;\n", true},
		{"commented out", "-- name: Q :one\nSELECT 1 FROM notifications n WHERE n.recipient_kind = $1\n  -- AND n.in_app\n;\n", true},
		{"other alias", "-- name: Q :one\nSELECT 1 FROM notifications n JOIN notifications x ON true WHERE n.recipient_kind = $1 AND x.recipient_kind = $1 AND n.in_app;\n", true},
		{"unqualified", "-- name: Q :one\nSELECT 1 FROM notifications WHERE recipient_kind = $1 AND in_app;\n", true},
		{"in_app_extra column is not the predicate", "-- name: Q :one\nSELECT 1 FROM notifications n WHERE n.recipient_kind = $1 AND n.in_app_extra;\n", true},
		{"= false", "-- name: Q :one\nSELECT 1 FROM notifications n WHERE n.recipient_kind = $1 AND n.in_app = false;\n", true},
		{"IS NOT TRUE", "-- name: Q :one\nSELECT 1 FROM notifications n WHERE n.recipient_kind = $1 AND n.in_app IS NOT TRUE;\n", true},
		{"block commented out", "-- name: Q :one\nSELECT 1 FROM notifications n WHERE n.recipient_kind = $1 /* AND n.in_app */;\n", true},
		{"multi-line block comment", "-- name: Q :one\nSELECT 1 FROM notifications n WHERE n.recipient_kind = $1\n/* hidden rows:\n  AND n.in_app\n*/;\n", true},
		{"second scope of the same alias without predicate", "-- name: Q :one\nSELECT 1 FROM notifications n WHERE n.recipient_kind = $1 AND n.in_app\n  AND EXISTS (SELECT 1 FROM notifications n WHERE n.recipient_kind = $1 AND n.id = $2);\n", true},
		{"predicate only in a nested scope", "-- name: Q :one\nSELECT 1 FROM notifications n WHERE n.recipient_kind = $1\n  AND EXISTS (SELECT 1 FROM notifications x WHERE x.id = n.id AND n.in_app);\n", true},
		{"predicate only in the outer scope", "-- name: Q :one\nSELECT 1 FROM notifications n WHERE n.id = $2 AND n.in_app\n  AND EXISTS (SELECT 1 FROM notifications n WHERE n.recipient_kind = $1);\n", true},
		{"each scope with its predicate", "-- name: Q :one\nSELECT 1 FROM notifications n WHERE n.recipient_kind = sqlc.arg('k')::text AND n.in_app\n  AND EXISTS (SELECT 1 FROM notifications n WHERE n.recipient_kind = $1 AND n.in_app);\n", false},
		{"parenthesis in a string literal", "-- name: Q :one\nSELECT 1 FROM notifications n WHERE n.group_key <> ')' AND n.recipient_kind = $1 AND n.in_app;\n", false},
		{"present", "-- name: Q :one\nSELECT 1 FROM notifications n WHERE n.recipient_kind = $1\n  AND n.in_app;\n", false},
		{"present = true", "-- name: Q :one\nSELECT 1 FROM notifications n WHERE n.recipient_kind = $1 AND n.in_app = true;\n", false},
		{"unscoped", "-- name: Q :one\nSELECT 1 FROM notifications n WHERE n.id = $1;\n", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			violations, _ := scopedWithoutInApp(tc.sql)
			if (len(violations) > 0) != tc.bad {
				t.Fatalf("violations = %v, want bad=%v", violations, tc.bad)
			}
		})
	}
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
