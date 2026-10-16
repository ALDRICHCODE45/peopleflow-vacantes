package deliveryconfig

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func str(s string) *string    { return &s }
func quantity(n int64) *int64 { return &n }
func testCalendar(t *testing.T, instant string) Calendar {
	t.Helper()
	zone, err := time.LoadLocation(TimeZone)
	if err != nil {
		t.Fatal(err)
	}
	now, err := time.Parse(time.RFC3339, instant)
	if err != nil {
		t.Fatal(err)
	}
	return CalendarAt(now, zone)
}
func TestReplace_StrictDocument(t *testing.T) {
	p := pipelineconfig.Defaults(uuid.New())
	cal := testCalendar(t, "2026-10-16T18:00:00Z")
	cases := []struct{ name, body string }{
		{"missing all", `{}`}, {"missing date", `{"cutoffStageId":null,"targetQuantity":null}`},
		{"unknown", `{"cutoffStageId":null,"targetQuantity":null,"commitmentDate":null,"extra":1}`},
		{"replaced key", `{"cutoffStageId":null,"targetQuantity":null,"date":null}`},
		{"duplicate", `{"cutoffStageId":null,"targetQuantity":null,"commitmentDate":null,"commitment\u0044ate":null}`},
		{"null root", `null`}, {"array", `[]`}, {"truncated", `{"`},
		{"trailing", `{"cutoffStageId":null,"targetQuantity":null,"commitmentDate":null}{}`},
		{"cutoff number", `{"cutoffStageId":1,"targetQuantity":null,"commitmentDate":null}`},
		{"cutoff bool", `{"cutoffStageId":false,"targetQuantity":null,"commitmentDate":null}`},
		{"target string", `{"cutoffStageId":null,"targetQuantity":"5","commitmentDate":null}`},
		{"target bool", `{"cutoffStageId":null,"targetQuantity":true,"commitmentDate":null}`},
		{"fraction", `{"cutoffStageId":null,"targetQuantity":1.5,"commitmentDate":null}`},
		{"date number", `{"cutoffStageId":null,"targetQuantity":null,"commitmentDate":20261016}`},
		{"malformed date", `{"cutoffStageId":null,"targetQuantity":null,"commitmentDate":"2026-02-30"}`},
		{"non padded date", `{"cutoffStageId":null,"targetQuantity":null,"commitmentDate":"2026-1-1"}`},
		{"date timestamp", `{"cutoffStageId":null,"targetQuantity":null,"commitmentDate":"2026-10-16T00:00:00Z"}`},
		{"invalid utf8", "{\"cutoffStageId\":null,\"targetQuantity\":null,\"commitmentDate\":\"\xff\"}"},
		{"invalid surrogate", `{"cutoffStageId":null,"targetQuantity":null,"commitmentDate":"\uD800"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Replace(Configuration{}, p, []byte(tc.body), cal)
			if !errors.Is(err, drafts.ErrInvalidRequest) || !reflect.DeepEqual(got, Configuration{}) {
				t.Fatalf("got %+v err %v", got, err)
			}
		})
	}
	_, err := Replace(Configuration{}, p, []byte(strings.Repeat("x", MaxBodyBytes+1)), cal)
	if !errors.Is(err, drafts.ErrPayloadTooLarge) {
		t.Fatal(err)
	}
}

func TestReplace_ValidationAndDateOnChange(t *testing.T) {
	p := pipelineconfig.Defaults(uuid.New())
	cal := testCalendar(t, "2026-10-16T18:00:00Z")
	cases := []struct {
		name          string
		current, next Configuration
		want          error
	}{
		{"all null", Configuration{}, Configuration{}, nil},
		{"target minimum", Configuration{}, Configuration{TargetQuantity: quantity(1)}, nil},
		{"target maximum", Configuration{}, Configuration{TargetQuantity: quantity(999)}, nil},
		{"zero", Configuration{}, Configuration{TargetQuantity: quantity(0)}, drafts.ErrValidation},
		{"negative", Configuration{}, Configuration{TargetQuantity: quantity(-1)}, drafts.ErrValidation},
		{"over maximum", Configuration{}, Configuration{TargetQuantity: quantity(1000)}, drafts.ErrValidation},
		{"unknown cutoff", Configuration{}, Configuration{CutoffStageID: str(uuid.NewString())}, drafts.ErrValidation},
		{"discarded", Configuration{}, Configuration{CutoffStageID: str(p.Exit.ID)}, drafts.ErrValidation},
		{"bad cutoff", Configuration{}, Configuration{CutoffStageID: str("bad")}, drafts.ErrValidation},
		{"today inclusive", Configuration{}, Configuration{CommitmentDate: str("2026-10-16")}, nil},
		{"upper inclusive business", Configuration{}, Configuration{CommitmentDate: str("2027-10-15")}, nil},
		{"before window", Configuration{}, Configuration{CommitmentDate: str("2026-10-15")}, drafts.ErrValidation},
		{"after window", Configuration{}, Configuration{CommitmentDate: str("2027-10-18")}, drafts.ErrValidation},
		{"weekend", Configuration{}, Configuration{CommitmentDate: str("2026-10-17")}, ErrNonBusinessDate},
		{"holiday", Configuration{}, Configuration{CommitmentDate: str("2026-11-16")}, ErrNonBusinessDate},
		{"unchanged past", Configuration{CommitmentDate: str("2025-10-01")}, Configuration{TargetQuantity: quantity(5), CommitmentDate: str("2025-10-01")}, nil},
		{"unchanged future", Configuration{CommitmentDate: str("2030-10-01")}, Configuration{CommitmentDate: str("2030-10-01")}, nil},
		{"clear past", Configuration{CommitmentDate: str("2025-10-01")}, Configuration{}, nil},
	}
	for _, stage := range p.Stages {
		cases = append(cases, struct {
			name          string
			current, next Configuration
			want          error
		}{"progression " + stage.Kind, Configuration{}, Configuration{CutoffStageID: str(stage.ID)}, nil})
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body, err := json.Marshal(tc.next)
			if err != nil {
				t.Fatal(err)
			}
			before, marshalErr := json.Marshal(tc.current)
			if marshalErr != nil {
				t.Fatal(marshalErr)
			}
			got, err := Replace(tc.current, p, body, cal)
			if !errors.Is(err, tc.want) {
				t.Fatalf("got %v want %v", err, tc.want)
			}
			if err == nil && !got.Equal(tc.next) {
				t.Fatalf("got %+v want %+v", got, tc.next)
			}
			after, marshalErr := json.Marshal(tc.current)
			if marshalErr != nil {
				t.Fatal(marshalErr)
			}
			if string(before) != string(after) {
				t.Fatal("mutated current")
			}
		})
	}
}

func TestCalendarAt_MexicoCityAndLeapClamp(t *testing.T) {
	cal := testCalendar(t, "2026-10-17T03:00:00Z")
	if cal.TimeZone != TimeZone || cal.Today != "2026-10-16" || cal.MinDate != cal.Today || cal.MaxDate != "2027-10-16" {
		t.Fatalf("calendar=%+v", cal)
	}
	leap := testCalendar(t, "2028-02-29T18:00:00Z")
	if leap.MaxDate != "2029-02-28" {
		t.Fatalf("leap=%+v", leap)
	}
	p := pipelineconfig.Defaults(uuid.New())
	for _, tc := range []struct {
		name, date string
		want       error
	}{{"max inclusive", "2029-02-28", nil}, {"beyond max", "2029-03-01", drafts.ErrValidation}} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Replace(Configuration{}, p, []byte(`{"cutoffStageId":null,"targetQuantity":null,"commitmentDate":"`+tc.date+`"}`), leap)
			if !errors.Is(err, tc.want) {
				t.Fatal(err)
			}
		})
	}
	if len(cal.NonBusinessDates) == 0 {
		t.Fatal("missing exclusions")
	}
	last := ""
	for _, s := range cal.NonBusinessDates {
		if s < cal.MinDate || s > cal.MaxDate || s <= last {
			t.Fatalf("bad date %s after %s", s, last)
		}
		last = s
	}
	raw, err := json.Marshal(cal)
	if err != nil {
		t.Fatal(err)
	}
	var keys map[string]any
	if err := json.Unmarshal(raw, &keys); err != nil {
		t.Fatal(err)
	}
	if len(keys) != 5 {
		t.Fatalf("calendar keys=%s", raw)
	}
}

func TestEqual(t *testing.T) {
	a := Configuration{CutoffStageID: str(uuid.NewString()), TargetQuantity: quantity(5), CommitmentDate: str("2026-10-16")}
	b := Configuration{CutoffStageID: str(*a.CutoffStageID), TargetQuantity: quantity(5), CommitmentDate: str("2026-10-16")}
	if !a.Equal(b) || a.Equal(Configuration{}) {
		t.Fatal("equality must compare values")
	}
	for _, changed := range []Configuration{
		{TargetQuantity: quantity(5), CommitmentDate: str("2026-10-16")},
		{CutoffStageID: str(*a.CutoffStageID), CommitmentDate: str("2026-10-16")},
		{CutoffStageID: str(*a.CutoffStageID), TargetQuantity: quantity(5)},
		{CutoffStageID: str(uuid.NewString()), TargetQuantity: quantity(5), CommitmentDate: str("2026-10-16")},
		{CutoffStageID: str(*a.CutoffStageID), TargetQuantity: quantity(6), CommitmentDate: str("2026-10-16")},
		{CutoffStageID: str(*a.CutoffStageID), TargetQuantity: quantity(5), CommitmentDate: str("2026-10-19")},
	} {
		if a.Equal(changed) || changed.Equal(a) {
			t.Fatalf("unequal values treated as no-op: %+v", changed)
		}
	}
}

func TestReplace_NullCombinationsCustomCutoffAndCanonicalNoOp(t *testing.T) {
	p := pipelineconfig.Defaults(uuid.New())
	custom := pipelineconfig.Stage{ID: uuid.NewString(), Kind: "custom", Name: "Prueba"}
	p.Stages = append(p.Stages[:4], custom, p.Stages[4])
	cal := testCalendar(t, "2026-10-16T18:00:00Z")
	for mask := range 8 {
		t.Run(string(rune('0'+mask)), func(t *testing.T) {
			var want Configuration
			if mask&1 != 0 {
				want.CutoffStageID = str(custom.ID)
			}
			if mask&2 != 0 {
				want.TargetQuantity = quantity(5)
			}
			if mask&4 != 0 {
				want.CommitmentDate = str("2026-10-16")
			}
			body, err := json.Marshal(want)
			if err != nil {
				t.Fatal(err)
			}
			got, err := Replace(Configuration{}, p, body, cal)
			if err != nil || !got.Equal(want) {
				t.Fatalf("combination=%+v err=%v", got, err)
			}
		})
	}
	current := Configuration{CutoffStageID: str(custom.ID)}
	next, err := Replace(current, p, []byte(`{"cutoffStageId":"`+strings.ToUpper(custom.ID)+`","targetQuantity":null,"commitmentDate":null}`), cal)
	if err != nil || !next.Equal(current) {
		t.Fatalf("canonical no-op=%+v err=%v", next, err)
	}
	for _, number := range []string{"1.0", "100e-2"} {
		t.Run(number, func(t *testing.T) {
			next, err := Replace(Configuration{}, p, []byte(`{"cutoffStageId":null,"targetQuantity":`+number+`,"commitmentDate":null}`), cal)
			if err != nil || next.TargetQuantity == nil || *next.TargetQuantity != 1 {
				t.Fatalf("integral JSON=%+v err=%v", next, err)
			}
		})
	}
}
