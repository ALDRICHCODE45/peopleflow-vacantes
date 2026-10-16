package substatecatalog_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
	"github.com/google/uuid"
)

func replacement(t *testing.T, c substatecatalog.Catalog) []byte {
	t.Helper()
	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestReplace_Invariants(t *testing.T) {
	id := uuid.NewString()
	current := substatecatalog.Catalog{Substates: []substatecatalog.Substate{{ID: id, Name: "Uno"}}}
	cases := []struct{ name, body string }{
		{"empty name", `{"substates":[{"name":" \u00a0\t"}]}`},
		{"long name", `{"substates":[{"name":"` + strings.Repeat("é", 41) + `"}]}`},
		{"control name", `{"substates":[{"name":"a\u0000b"}]}`},
		{"casefold duplicate", `{"substates":[{"name":"Straße"},{"name":"STRASSE"}]}`},
		{"normalized duplicate", `{"substates":[{"name":" ÁREA  TI"},{"name":"A\u0301rea\u00a0ti"}]}`},
		{"unknown id", `{"substates":[{"id":"` + uuid.NewString() + `","name":"Uno"}]}`},
		{"invalid id", `{"substates":[{"id":"bad","name":"Uno"}]}`},
		{"empty id", `{"substates":[{"id":"","name":"Uno"}]}`},
		{"duplicate id", `{"substates":[{"id":"` + id + `","name":"Uno"},{"id":"` + id + `","name":"Dos"}]}`},
	}
	many := make([]string, 51)
	for i := range many {
		many[i] = fmt.Sprintf(`{"name":"Sub %d"}`, i)
	}
	cases = append(cases, struct{ name, body string }{"51 substates", `{"substates":[` + strings.Join(many, ",") + `]}`})
	before := string(replacement(t, current))
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := substatecatalog.Replace(current, []byte(tc.body))
			if !errors.Is(err, drafts.ErrValidation) || !reflect.DeepEqual(got, substatecatalog.Catalog{}) || string(replacement(t, current)) != before {
				t.Fatalf("got %+v %v; want validation_error without mutation", got, err)
			}
		})
	}
}

func TestReplace_StrictDecode(t *testing.T) {
	cases := []struct{ name, body string }{
		{"malformed", `{"substates":`},
		{"trailing", `{"substates":[]} {}`},
		{"unknown root", `{"substates":[],"extra":1}`},
		{"duplicate root", `{"substates":[],"substates":[]}`},
		{"escaped duplicate root", `{"substates":[],"sub\u0073tates":[]}`},
		{"unknown nested", `{"substates":[{"name":"Uno","kind":"in_process"}]}`},
		{"duplicate nested", `{"substates":[{"name":"Uno","na\u006de":"Dos"}]}`},
		{"invalid utf8", "{\"substates\":[{\"name\":\"\xff\"}]}"},
		{"invalid surrogate", `{"substates":[{"name":"\uD800"}]}`},
		{"null root", `null`},
		{"array root", `[]`},
		{"missing substates", `{}`},
		{"null substates", `{"substates":null}`},
		{"object substates", `{"substates":{}}`},
		{"null entry", `{"substates":[null]}`},
		{"missing name", `{"substates":[{}]}`},
		{"name type", `{"substates":[{"name":1}]}`},
		{"id type", `{"substates":[{"id":null,"name":"Uno"}]}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := substatecatalog.Replace(substatecatalog.Catalog{Substates: []substatecatalog.Substate{}}, []byte(tc.body))
			if !errors.Is(err, drafts.ErrInvalidRequest) || !reflect.DeepEqual(got, substatecatalog.Catalog{}) {
				t.Fatalf("got %+v, %v; want zero and invalid_request", got, err)
			}
		})
	}
}
