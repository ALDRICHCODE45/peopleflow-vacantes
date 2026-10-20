package v2_test

import (
	"encoding/json"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
)

func TestGeoSnapshotMissingProfileWire(t *testing.T) {
	raw, err := json.Marshal(app.SnapshotProfile(nil, nil, nil, nil))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"location":null,"skills":[],"years_of_experience":null,"education_level":null}` {
		t.Fatalf("snapshot: %s", raw)
	}
}
