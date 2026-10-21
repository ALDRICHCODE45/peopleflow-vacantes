package board

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"

	"github.com/google/uuid"
)

// ManualFingerprint binds the replay to the draft, canonical JSON and CV bytes.
// Filename and multipart boundary are deliberately not identity inputs. JSON
// objects are sorted by encoding/json; array order and scalar values are kept.
// Reject duplicate keys at every depth rather than hashing a lossy last-wins map.
func ManualFingerprint(draft uuid.UUID, data, cv []byte) (string, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	value, err := uniqueJSONValue(decoder)
	if err != nil {
		return "", ErrInvalidRequest
	}
	if _, ok := value.(map[string]any); !ok {
		return "", ErrInvalidRequest
	}
	if _, err := decoder.Token(); err != io.EOF {
		return "", ErrInvalidRequest
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return "", ErrInvalidRequest
	}
	cvHash := sha256.Sum256(cv)
	hash := sha256.New()
	// Fixed-width UUID and CV digest delimit the variable-sized JSON unambiguously.
	hash.Write(draft[:])
	hash.Write(cvHash[:])
	hash.Write(canonical)
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func uniqueJSONValue(decoder *json.Decoder) (any, error) {
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	switch token {
	case json.Delim('{'):
		object := make(map[string]any)
		for decoder.More() {
			key, err := decoder.Token()
			if err != nil {
				return nil, err
			}
			name, ok := key.(string)
			if !ok {
				return nil, ErrInvalidRequest
			}
			if _, exists := object[name]; exists {
				return nil, ErrInvalidRequest
			}
			value, err := uniqueJSONValue(decoder)
			if err != nil {
				return nil, err
			}
			object[name] = value
		}
		if end, err := decoder.Token(); err != nil || end != json.Delim('}') {
			return nil, ErrInvalidRequest
		}
		return object, nil
	case json.Delim('['):
		array := []any{}
		for decoder.More() {
			value, err := uniqueJSONValue(decoder)
			if err != nil {
				return nil, err
			}
			array = append(array, value)
		}
		if end, err := decoder.Token(); err != nil || end != json.Delim(']') {
			return nil, ErrInvalidRequest
		}
		return array, nil
	default:
		if _, delimiter := token.(json.Delim); delimiter {
			return nil, ErrInvalidRequest
		}
		return token, nil
	}
}
