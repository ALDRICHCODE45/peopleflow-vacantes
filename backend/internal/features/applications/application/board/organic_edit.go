package board

import "encoding/json"

// ParseOrganicEdit uses the same strict parser and field allowlist as manual
// intake/edit. Resets only name fields; their presence is checked under lock.
func ParseOrganicEdit(body []byte) (map[string]json.RawMessage, []string, error) {
	envelope, err := manualObject(body, "set", "reset")
	if err != nil {
		return nil, nil, err
	}
	set := map[string]json.RawMessage{}
	if raw, present := envelope["set"]; present {
		set, err = manualObject(raw, editableCandidateFields...)
		if err != nil {
			return nil, nil, err
		}
	}
	reset := []string{}
	if raw, present := envelope["reset"]; present {
		if json.Unmarshal(raw, &reset) != nil || reset == nil {
			return nil, nil, ErrInvalidRequest
		}
	}
	allowed := map[string]bool{}
	for _, field := range editableCandidateFields {
		allowed[field] = true
	}
	seen := map[string]bool{}
	for _, key := range reset {
		if !allowed[key] || seen[key] {
			return nil, nil, ErrInvalidRequest
		}
		if _, ok := set[key]; ok {
			return nil, nil, ErrInvalidRequest
		}
		seen[key] = true
	}
	if len(set)+len(reset) == 0 {
		return nil, nil, ErrInvalidRequest
	}
	return set, reset, nil
}
