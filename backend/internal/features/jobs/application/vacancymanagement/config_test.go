package vacancymanagement

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func text(v string) *string { return &v }
func count(v int64) *int64  { return &v }
func TestReplaceStrictDocument(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"missing", `{}`}, {"missing headcount", `{"requestDate":null}`}, {"unknown", `{"requestDate":null,"hiringHeadcount":null,"today":"2026-10-16"}`},
		{"duplicate", `{"requestDate":null,"request\u0044ate":null,"hiringHeadcount":null}`}, {"root null", `null`}, {"array", `[]`}, {"trailing", `{"requestDate":null,"hiringHeadcount":null}{}`},
		{"date type", `{"requestDate":1,"hiringHeadcount":null}`}, {"date malformed", `{"requestDate":"2026-02-30","hiringHeadcount":null}`}, {"not padded", `{"requestDate":"2026-1-1","hiringHeadcount":null}`},
		{"headcount string", `{"requestDate":null,"hiringHeadcount":"1"}`}, {"fraction", `{"requestDate":null,"hiringHeadcount":1.5}`}, {"boolean", `{"requestDate":null,"hiringHeadcount":true}`},
		{"utf8", "{\"requestDate\":\"\xff\",\"hiringHeadcount\":null}"}, {"surrogate", `{"requestDate":"\uD800","hiringHeadcount":null}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Replace(Configuration{}, []byte(tc.body), "2026-10-16")
			if !errors.Is(err, drafts.ErrInvalidRequest) || !reflect.DeepEqual(got, Configuration{}) {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
	_, err := Replace(Configuration{}, []byte(strings.Repeat("x", MaxBodyBytes+1)), "2026-10-16")
	if !errors.Is(err, drafts.ErrPayloadTooLarge) {
		t.Fatal(err)
	}
}
func TestReplaceDateOnChangeAndHeadcount(t *testing.T) {
	for _, tc := range []struct {
		name          string
		current, next Configuration
		want          error
	}{
		{"null", Configuration{}, Configuration{}, nil}, {"minimum", Configuration{}, Configuration{HiringHeadcount: count(1)}, nil}, {"maximum", Configuration{}, Configuration{HiringHeadcount: count(999)}, nil},
		{"zero", Configuration{}, Configuration{HiringHeadcount: count(0)}, drafts.ErrValidation}, {"negative", Configuration{}, Configuration{HiringHeadcount: count(-1)}, drafts.ErrValidation}, {"over", Configuration{}, Configuration{HiringHeadcount: count(1000)}, drafts.ErrValidation},
		{"today", Configuration{}, Configuration{RequestDate: text("2026-10-16")}, nil}, {"weekend", Configuration{}, Configuration{RequestDate: text("2026-10-11")}, nil}, {"holiday", Configuration{}, Configuration{RequestDate: text("2026-09-16")}, nil}, {"past unbounded", Configuration{}, Configuration{RequestDate: text("1900-01-01")}, nil},
		{"future", Configuration{}, Configuration{RequestDate: text("2026-10-17")}, drafts.ErrValidation}, {"unchanged future", Configuration{RequestDate: text("2030-01-01")}, Configuration{RequestDate: text("2030-01-01"), HiringHeadcount: count(2)}, nil},
		{"clear", Configuration{RequestDate: text("2030-01-01"), HiringHeadcount: count(2)}, Configuration{}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, _ := json.Marshal(tc.next)
			before, _ := json.Marshal(tc.current)
			got, err := Replace(tc.current, raw, "2026-10-16")
			if !errors.Is(err, tc.want) || err == nil && !got.Equal(tc.next) {
				t.Fatalf("got=%+v err=%v want=%v", got, err, tc.want)
			}
			after, _ := json.Marshal(tc.current)
			if string(before) != string(after) {
				t.Fatal("mutated current")
			}
		})
	}
	for _, number := range []string{"1.0", "100e-2"} {
		t.Run(number, func(t *testing.T) {
			got, err := Replace(Configuration{}, []byte(`{"requestDate":null,"hiringHeadcount":`+number+`}`), "2026-10-16")
			if err != nil || got.HiringHeadcount == nil || *got.HiringHeadcount != 1 {
				t.Fatalf("%+v %v", got, err)
			}
		})
	}
}
func TestTodayAndIndependentTag(t *testing.T) {
	zone, err := time.LoadLocation(TimeZone)
	if err != nil {
		t.Fatal(err)
	}
	if got := TodayAt(time.Date(2026, 10, 17, 3, 0, 0, 0, time.UTC), zone); got != "2026-10-16" {
		t.Fatal(got)
	}
	id := uuid.New()
	tag := ETag(id, 0)
	if tag == ETag(id, 1) || tag == ETag(uuid.New(), 0) || tag == pipelineconfig.ETag(id, 0) || tag == deliveryconfig.ETag(id, 0) || !strings.HasPrefix(tag, `"`) {
		t.Fatal("tag not isolated")
	}
	if !(Configuration{}).Equal(Configuration{}) {
		t.Fatal("null equality")
	}
	a := Configuration{RequestDate: text("2026-10-16"), HiringHeadcount: count(2)}
	if !a.Equal(Configuration{RequestDate: text("2026-10-16"), HiringHeadcount: count(2)}) || a.Equal(Configuration{}) || a.Equal(Configuration{RequestDate: text("2026-10-15"), HiringHeadcount: count(2)}) || a.Equal(Configuration{RequestDate: text("2026-10-16"), HiringHeadcount: count(3)}) {
		t.Fatal("value equality")
	}
}
