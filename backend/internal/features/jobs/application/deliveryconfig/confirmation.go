package deliveryconfig

import (
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
)

// Confirmation reads the optional flag after Replace has validated the complete
// document; it is request intent, never part of persisted configuration equality.
func Confirmation(body []byte) (bool, error) {
	value, err := draftjson.Decode(body)
	if err != nil {
		return false, drafts.ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok {
		return false, drafts.ErrInvalidRequest
	}
	raw, exists := root["confirm_fulfillment"]
	if !exists {
		return false, nil
	}
	flag, ok := raw.(bool)
	if !ok {
		return false, drafts.ErrInvalidRequest
	}
	return flag, nil
}
