package fulfillment

import (
	"encoding/json"
	"reflect"
	"sort"
	"testing"
	"time"
)

func TestExactWireKeysAndNulls(t *testing.T) {
	assert := func(value any, keys ...string) map[string]json.RawMessage {
		t.Helper()
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		var root map[string]json.RawMessage
		if err = json.Unmarshal(raw, &root); err != nil {
			t.Fatal(err)
		}
		got := []string{}
		for key := range root {
			got = append(got, key)
		}
		sort.Strings(got)
		sort.Strings(keys)
		if !reflect.DeepEqual(got, keys) {
			t.Fatal(string(raw), got, keys)
		}
		return root
	}
	status := assert(Status{State: "pending"}, "state", "delivered", "target", "cutoff_stage_id", "commitment_date", "business_days_remaining", "fulfillment")
	if string(status["fulfillment"]) != "null" {
		t.Fatal(status)
	}
	frozen := assert(Snapshot{Candidates: []Candidate{}}, "fulfilled_at", "result", "business_days_delta", "target", "cutoff_stage_id", "cutoff_stage_name", "commitment_date", "candidates")
	if string(frozen["candidates"]) != "[]" {
		t.Fatal(frozen)
	}
	preview := assert(Preview{Candidates: []Candidate{}}, "would_fulfill", "delivered", "target", "candidates")
	if string(preview["candidates"]) != "[]" {
		t.Fatal(preview)
	}
	candidate := assert(Candidate{}, "participation_id", "candidate", "reached_at")
	var person map[string]json.RawMessage
	if err := json.Unmarshal(candidate["candidate"], &person); err != nil || len(person) != 2 || person["id"] == nil || person["full_name"] == nil {
		t.Fatal(person, err)
	}
}

func TestEvaluationWholeMexicoCityDates(t *testing.T) {
	zone, err := time.LoadLocation("America/Mexico_City")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, at, commitment, result string
		delta                        int
	}{
		{"same local date after UTC midnight", "2026-11-14T05:59:59Z", "2026-11-13", "on_time", 0},
		{"next local date weekend", "2026-11-14T06:00:00Z", "2026-11-13", "late", 0},
		{"early across weekend and revolution day", "2026-11-13T18:00:00Z", "2026-11-17", "on_time", 1},
		{"late across weekend and revolution day", "2026-11-17T18:00:00Z", "2026-11-13", "late", -1},
		{"early day", "2026-10-19T18:00:00Z", "2026-10-20", "on_time", 1},
		{"late day", "2026-10-20T18:00:00Z", "2026-10-19", "late", -1},
		{"transmission holiday", "2030-09-30T18:00:00Z", "2030-10-02", "on_time", 1},
		{"May holiday and weekend", "2026-04-30T18:00:00Z", "2026-05-04", "on_time", 1},
		{"Constitution Monday", "2026-01-30T18:00:00Z", "2026-02-03", "on_time", 1},
		{"Juarez Monday", "2026-03-13T18:00:00Z", "2026-03-17", "on_time", 1},
		{"Independence day", "2026-09-15T18:00:00Z", "2026-09-17", "on_time", 1},
		{"Christmas and weekend", "2026-12-24T18:00:00Z", "2026-12-28", "on_time", 1},
		{"New Year", "2026-12-31T18:00:00Z", "2027-01-04", "on_time", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			at, _ := time.Parse(time.RFC3339, tc.at)
			result, delta := Evaluate(at, tc.commitment, zone)
			if result != tc.result || delta != tc.delta {
				t.Fatalf("got %s/%d want %s/%d", result, delta, tc.result, tc.delta)
			}
			if got := Remaining(at, tc.commitment, zone); got != tc.delta {
				t.Fatalf("remaining=%d want %d", got, tc.delta)
			}
		})
	}
}
