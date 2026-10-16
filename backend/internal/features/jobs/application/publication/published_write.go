package publication

// PublishedWriteMissing preserves readiness code order while exempting only
// clock passage. A published vacancy cannot lose any other requirement.
func PublishedWriteMissing(missing []string) []string {
	out := make([]string, 0, len(missing))
	for _, code := range missing {
		if code != "commitment_date_past" {
			out = append(out, code)
		}
	}
	return out
}
