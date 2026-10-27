package application

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func TestVisibleDocumentDropsHiddenBlocksAndTheirMedia(t *testing.T) {
	var value map[string]any
	if err := json.Unmarshal(DefaultDocument(), &value); err != nil {
		t.Fatal(err)
	}
	visibleID, hiddenID := uuid.NewString(), uuid.NewString()
	blocks := value["blocks"].([]any)
	blocks[0].(map[string]any)["content"].(map[string]any)["cover"] = map[string]any{"media_id": visibleID}
	blocks = append(blocks, map[string]any{"id": uuid.NewString(), "type": "story", "variant": "text_image", "hidden": true, "content": map[string]any{"image": map[string]any{"media_id": hiddenID}}})
	value["blocks"] = blocks
	doc, err := NewValidator(nil).VisibleDocument(value)
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Media) != 1 || doc.Media[0].ID != visibleID || doc.Media[0].Kind != "cover" {
		t.Fatalf("media: %+v", doc.Media)
	}
	var site map[string]json.RawMessage
	if err := json.Unmarshal(doc.Canonical, &site); err != nil {
		t.Fatal(err)
	}
	if len(site) != 3 || site["theme"] == nil || site["seo"] == nil || site["blocks"] == nil {
		t.Fatalf("site keys: %s", doc.Canonical)
	}
	var gotBlocks []any
	if err := json.Unmarshal(site["blocks"], &gotBlocks); err != nil || len(gotBlocks) != 2 {
		t.Fatalf("blocks: %s %v", site["blocks"], err)
	}
}

// A visible story body and a testimonial survive the public projection; the rich
// validator must see the decoded body exactly once.
func TestVisibleDocumentKeepsVisibleRichBody(t *testing.T) {
	var value map[string]any
	if err := json.Unmarshal(DefaultDocument(), &value); err != nil {
		t.Fatal(err)
	}
	body := map[string]any{"schema_version": int64(1), "document": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": "Construimos oportunidades reales."}}}}}}
	value["blocks"] = append(value["blocks"].([]any),
		map[string]any{"id": uuid.NewString(), "type": "story", "variant": "text", "hidden": false, "content": map[string]any{"title": "Nuestra historia", "body": body, "image": nil}},
		map[string]any{"id": uuid.NewString(), "type": "testimonials", "variant": "cards", "hidden": false, "content": map[string]any{"items": []any{map[string]any{"quote": "Un gran equipo", "name": "Persona", "role": nil, "photo": nil, "consent": true}}}},
		map[string]any{"id": uuid.NewString(), "type": "closing", "variant": "banner", "hidden": true, "content": map[string]any{"title": nil, "text": nil}})
	doc, err := NewValidator(fakeRich).VisibleDocument(value)
	if err != nil {
		t.Fatal(err)
	}
	var site struct {
		Blocks []struct {
			Type    string         `json:"type"`
			Content map[string]any `json:"content"`
		} `json:"blocks"`
	}
	if err := json.Unmarshal(doc.Canonical, &site); err != nil {
		t.Fatal(err)
	}
	if len(site.Blocks) != 4 || site.Blocks[2].Type != "story" || site.Blocks[3].Type != "testimonials" {
		t.Fatalf("blocks: %s", doc.Canonical)
	}
	story, _ := site.Blocks[2].Content["body"].(map[string]any)
	if story["schema_version"] != float64(1) || story["document"] == nil {
		t.Fatalf("story body: %s", doc.Canonical)
	}
}
