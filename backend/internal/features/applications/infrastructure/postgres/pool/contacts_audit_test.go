package pool

import (
	"encoding/json"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	"github.com/google/uuid"
)

// The reveal row lists the revealed candidates sorted by kind then id, as IDs
// only, whatever order the request used and whatever the contact values are.
func TestRevealedMetadataIsSortedAndCarriesNoContactValues(t *testing.T) {
	low, mid, high := uuid.MustParse("00000000-0000-4000-8000-000000000001"), uuid.MustParse("00000000-0000-4000-8000-000000000002"), uuid.MustParse("00000000-0000-4000-8000-000000000003")
	email, phone := "private@example.test", "+52 55 0000 0000"
	items := []app.ContactItem{
		{Identity: app.Identity{Kind: "organic", ID: low}, Email: &email, Phone: &phone},
		{Identity: app.Identity{Kind: "manual", ID: high}, Email: &email},
		{Identity: app.Identity{Kind: "manual", ID: mid}, Phone: &phone},
	}
	got := revealedMetadata(items)
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"candidates":[{"id":"` + mid.String() + `","kind":"manual"},{"id":"` + high.String() + `","kind":"manual"},{"id":"` + low.String() + `","kind":"organic"}],"count":3}`
	if string(raw) != want {
		t.Fatalf("metadata = %s\nwant       %s", raw, want)
	}
	// The input order is untouched: the response keeps the request order.
	if items[0].Kind != "organic" || items[1].ID != high || items[2].ID != mid {
		t.Fatal("revealedMetadata reordered the items")
	}
}
