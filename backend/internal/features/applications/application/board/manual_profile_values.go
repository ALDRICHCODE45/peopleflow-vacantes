package board

import (
	"encoding/json"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
)

func manualCatalogCode(value string) bool { _, ok := languages.Lookup(value); return ok }

// Enum and decimal literals are exact: unlike free text they are never trimmed
// or case-folded. Validation paths remain owned by the intake contract.
func manualLiteral(raw []byte, path string, required bool, valid func(string) bool, fields *manualFields) *string {
	if manualNull(raw) {
		if required {
			fields.add(path, "required")
		}
		return nil
	}
	var value string
	if json.Unmarshal(raw, &value) != nil {
		fields.add(path, "invalid")
		return nil
	}
	if value == "" && required {
		fields.add(path, "required")
		return nil
	}
	if !valid(value) {
		fields.add(path, "invalid")
		return nil
	}
	return &value
}
