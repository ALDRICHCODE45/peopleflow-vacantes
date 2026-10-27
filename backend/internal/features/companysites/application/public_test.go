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
