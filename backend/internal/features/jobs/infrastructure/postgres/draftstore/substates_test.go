package draftstore

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
	"github.com/google/uuid"
)

func TestSubstates_RenderStrictResponseContract(t *testing.T) {
	id := uuid.New()
	cases := []struct {
		name        string
		c           substatecatalog.Catalog
		version     int64
		wantVersion string
	}{
		{"never saved", substatecatalog.Empty(), 0, "0"},
		{"first empty save", substatecatalog.Empty(), 1, "1"},
		{"saved suggestion remains suggested", substatecatalog.Catalog{Substates: []substatecatalog.Substate{{ID: uuid.NewString(), Name: "Primera entrevista"}}}, 2, "2"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := renderSubstates(id, tc.c, tc.version, nil)
			if err != nil || got.ETag != substatecatalog.ETag(id, tc.version) {
				t.Fatalf("result=%+v %v", got, err)
			}
			var root map[string]json.RawMessage
			if err := json.Unmarshal(got.Body, &root); err != nil || len(root) != 4 {
				t.Fatalf("root=%s %v", got.Body, err)
			}
			for _, key := range []string{"version", "substates", "limits", "suggestions"} {
				if _, ok := root[key]; !ok {
					t.Fatalf("missing key %s", key)
				}
			}
			if string(root["version"]) != `"`+tc.wantVersion+`"` || string(root["substates"]) == "null" || string(root["suggestions"]) == "null" {
				t.Fatalf("response=%s", got.Body)
			}
			var limits map[string]int
			if err := json.Unmarshal(root["limits"], &limits); err != nil || !reflect.DeepEqual(limits, map[string]int{"maxSubstates": 50, "nameMaxLength": 40}) {
				t.Fatalf("limits=%s %v", root["limits"], err)
			}
			var suggestions []string
			if err := json.Unmarshal(root["suggestions"], &suggestions); err != nil || !reflect.DeepEqual(suggestions, substatecatalog.Suggestions()) {
				t.Fatalf("suggestions=%s %v", root["suggestions"], err)
			}
			var entries []map[string]any
			if err := json.Unmarshal(root["substates"], &entries); err != nil || len(entries) != len(tc.c.Substates) {
				t.Fatalf("entries=%s %v", root["substates"], err)
			}
			for i, entry := range entries {
				if !reflect.DeepEqual(entry, map[string]any{"id": tc.c.Substates[i].ID, "name": tc.c.Substates[i].Name, "in_use": false}) {
					t.Fatalf("entry=%+v", entry)
				}
			}
		})
	}
}
