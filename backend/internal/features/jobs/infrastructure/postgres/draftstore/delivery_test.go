package draftstore

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/businesscalendar"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/google/uuid"
)

func TestDelivery_RenderStrictResponseContract(t *testing.T) {
	zone, err := time.LoadLocation(deliveryconfig.TimeZone)
	if err != nil {
		t.Fatal(err)
	}
	cal := deliveryconfig.CalendarAt(time.Date(2026, 10, 17, 3, 0, 0, 0, time.UTC), zone)
	id := uuid.New()
	cutoff := uuid.NewString()
	target := int64(999)
	date := "2026-11-30"
	cases := []struct {
		name    string
		version int64
		c       deliveryconfig.Configuration
	}{
		{"never saved", 0, deliveryconfig.Configuration{}},
		{"first all-null save", 1, deliveryconfig.Configuration{}},
		{"configured", 2, deliveryconfig.Configuration{CutoffStageID: &cutoff, TargetQuantity: &target, CommitmentDate: &date}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result, err := renderDelivery(id, tc.c, tc.version, cal)
			if err != nil {
				t.Fatal(err)
			}
			if result.ETag != deliveryconfig.ETag(id, tc.version) {
				t.Fatalf("ETag=%s", result.ETag)
			}
			var root map[string]json.RawMessage
			if err := json.Unmarshal(result.Body, &root); err != nil {
				t.Fatal(err)
			}
			for _, key := range []string{"version", "cutoffStageId", "targetQuantity", "commitmentDate", "limits", "calendar"} {
				if _, ok := root[key]; !ok {
					t.Fatalf("missing %s", key)
				}
			}
			if len(root) != 6 || string(root["limits"]) != `{"maxTargetQuantity":999}` {
				t.Fatalf("root=%s", result.Body)
			}
			var c deliveryconfig.Configuration
			if err := json.Unmarshal(result.Body, &c); err != nil || !c.Equal(tc.c) {
				t.Fatalf("values=%+v err=%v", c, err)
			}
			if tc.c.CutoffStageID == nil && string(root["cutoffStageId"]) != "null" || tc.c.TargetQuantity == nil && string(root["targetQuantity"]) != "null" || tc.c.CommitmentDate == nil && string(root["commitmentDate"]) != "null" {
				t.Fatalf("nulls=%s", result.Body)
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(root["calendar"], &fields); err != nil {
				t.Fatal(err)
			}
			if len(fields) != 5 || string(fields["timeZone"]) != `"America/Mexico_City"` || string(fields["today"]) != `"2026-10-16"` || string(fields["minDate"]) != string(fields["today"]) || string(fields["maxDate"]) != `"2027-10-16"` {
				t.Fatalf("calendar=%s", root["calendar"])
			}
			var dates []string
			if err := json.Unmarshal(fields["nonBusinessDates"], &dates); err != nil {
				t.Fatal(err)
			}
			min, _ := time.Parse(time.DateOnly, cal.MinDate)
			max, _ := time.Parse(time.DateOnly, cal.MaxDate)
			if !reflect.DeepEqual(dates, businesscalendar.NonBusinessDates(min, max)) {
				t.Fatalf("exclusions=%v", dates)
			}
		})
	}
}
