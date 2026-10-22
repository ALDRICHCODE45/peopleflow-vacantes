package publicjobs

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
)

func TestBuildProjectionPrivacyAndCompensation(t *testing.T) {
	for _, tc := range []struct {
		name, compensation string
		visible            bool
	}{
		{"hidden", `{"mode":"fixed","amount":"12345","min":null,"max":null,"currency":"MXN","pay_period":"monthly","basis":"gross","public_visible":false}`, false},
		{"incomplete", `{"mode":"fixed","amount":null,"min":null,"max":null,"currency":"MXN","pay_period":"monthly","basis":"gross","public_visible":true}`, false},
		{"fixed", `{"mode":"fixed","amount":"12345","min":null,"max":null,"currency":"MXN","pay_period":"monthly","basis":"gross","public_visible":true}`, true},
		{"range", `{"mode":"range","amount":null,"min":"100","max":"200","currency":"USD","pay_period":"yearly","basis":"net","public_visible":true}`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			draft, err := draftinput.DecodeCreateV2([]byte(`{"fields":{"title":"Oferta","description":{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Texto público"}]}]}},"required_requirements":"Go","preferred_requirements":"SQL","benefits":["health_insurance"],"custom_benefits":["Café"],"compensation":` + tc.compensation + `}}`))
			if err != nil {
				t.Fatal(err)
			}
			before := draft.Fingerprint()
			got, err := BuildProjection(before)
			if err != nil {
				t.Fatal(err)
			}
			if got.Title != "Oferta" || got.DescriptionPlain != "Texto público" || got.Requirements.Required == nil || *got.Requirements.Required != "Go" || !reflect.DeepEqual(got.Benefits.Custom, []string{"Café"}) {
				t.Fatalf("projection=%+v", got)
			}
			if (got.Compensation != nil) != tc.visible {
				t.Fatalf("compensation=%+v", got.Compensation)
			}
			raw, err := json.Marshal(got)
			if err != nil {
				t.Fatal(err)
			}
			for _, key := range []string{"requester", "headcount", "request_date", "delivery", "correct_option_id", "public_visible"} {
				if strings.Contains(string(raw), key) {
					t.Fatalf("private key %s: %s", key, raw)
				}
			}
			if !tc.visible && strings.Contains(string(raw), "12345") {
				t.Fatal("hidden amount leaked")
			}
			if !reflect.DeepEqual(before, draft.Fingerprint()) {
				t.Fatal("input mutated")
			}
			if tc.name == "fixed" && (*got.Compensation.Amount != "12345.00" || got.Compensation.Min != nil || got.Compensation.Max != nil) {
				t.Fatal("fixed shape")
			}
			if tc.name == "range" && (got.Compensation.Amount != nil || *got.Compensation.Min != "100.00" || *got.Compensation.Max != "200.00") {
				t.Fatal("range shape")
			}
		})
	}
}

func TestBuildProjectionEveryIncompleteCompensationIsNull(t *testing.T) {
	for _, mode := range []string{"fixed", "range"} {
		keys := []string{"mode", "currency", "pay_period", "basis"}
		if mode == "fixed" {
			keys = append(keys, "amount")
		} else {
			keys = append(keys, "min", "max")
		}
		for _, key := range keys {
			t.Run(mode+"/"+key, func(t *testing.T) {
				c := map[string]any{"mode": mode, "amount": nil, "min": nil, "max": nil, "currency": "MXN", "pay_period": "monthly", "basis": "gross", "public_visible": true}
				if mode == "fixed" {
					c["amount"] = "100.00"
				} else {
					c["min"] = "100.00"
					c["max"] = "200.00"
				}
				c[key] = nil
				if key == "mode" {
					c["amount"] = nil
					c["min"] = nil
					c["max"] = nil
				}
				body, err := json.Marshal(map[string]any{"fields": map[string]any{"compensation": c}})
				if err != nil {
					t.Fatal(err)
				}
				draft, err := draftinput.DecodeCreateV2(body)
				if err != nil {
					t.Fatal(err)
				}
				p, err := BuildProjection(draft.Fingerprint())
				if err != nil || p.Compensation != nil {
					t.Fatalf("projection=%+v error=%v", p, err)
				}
			})
		}
	}
}

func TestBuildProjectionSkillsAndScreeningCount(t *testing.T) {
	draft, err := draftinput.DecodeCreateV2([]byte(`{"fields":{"skills":[" SQL ","Go","e\u0301"],"screening_questions":[{"id":"1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d","type":"open","prompt":"Why?"}]}}`))
	if err != nil {
		t.Fatal(err)
	}
	p, err := BuildProjection(draft.Fingerprint())
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got["skills"], []any{"SQL", "Go", "e\u0301"}) || got["screening_questions"] != float64(1) {
		t.Fatalf("%s", raw)
	}
	empty, err := draftinput.DecodeCreateV2([]byte(`{"fields":{}}`))
	if err != nil {
		t.Fatal(err)
	}
	p, err = BuildProjection(empty.Fingerprint())
	if err != nil {
		t.Fatal(err)
	}
	raw, err = json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got["skills"], []any{}) || got["screening_questions"] != float64(0) {
		t.Fatalf("%s", raw)
	}
}

func TestBuildProjectionGeographyCodesAndModeSuppression(t *testing.T) {
	for _, mode := range []string{"remote", "onsite", "hybrid"} {
		t.Run(mode, func(t *testing.T) {
			draft, err := draftinput.DecodeCreateV2([]byte(`{"fields":{"work_mode":"` + mode + `","location":{"country":"MX","state":"14","municipality":"14039","postal_code":"44100"},"remote_scope":{"kind":"countries","countries":["CO","MX"]}}}`))
			if err != nil {
				t.Fatal(err)
			}
			got, err := BuildProjection(draft.Fingerprint())
			if err != nil {
				t.Fatal(err)
			}
			if got.Location == nil || got.Location.Municipality != "14039" || got.Location.PostalCode != "44100" {
				t.Fatalf("%+v", got)
			}
			if mode == "remote" {
				if got.RemoteScope == nil || !reflect.DeepEqual(got.RemoteScope.Countries, []string{"CO", "MX"}) {
					t.Fatal(got.RemoteScope)
				}
			} else if got.RemoteScope != nil {
				t.Fatal("non-remote projection leaked scope")
			}
		})
	}
}

func TestBuildProjectionRequirementsProfile(t *testing.T) {
	for _, fields := range []string{`{}`, `{"seniority":"semi_senior","languages":[{"code":"en","min_level":"B2"}],"min_years_of_experience":"1.5","min_education_level":"bachelor","accepts_in_progress_education":true}`} {
		draft, err := draftinput.DecodeCreateV2([]byte(`{"fields":` + fields + `}`))
		if err != nil {
			t.Fatal(err)
		}
		p, err := BuildProjection(draft.Fingerprint())
		if err != nil {
			t.Fatal(err)
		}
		raw, err := json.Marshal(p)
		if err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatal(err)
		}
		want := `{"languages":[],"min_years_of_experience":null,"min_education_level":null,"accepts_in_progress_education":false}`
		if fields != `{}` {
			want = `{"languages":[{"code":"en","min_level":"B2"}],"min_years_of_experience":"1.5","min_education_level":"bachelor","accepts_in_progress_education":true}`
		}
		var expected any
		if err := json.Unmarshal([]byte(want), &expected); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got["requirements_profile"], expected) {
			t.Fatalf("requirements_profile=%v want %s", got["requirements_profile"], want)
		}
		if fields != `{}` && got["seniority"] != "semi_senior" {
			t.Fatal(got["seniority"])
		}
	}
}

func TestBuildProjectionRejectsInvalidPersistedDocument(t *testing.T) {
	if _, err := BuildProjection([]byte(`{"schema_version":2,"fields":{}}`)); err == nil {
		t.Fatal("invalid persisted document accepted")
	}
}
