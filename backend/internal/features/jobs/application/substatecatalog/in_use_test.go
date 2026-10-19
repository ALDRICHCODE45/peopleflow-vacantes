package substatecatalog

import (
	"errors"
	"reflect"
	"testing"
)

func TestCheckRemovalCatalogOrderAndRename(t *testing.T) {
	previous := Catalog{Substates: []Substate{{ID: "second", Name: "Two"}, {ID: "first", Name: "One"}, {ID: "unused", Name: "Unused"}}}
	for _, tc := range []struct {
		name   string
		next   Catalog
		active map[string]bool
		want   []string
	}{
		{"blocked in catalog not map order", Empty(), map[string]bool{"first": true, "second": true}, []string{"second", "first"}},
		{"rename allowed unused removal allowed", Catalog{Substates: []Substate{{ID: "second", Name: "Renamed"}, {ID: "first", Name: "One"}}}, map[string]bool{"second": true}, nil},
		{"unused removal", Empty(), nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := CheckRemoval(previous, tc.next, tc.active)
			if tc.want == nil {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			var used *InUseError
			if !errors.As(err, &used) || !reflect.DeepEqual(used.IDs, tc.want) {
				t.Fatal(err)
			}
		})
	}
}
