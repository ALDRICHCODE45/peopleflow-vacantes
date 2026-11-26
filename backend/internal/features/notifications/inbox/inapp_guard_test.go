package inbox

import (
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// notifications-v2 D6 / §In-app off: a hidden row (notifications.in_app =
// false) must never be listed, counted, faceted or marked, so every statement
// of db/queries/notifications.sql that filters by the caller scope
// (`<alias>.recipient_kind = …`) also filters `AND <alias>.in_app` for the
// same alias. A future query that forgets it fails here.
const notificationQueriesPath = "../../../../db/queries/notifications.sql"

// inAppExempt lists statements that read the caller scope on purpose without
// the in_app predicate (the contract allows "the sender's explicit
// exception"). Empty until the sender ships (E6).
var inAppExempt = map[string]bool{}

var (
	sqlNameRe       = regexp.MustCompile(`(?m)^-- name: (\w+)`)
	scopeRe         = regexp.MustCompile(`(?:(\w+)\.)?recipient_kind\s*=`)
	lineCommentRe   = regexp.MustCompile(`--[^\n]*`)
	inAppPredicateF = `(?i)\bAND\s+%s\.in_app\b`
	equalsTrueRe    = regexp.MustCompile(`(?i)^\s*=\s*true\b`)
	equalsRe        = regexp.MustCompile(`(?i)^\s*(=|<>|!=|IS\b)`)
)

// hasInApp reports whether body filters `AND <alias>.in_app` (optionally
// `= true`); any other comparison does not count.
func hasInApp(body, alias string) bool {
	re := regexp.MustCompile(strings.Replace(inAppPredicateF, "%s", regexp.QuoteMeta(alias), 1))
	for _, loc := range re.FindAllStringIndex(body, -1) {
		rest := body[loc[1]:]
		if !equalsRe.MatchString(rest) || equalsTrueRe.MatchString(rest) {
			return true
		}
	}
	return false
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
		out[name] = lineCommentRe.ReplaceAllString(src[loc[1]:end], "")
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
		matches := scopeRe.FindAllStringSubmatch(body, -1)
		if len(matches) == 0 {
			continue
		}
		scoped = append(scoped, name)
		if inAppExempt[name] {
			continue
		}
		for _, m := range matches {
			alias := m[1]
			if alias == "" {
				violations = append(violations, name+": unqualified recipient_kind filter")
				continue
			}
			if !hasInApp(body, alias) {
				violations = append(violations, name+": "+alias+".recipient_kind without AND "+alias+".in_app")
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
