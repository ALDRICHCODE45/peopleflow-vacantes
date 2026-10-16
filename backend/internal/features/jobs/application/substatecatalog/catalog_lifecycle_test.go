package substatecatalog_test

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
)

func TestReplace_NormalizationOrderIdentityRemovalAndNoOp(t *testing.T) {
	empty := substatecatalog.Empty()
	if err := substatecatalog.Validate(empty); err != nil || string(replacement(t, empty)) != `{"substates":[]}` {
		t.Fatalf("empty=%+v %v", empty, err)
	}
	got, err := substatecatalog.Replace(empty, []byte(`{"substates":[{"name":"  A\u0301rea\u00a0\tTI "},{"name":"Area TI"},{"name":"Fuera\u200b"},{"name":"En proceso"},{"name":"`+strings.Repeat("e\u0301", 40)+`"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	wantNames := []string{"Área TI", "Area TI", "Fuera\u200b", "En proceso", strings.Repeat("é", 40)}
	for i, s := range got.Substates {
		if s.Name != wantNames[i] || uuid.MustParse(s.ID).Version() != 4 {
			t.Fatalf("entry %d = %+v", i, s)
		}
	}
	before := string(replacement(t, got))
	reordered := substatecatalog.Catalog{Substates: append([]substatecatalog.Substate{}, got.Substates...)}
	reordered.Substates[0], reordered.Substates[1] = reordered.Substates[1], reordered.Substates[0]
	reordered.Substates[0].Name = "Renombrado"
	next, err := substatecatalog.Replace(got, replacement(t, reordered))
	if err != nil || !next.Equal(reordered) || next.Equal(got) || before != string(replacement(t, got)) {
		t.Fatalf("reorder/rename=%+v %v", next, err)
	}
	reordered.Substates[0].Name = " \tRenombrado\u00a0 "
	noop, err := substatecatalog.Replace(next, replacement(t, reordered))
	if err != nil || !noop.Equal(next) {
		t.Fatalf("normalized no-op=%+v %v", noop, err)
	}
	removed, err := substatecatalog.Replace(got, replacement(t, empty))
	if err != nil || !removed.Equal(empty) {
		t.Fatalf("remove=%+v %v", removed, err)
	}
	if _, err := substatecatalog.Replace(removed, replacement(t, got)); !errors.Is(err, drafts.ErrValidation) {
		t.Fatalf("resurrected removed id: %v", err)
	}
	// Compatibility characters are not NFKC-folded; accents remain significant.
	if _, err := substatecatalog.Replace(empty, []byte(`{"substates":[{"name":"Ａ"},{"name":"A"},{"name":"Área"},{"name":"Area"}]}`)); err != nil {
		t.Fatal(err)
	}
}

func TestReplace_LimitsAndPayloadBudget(t *testing.T) {
	entries := make([]string, 50)
	for i := range entries {
		entries[i] = fmt.Sprintf(`{"name":"Sub %d"}`, i)
	}
	got, err := substatecatalog.Replace(substatecatalog.Empty(), []byte(`{"substates":[`+strings.Join(entries, ",")+`]}`))
	if err != nil || len(got.Substates) != 50 {
		t.Fatalf("50 substates=%+v %v", got, err)
	}
	if got.Equal(substatecatalog.Empty()) {
		t.Fatal("unequal lengths compare equal")
	}
	if _, err := substatecatalog.Replace(got, []byte(strings.Repeat("x", substatecatalog.MaxBodyBytes+1))); !errors.Is(err, drafts.ErrPayloadTooLarge) {
		t.Fatalf("budget=%v", err)
	}
}

func TestSuggestions_FixedNormalizedUniqueAndDefensive(t *testing.T) {
	want := []string{"Primera entrevista", "Segunda entrevista", "Pruebas psicométricas", "Propuesta entregada"}
	got := substatecatalog.Suggestions()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("suggestions=%v", got)
	}
	seen := map[string]bool{}
	for _, s := range got {
		n, err := valueobjects.NewRequesterName(s)
		if err != nil || n.Value() != s || seen[n.Key()] {
			t.Fatalf("suggestion=%q %v", s, err)
		}
		seen[n.Key()] = true
	}
	got[0] = "Modified"
	if !reflect.DeepEqual(substatecatalog.Suggestions(), want) {
		t.Fatal("suggestions share mutable storage")
	}
}

func TestValidate_RejectsCorruptStoredCatalog(t *testing.T) {
	id := uuid.NewString()
	cases := []struct {
		name string
		c    substatecatalog.Catalog
	}{
		{"null", substatecatalog.Catalog{}},
		{"invalid id", substatecatalog.Catalog{Substates: []substatecatalog.Substate{{ID: "bad", Name: "Uno"}}}},
		{"nil id", substatecatalog.Catalog{Substates: []substatecatalog.Substate{{ID: uuid.Nil.String(), Name: "Uno"}}}},
		{"noncanonical id", substatecatalog.Catalog{Substates: []substatecatalog.Substate{{ID: strings.ToUpper("abcdefab-cdef-4abc-8def-abcdefabcdef"), Name: "Uno"}}}},
		{"noncanonical name", substatecatalog.Catalog{Substates: []substatecatalog.Substate{{ID: id, Name: " Uno "}}}},
		{"duplicate name", substatecatalog.Catalog{Substates: []substatecatalog.Substate{{ID: id, Name: "Uno"}, {ID: uuid.NewString(), Name: "UNO"}}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := substatecatalog.Validate(tc.c); !errors.Is(err, drafts.ErrValidation) {
				t.Fatalf("validation=%v", err)
			}
		})
	}
}
