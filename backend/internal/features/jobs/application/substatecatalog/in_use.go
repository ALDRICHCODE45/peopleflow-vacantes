package substatecatalog

// InUseError lists blocked removals in the previous catalog's display order.
// It intentionally carries only catalog ids, never occupant identities.
type InUseError struct{ IDs []string }

func (e *InUseError) Error() string { return "substate in use" }

func CheckRemoval(previous, next Catalog, active map[string]bool) error {
	kept := make(map[string]bool, len(next.Substates))
	for _, s := range next.Substates {
		kept[s.ID] = true
	}
	blocked := []string{}
	for _, s := range previous.Substates {
		if active[s.ID] && !kept[s.ID] {
			blocked = append(blocked, s.ID)
		}
	}
	if len(blocked) > 0 {
		return &InUseError{IDs: blocked}
	}
	return nil
}
