package draftstore

import (
	"errors"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
)

// requireV1ReadSchema runs only after resource authorization. It discriminates
// stored schema versions, not the independent row CAS counter or field grammar.
// A known foreign schema is hidden; corrupt/unknown markers are server errors.
func requireV1ReadSchema(canonical []byte) error {
	value, err := draftjson.Decode(canonical)
	if err != nil {
		return fmt.Errorf("decode stored draft schema: %w", err)
	}
	object, ok := value.(map[string]any)
	if !ok {
		return errors.New("draftstore: stored draft envelope is not an object")
	}
	version, ok := object["schema_version"].(int64)
	if !ok {
		return errors.New("draftstore: missing or invalid stored schema version")
	}
	switch version {
	case 1:
		return nil
	case 2:
		return drafts.ErrNotFound
	default:
		return errors.New("draftstore: unknown stored schema version")
	}
}
