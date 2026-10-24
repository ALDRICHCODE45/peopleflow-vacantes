package valueobjects

import "strings"

// NormalizeSkills trims and collapses whitespace, drops empty entries, and
// deduplicates case-insensitively. The first occurrence's casing and order are
// retained for storage and display. Searches must compare case-insensitive keys,
// not raw array entries; legacy lowercase values are not rewritten.
func NormalizeSkills(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		norm := strings.Join(strings.Fields(s), " ")
		if norm == "" {
			continue
		}
		key := strings.ToLower(norm)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, norm)
	}
	return out
}
