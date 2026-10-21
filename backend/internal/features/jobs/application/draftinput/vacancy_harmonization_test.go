package draftinput

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
)

func TestVacancyHarmonizationLanguageBoundariesAndPaths(t *testing.T) {
	items := make([]any, 0, 21)
	for _, item := range languages.All()[:21] {
		items = append(items, map[string]any{languages.CodeField: item.Code, "min_level": "A1"})
	}
	for _, n := range []int{20, 21} {
		body, _ := json.Marshal(map[string]any{"fields": map[string]any{"languages": items[:n]}})
		_, err := DecodePatchV2(body)
		if n == 20 && err != nil {
			t.Fatal(err)
		}
		if n == 21 && !errors.Is(err, ErrValidation) {
			t.Fatalf("21 items: %v", err)
		}
	}
	for _, level := range languages.LanguageLevels() {
		_, err := DecodePatchV2([]byte(`{"fields":{"languages":[{"code":"en","min_level":"` + level + `"}]}}`))
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, tt := range []struct {
		raw, path  string
		structural bool
	}{
		{`null`, "languages", false},
		{`{}`, "languages", false},
		{`[null]`, "languages[0]", false},
		{`[{"min_level":"B2"}]`, "languages[0].code", false},
		{`[{"code":"en"}]`, "languages[0].min_level", false},
		{`[{"code":null,"min_level":"B2"}]`, "languages[0].code", false},
		{`[{"code":"EN","min_level":"B2"}]`, "languages[0].code", false},
		{`[{"code":" en","min_level":"B2"}]`, "languages[0].code", false},
		{`[{"code":"en","min_level":"b2"}]`, "languages[0].min_level", false},
		{`[{"code":"en","min_level":" B2"}]`, "languages[0].min_level", false},
		{`[{"code":"en","min_level":2}]`, "languages[0].min_level", false},
		{`[{"code":"en","min_level":"B2","level":"advanced"}]`, "languages[0].level", true},
		{`[{"code":"en","min_level":"B2"},{"code":"en","min_level":"C1"}]`, "languages[1].code", false},
	} {
		t.Run(tt.raw, func(t *testing.T) {
			_, err := DecodePatchV2([]byte(`{"fields":{"languages":` + tt.raw + `}}`))
			want := ErrValidation
			if tt.structural {
				want = ErrInvalidRequest
			}
			if !errors.Is(err, want) || !strings.Contains(err.Error(), tt.path) {
				t.Fatalf("%v: want %v at %s", err, want, tt.path)
			}
		})
	}
}

func TestVacancyHarmonizationPatchPersistedRoundTrip(t *testing.T) {
	created, err := DecodeCreateV2([]byte(`{"fields":{"title":"Keep me"}}`))
	if err != nil {
		t.Fatal(err)
	}
	value, _ := draftjson.Decode(created.Fingerprint())
	root := value.(map[string]any)
	fields := root["fields"].(map[string]any)
	patch, err := DecodePatchV2([]byte(`{"fields":{"min_years_of_experience":"60.0","min_education_level":"phd","accepts_in_progress_education":true,"seniority":"director","languages":[{"code":"nah","min_level":"C2"}]}}`))
	if err != nil {
		t.Fatal(err)
	}
	delta, _ := draftjson.Decode(patch.Fingerprint())
	for key, value := range delta.(map[string]any)["fields"].(map[string]any) {
		fields[key] = value
	}
	encoded, _ := draftjson.EncodeValidatedValue(root)
	if err := ValidatePersistedDraftV2(encoded); err != nil {
		t.Fatal(err)
	}
	if fields["title"] != "Keep me" || fields["min_years_of_experience"] != "60" {
		t.Fatalf("unexpected fields: %v", fields)
	}
	for _, key := range []string{"min_years_of_experience", "min_education_level", "accepts_in_progress_education"} {
		value := fields[key]
		delete(fields, key)
		encoded, _ = draftjson.EncodeValidatedValue(root)
		if err := ValidatePersistedDraftV2(encoded); !errors.Is(err, ErrPersistedDraftRoot) {
			t.Fatalf("missing %s: %v", key, err)
		}
		fields[key] = value
	}
	fields["min_years_of_experience"] = "60.0"
	encoded, _ = draftjson.EncodeValidatedValue(root)
	if err := ValidatePersistedDraftV2(encoded); !errors.Is(err, ErrPersistedDraftNonCanonical) {
		t.Fatalf("noncanonical years: %v", err)
	}
}

func TestVacancyHarmonizationCreatePersistedRoundTrip(t *testing.T) {
	body := []byte(`{"fields":{"seniority":"semi_senior","languages":[{"code":"en","min_level":"B2"}],"min_years_of_experience":"2.0","min_education_level":"bachelor","accepts_in_progress_education":true}}`)
	created, err := DecodeCreateV2(body)
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidatePersistedDraftV2(created.Fingerprint()); err != nil {
		t.Fatal(err)
	}
	value, err := draftjson.Decode(created.Fingerprint())
	if err != nil {
		t.Fatal(err)
	}
	fields := value.(map[string]any)["fields"].(map[string]any)
	if fields["min_years_of_experience"] != "2" {
		t.Fatalf("years not canonical: %v", fields["min_years_of_experience"])
	}
	if fields["accepts_in_progress_education"] != true {
		t.Fatal("lost education flag")
	}
}

func TestVacancyHarmonizationCreateDefaults(t *testing.T) {
	created, err := DecodeCreateV2([]byte(`{"fields":{}}`))
	if err != nil {
		t.Fatal(err)
	}
	value, err := draftjson.Decode(created.Fingerprint())
	if err != nil {
		t.Fatal(err)
	}
	fields := value.(map[string]any)["fields"].(map[string]any)
	for _, key := range []string{"min_years_of_experience", "min_education_level"} {
		if value, ok := fields[key]; !ok || value != nil {
			t.Errorf("%s = %v, present %v; want null", key, value, ok)
		}
	}
	if fields["accepts_in_progress_education"] != false {
		t.Fatal("education flag must default false")
	}
}

func TestVacancyHarmonizationPatchValidation(t *testing.T) {
	for _, tt := range []struct {
		name, fields string
		valid        bool
	}{
		{"intern", `"seniority":"intern"`, true},
		{"junior", `"seniority":"junior"`, true},
		{"semi senior", `"seniority":"semi_senior"`, true},
		{"senior", `"seniority":"senior"`, true},
		{"lead", `"seniority":"lead"`, true},
		{"manager", `"seniority":"manager"`, true},
		{"director", `"seniority":"director"`, true},
		{"null seniority", `"seniority":null`, true},
		{"old mid", `"seniority":"mid"`, false},
		{"case seniority", `"seniority":"Senior"`, false},
		{"trim seniority", `"seniority":" senior"`, false},
		{"years zero", `"min_years_of_experience":"0"`, true},
		{"years decimal", `"min_years_of_experience":"1.5"`, true},
		{"years max", `"min_years_of_experience":"60"`, true},
		{"years null", `"min_years_of_experience":null`, true},
		{"years above max", `"min_years_of_experience":"60.1"`, false},
		{"years negative", `"min_years_of_experience":"-1"`, false},
		{"years leading zero", `"min_years_of_experience":"01"`, false},
		{"years precision", `"min_years_of_experience":"1.50"`, false},
		{"years numeric", `"min_years_of_experience":1`, false},
		{"education null", `"min_education_level":null`, true},
		{"education secondary", `"min_education_level":"secondary"`, true},
		{"education high school", `"min_education_level":"high_school"`, true},
		{"education technical", `"min_education_level":"technical"`, true},
		{"education tsu", `"min_education_level":"tsu"`, true},
		{"education bachelor", `"min_education_level":"bachelor"`, true},
		{"education specialty", `"min_education_level":"specialty"`, true},
		{"education master", `"min_education_level":"master"`, true},
		{"education phd", `"min_education_level":"phd"`, true},
		{"education invalid", `"min_education_level":"college"`, false},
		{"flag true without minimum", `"accepts_in_progress_education":true`, true},
		{"flag false", `"accepts_in_progress_education":false`, true},
		{"flag null", `"accepts_in_progress_education":null`, false},
		{"flag string", `"accepts_in_progress_education":"false"`, false},
		{"languages empty", `"languages":[]`, true},
		{"languages null", `"languages":null`, false},
		{"language catalog", `"languages":[{"code":"nah","min_level":"native"}]`, true},
		{"language unknown", `"languages":[{"code":"xx","min_level":"B2"}]`, false},
		{"language null level", `"languages":[{"code":"en","min_level":null}]`, false},
		{"language old level", `"languages":[{"code":"en","min_level":"advanced"}]`, false},
		{"language duplicate", `"languages":[{"code":"en","min_level":"B2"},{"code":"en","min_level":"C1"}]`, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := DecodePatchV2([]byte(`{"fields":{` + tt.fields + `}}`))
			if tt.valid && err != nil {
				t.Fatal(err)
			}
			if !tt.valid && !errors.Is(err, ErrValidation) {
				t.Fatalf("got %v, want field validation error", err)
			}
		})
	}
}
