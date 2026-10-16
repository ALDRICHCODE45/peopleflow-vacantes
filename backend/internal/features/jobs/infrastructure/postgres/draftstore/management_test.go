package draftstore

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancymanagement"
	"github.com/google/uuid"
)

func TestManagementRenderStrictKeysAndNulls(t *testing.T) {
	id := uuid.New()
	s := NewStore(nil, nil)
	s.clock = func() time.Time { return time.Date(2026, 10, 17, 3, 0, 0, 0, time.UTC) }
	today, err := s.managementToday()
	if err != nil || today != "2026-10-16" {
		t.Fatalf("today=%s %v", today, err)
	}
	for _, tc := range []struct {
		name    string
		c       vacancymanagement.Configuration
		version int64
	}{{"defaults", vacancymanagement.Configuration{}, 0}, {"saved", vacancymanagement.Configuration{RequestDate: managementString("2026-10-11"), HiringHeadcount: managementCount(999)}, 2}} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := renderManagement(id, tc.c, tc.version, today)
			if err != nil {
				t.Fatal(err)
			}
			var obj map[string]any
			if err := json.Unmarshal(got.Body, &obj); err != nil {
				t.Fatal(err)
			}
			if len(obj) != 5 || got.ETag != vacancymanagement.ETag(id, tc.version) || got.Replayed || obj["today"] != today || !reflect.DeepEqual(obj["limits"], map[string]any{"maxHiringHeadcount": float64(999)}) {
				t.Fatalf("%s %+v", got.Body, got)
			}
			var actual vacancymanagement.Configuration
			_ = json.Unmarshal(got.Body, &actual)
			if !actual.Equal(tc.c) {
				t.Fatalf("%+v want %+v", actual, tc.c)
			}
			for _, key := range []string{"version", "requestDate", "hiringHeadcount", "limits", "today"} {
				if _, ok := obj[key]; !ok {
					t.Fatal(key)
				}
			}
		})
	}
}
func managementString(v string) *string { return &v }
func managementCount(v int64) *int64    { return &v }
