package draftinput

import (
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancygeo"
	shared "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
)

func composeGeography(object map[string]any, out *Fields) error {
	if raw, present := object["location"]; present {
		v, err := vacancygeo.ParseLocation(raw)
		if err != nil {
			return err
		}
		out.Location = shared.Optional[*vacancygeo.Location]{Set: true, Valid: v != nil, Value: v}
	}
	if raw, present := object["remote_scope"]; present {
		v, err := vacancygeo.ParseRemoteScope(raw)
		if err != nil {
			return err
		}
		out.RemoteScope = shared.Optional[*vacancygeo.RemoteScope]{Set: true, Valid: v != nil, Value: v}
	}
	return nil
}

// Unknown/read-only keys are always structural 400s, before value validation.
func geographyKeyViolation(fields map[string]any) (string, bool) {
	for _, f := range []struct {
		key     string
		allowed []string
	}{
		{"location", []string{"country", "state", "municipality", "postal_code"}},
		{"remote_scope", []string{"kind", "countries"}},
	} {
		if key, bad := unknownObjectKey(fields[f.key], f.allowed); bad {
			return f.key + "." + key, true
		}
	}
	return "", false
}
