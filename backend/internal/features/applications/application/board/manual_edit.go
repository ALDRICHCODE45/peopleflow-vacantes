package board

import (
	"context"
	"encoding/json"
	"strings"

	geoapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/application"
)

var editableCandidateFields = []string{"full_name", "email", "phone", "location", "professional_title", "current_company", "seniority", "years_of_experience", "education", "languages", "skills", "linkedin_url", "portfolio_url"}

// ParseManualEdit shares intake's strict recursive duplicate/unknown-key parser.
// reset is deliberately unsupported for manual identities, even when empty.
func ParseManualEdit(body []byte) (map[string]json.RawMessage, error) {
	envelope, err := manualObject(body, "set", "reset")
	if err != nil {
		return nil, err
	}
	if _, present := envelope["reset"]; present {
		return nil, ErrInvalidRequest
	}
	fields, err := manualObject(envelope["set"], editableCandidateFields...)
	if err != nil || len(fields) == 0 {
		return nil, ErrInvalidRequest
	}
	return fields, nil
}

// ValidateManualEdit reuses intake validation over the effective candidate. Only
// changed fields and the effective-contact invariant can reject a patch: legacy
// incomplete records must remain editable without repairing unrelated fields.
func ValidateManualEdit(ctx context.Context, lookup geoapp.Lookup, effective, set map[string]json.RawMessage) (*ManualCandidate, []ManualFieldError, error) {
	raw := make(map[string]json.RawMessage, len(effective))
	for key, value := range effective {
		raw[key] = value
	}
	for key, value := range set {
		raw[key] = value
	}
	raw["residence"] = raw["location"]
	delete(raw, "location")
	var fields manualFields
	candidate, err := validateManualCandidate(ctx, lookup, raw, &fields)
	if err != nil {
		return nil, nil, err
	}
	out := []ManualFieldError{}
	for _, field := range fields {
		path := strings.TrimPrefix(field.Field, "candidate.")
		if path == "residence" || strings.HasPrefix(path, "residence.") {
			path = "location" + strings.TrimPrefix(path, "residence")
		}
		key := strings.SplitN(strings.SplitN(path, ".", 2)[0], "[", 2)[0]
		if _, changed := set[key]; changed || key == "contact" {
			out = append(out, ManualFieldError{Field: path, Code: field.Code})
		}
	}
	return candidate, out, nil
}
