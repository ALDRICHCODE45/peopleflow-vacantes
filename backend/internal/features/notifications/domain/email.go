package domain

// Email delivery rules at creation (notifications-v2 D9, D10).

// Coalesced reports whether a type's emails coalesce per (recipient,
// group_key) in a fixed 10-minute window (D10): exactly the grouped types
// (application_received, psychometric_completed, psychometric_pending).
// Every other type — every mandatory one included — has a single group
// (`n:<id>`) and is sent immediately.
func Coalesced(t Type) bool {
	spec, ok := Lookup(t)
	return ok && spec.Group != GroupSingle
}
