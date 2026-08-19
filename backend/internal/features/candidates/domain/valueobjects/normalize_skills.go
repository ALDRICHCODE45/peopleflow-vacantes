package valueobjects

import "strings"

// NormalizeSkills returns a canonical, GIN-friendly representation of the
// supplied skill list. The DB GIN index treats entries case-sensitively, so
// ["Go"] and ["go"] land in different index slots; without normalization the
// recruiter search "skills @> ARRAY['go']" would silently miss half of the
// stored candidates.
//
// The canonical form is: lowercase, trimmed, no empty entries, no duplicates.
// Ordering of first occurrence is preserved (so a recruiter can rely on a
// stable list ordering when reading the row back).
func NormalizeSkills(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		norm := strings.ToLower(strings.TrimSpace(s))
		if norm == "" {
			continue
		}
		if _, ok := seen[norm]; ok {
			continue
		}
		seen[norm] = struct{}{}
		out = append(out, norm)
	}
	return out
}
