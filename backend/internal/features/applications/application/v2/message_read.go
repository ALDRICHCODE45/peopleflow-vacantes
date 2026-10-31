package v2

import "time"

// DecodeMessageRead uses the same duplicate-key rejecting decoder as apply.
func DecodeMessageRead(body []byte, decode JSONDecoder) (time.Time, error) {
	value, err := decode(body)
	if err != nil {
		return time.Time{}, ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok || len(root) != 1 {
		return time.Time{}, ErrInvalidRequest
	}
	raw, ok := root["updated_at"].(string)
	if !ok {
		return time.Time{}, ErrInvalidRequest
	}
	at, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return time.Time{}, ErrInvalidRequest
	}
	return at, nil
}
