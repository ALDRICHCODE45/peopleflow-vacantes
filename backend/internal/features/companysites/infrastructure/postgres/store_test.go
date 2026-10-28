package postgres

import (
	"encoding/json"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	"github.com/google/uuid"
)

func TestStoredDocumentLegacyNormalization(t *testing.T) {
	decode := func(raw []byte) (any, error) {
		var value any
		err := json.Unmarshal(raw, &value)
		return value, err
	}
	s := &Store{decode: decode, validator: app.NewValidator(nil)}
	value, _ := decode(app.DefaultDocument())
	m := value.(map[string]any)
	theme := m["theme"].(map[string]any)
	delete(theme, "accent_color")
	delete(theme, "background_color")
	m["blocks"] = append(m["blocks"].([]any), map[string]any{"id": uuid.NewString(), "type": "benefits", "variant": "grid", "hidden": false, "content": map[string]any{"items": []any{map[string]any{"title": "Legacy", "icon": nil}}}})
	raw, _ := json.Marshal(m)
	doc, err := s.storedDocument(raw)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"accent_color", "background_color"} {
		if value, ok := doc.Value["theme"].(map[string]any)[key]; !ok || value != nil {
			t.Fatal(key, doc.Value)
		}
	}
	item := doc.Value["blocks"].([]any)[2].(map[string]any)["content"].(map[string]any)["items"].([]any)[0].(map[string]any)
	for _, key := range []string{"icon", "emoji"} {
		if value, ok := item[key]; !ok || value != nil {
			t.Fatal(key, item)
		}
	}
	item["emoji"] = "not emoji"
	raw, _ = json.Marshal(doc.Value)
	if _, err := s.storedDocument(raw); err == nil {
		t.Fatal("stored mode must still reject invalid emoji")
	}
}
