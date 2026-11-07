package vacancymanagement

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
)

// stakeholder-metrics-v1 §2.2 / D7: optional targetCloseDate; absent keeps it.
func TestReplaceTargetCloseDate(t *testing.T) {
	stored := Configuration{RequestDate: text("2026-10-01"), HiringHeadcount: count(2), TargetCloseDate: text("2026-12-15")}
	for _, tc := range []struct {
		name, body string
		want       *string
	}{
		{"absent keeps", `{"requestDate":"2026-10-01","hiringHeadcount":2}`, text("2026-12-15")},
		{"null clears", `{"requestDate":"2026-10-01","hiringHeadcount":2,"targetCloseDate":null}`, nil},
		{"changes", `{"requestDate":"2026-10-01","hiringHeadcount":2,"targetCloseDate":"2027-01-31"}`, text("2027-01-31")},
		{"past accepted", `{"requestDate":"2026-10-01","hiringHeadcount":2,"targetCloseDate":"2020-02-29"}`, text("2020-02-29")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before, _ := json.Marshal(stored)
			got, err := Replace(stored, []byte(tc.body), "2026-10-16")
			if err != nil || !equal(got.TargetCloseDate, tc.want) || *got.HiringHeadcount != 2 || *got.RequestDate != "2026-10-01" {
				t.Fatalf("%+v %v", got, err)
			}
			if after, _ := json.Marshal(stored); string(after) != string(before) {
				t.Fatal("mutated current")
			}
		})
	}
	for _, body := range []string{
		`{"requestDate":null,"hiringHeadcount":null,"targetCloseDate":1}`,
		`{"requestDate":null,"hiringHeadcount":null,"targetCloseDate":"2026-02-30"}`,
		`{"requestDate":null,"hiringHeadcount":null,"targetCloseDate":"2026-1-1"}`,
		`{"requestDate":null,"hiringHeadcount":null,"targetCloseDate":""}`,
		`{"requestDate":null,"targetCloseDate":null}`,
		`{"requestDate":null,"hiringHeadcount":null,"targetCloseDate":null,"x":1}`,
		`{"requestDate":null,"hiringHeadcount":null,"targetCloseDate":null,"targetCloseDate":null}`,
	} {
		t.Run(body, func(t *testing.T) {
			got, err := Replace(stored, []byte(body), "2026-10-16")
			if !errors.Is(err, drafts.ErrInvalidRequest) || !reflect.DeepEqual(got, Configuration{}) {
				t.Fatalf("%+v %v", got, err)
			}
		})
	}
}

func TestTargetCloseDateWireIsOptional(t *testing.T) {
	raw, _ := json.Marshal(Configuration{RequestDate: text("2026-10-01")})
	if string(raw) != `{"requestDate":"2026-10-01","hiringHeadcount":null}` {
		t.Fatal(string(raw))
	}
	raw, _ = json.Marshal(Configuration{TargetCloseDate: text("2026-12-15")})
	if string(raw) != `{"requestDate":null,"hiringHeadcount":null,"targetCloseDate":"2026-12-15"}` {
		t.Fatal(string(raw))
	}
	a := Configuration{TargetCloseDate: text("2026-12-15")}
	if a.Equal(Configuration{}) || !a.Equal(Configuration{TargetCloseDate: text("2026-12-15")}) {
		t.Fatal("equality ignores targetCloseDate")
	}
}
