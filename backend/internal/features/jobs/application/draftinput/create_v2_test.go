package draftinput

import (
	"bytes"
	"encoding/json"
	"errors"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftfields"
)

// This file specifies the screening v2 create codec DecodeCreateV2: the exact
// {"fields": {...}} envelope with no client schema marker, create defaults for
// the unchanged groups, the typed v2 screening projection and the canonical
// {"schema_version": 2, "fields": {...complete 17 fields...}} fingerprint.

// Established v1 goldens. The fields subtree is the contract-derived canonical
// projection of an empty v1/v2 create (every omitted group defaulted), and the
// two roots differ only by the schema marker.
const (
	emptyCreateFieldsCanonical = `"fields":{"benefits":[],"compensation":{"amount":null,"basis":null,"currency":"MXN","max":null,"min":null,"mode":null,"pay_period":"monthly","public_visible":false},"contract_type":null,"custom_benefits":[],"description":null,"languages":[],"location":null,"preferred_requirements":null,"professional_area":null,"remote_scope":null,"requester":null,"required_requirements":null,"screening_questions":[],"seniority":null,"skills":[],"title":null,"work_mode":null,"work_schedule":null}`

	v1CreateGolden = `{` + emptyCreateFieldsCanonical + `,"schema_version":1}`
	v2CreateGolden = `{"fields":{"accepts_in_progress_education":false,"benefits":[],"compensation":{"amount":null,"basis":null,"currency":"MXN","max":null,"min":null,"mode":null,"pay_period":"monthly","public_visible":false},"contract_type":null,"custom_benefits":[],"description":null,"languages":[],"location":null,"min_education_level":null,"min_years_of_experience":null,"preferred_requirements":null,"professional_area":null,"remote_scope":null,"requester":null,"required_requirements":null,"screening_questions":[],"seniority":null,"skills":[],"title":null,"work_mode":null,"work_schedule":null},"schema_version":2}`
)

// Screening v2 fixture identifiers.
const (
	v2OpenID         = "11111111-1111-4111-8111-111111111111"
	v2InfoID         = "22222222-2222-4222-8222-222222222222"
	v2EvalID         = "55555555-5555-4555-8555-555555555555"
	v2OptionRemoteID = "33333333-3333-4333-8333-333333333333"
	v2OptionHybridID = "44444444-4444-4444-8444-444444444444"
	v2OptionJuniorID = "66666666-6666-4666-8666-666666666666"
	v2OptionSeniorID = "77777777-7777-4777-8777-777777777777"
)

// createV2ThreeVariants is the screening_questions array with one question of
// each typed variant.
const createV2ThreeVariants = `[` +
	`{"id":"` + v2OpenID + `","type":"open","prompt":"¿Disponibilidad?"},` +
	`{"id":"` + v2InfoID + `","type":"single_choice_informative","prompt":"Modalidad","options":[` +
	`{"id":"` + v2OptionRemoteID + `","label":"Remoto"},` +
	`{"id":"` + v2OptionHybridID + `","label":"Híbrido"}]},` +
	`{"id":"` + v2EvalID + `","type":"single_choice_evaluated","prompt":"Nivel","options":[` +
	`{"id":"` + v2OptionJuniorID + `","label":"Junior"},` +
	`{"id":"` + v2OptionSeniorID + `","label":"Senior"}],` +
	`"correct_option_id":"` + v2OptionSeniorID + `"}]`

// createV2AllBody populates all 17 groups with the three screening variants.
const createV2AllBody = `{"fields":{` +
	`"title":"Backend Go",` +
	`"location":{"country":"MX"},` +
	`"work_mode":"remote",` +
	`"work_schedule":"full_time",` +
	`"contract_type":"indefinite",` +
	`"seniority":"senior",` +
	`"professional_area":"technology_systems",` +
	`"requester":{"kind":"client","id":"11111111-2222-3333-4444-555555555555"},` +
	`"skills":["Go","Postgres"],` +
	`"languages":[{"code":"es","min_level":"native"}],` +
	`"benefits":["health_insurance"],` +
	`"custom_benefits":["Viajes"],` +
	`"required_requirements":"5 años",` +
	`"preferred_requirements":"Kubernetes",` +
	`"screening_questions":` + createV2ThreeVariants + `,` +
	`"compensation":{"mode":"range","amount":null,"min":"30000","max":"45000.5","currency":"MXN","pay_period":"monthly","basis":"gross","public_visible":false},` +
	`"description":` + docText + `}}`

func mustCreateV2(t *testing.T, body string) CreateV2 {
	t.Helper()
	create, err := DecodeCreateV2([]byte(body))
	if err != nil {
		t.Fatalf("DecodeCreateV2(%s): %v", body, err)
	}
	return create
}

// TestDecodeCreateV2_ExactRootAndClientMarkerRejected covers S2/S5-1: the only
// accepted envelope is exactly {"fields": {...}}; a client schema marker and
// every other root shape are request errors.
func TestDecodeCreateV2_ExactRootAndClientMarkerRejected(t *testing.T) {
	for _, body := range []string{
		`{"schema_version":2,"fields":{}}`,
		`{"schema_version":1,"fields":{}}`,
		`{"fields":{},"extra":1}`,
		`{"fields":[]}`,
		`{}`,
		`{"fields":{}`,
		`null`,
	} {
		t.Run(body, func(t *testing.T) {
			_, err := DecodeCreateV2([]byte(body))
			if !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("err = %v, want ErrInvalidRequest", err)
			}
			if errors.Is(err, ErrValidation) {
				t.Errorf("err = %v, must not be ErrValidation", err)
			}
		})
	}
}

// TestDecodeCreateV2_CompleteDefaults covers S3/S5-2: an empty body is accepted
// and every omitted group receives its create default, leaving the legacy v1
// ScreeningQuestions unset while the typed v2 result is a non-nil empty array.
func TestDecodeCreateV2_CompleteDefaults(t *testing.T) {
	create := mustCreateV2(t, `{"fields":{}}`)

	for _, key := range writableKeys {
		switch key {
		case "location", "remote_scope", "requester", "skills", "languages", "benefits", "custom_benefits", "screening_questions", "compensation", "description":
			continue
		}
		requireNull(t, key, scalarOptionalFor(create.Fields, key))
	}
	requireEmptyStringSlice(t, "skills", create.Skills)
	requireEmptyStringSlice(t, "benefits", create.Benefits)
	requireEmptyStringSlice(t, "custom_benefits", create.CustomBenefits)
	if !create.Languages.Set || !create.Languages.Valid || len(create.Languages.Value) != 0 {
		t.Errorf("languages = %+v, want present non-nil empty slice", create.Languages)
	}
	if !create.Requester.Set || create.Requester.Valid {
		t.Errorf("requester = %+v, want present null", create.Requester)
	}
	requireCompensationDefaults(t, create.Compensation)
	if !create.Description.Set || create.Description.Valid {
		t.Errorf("description = %+v, want present null", create.Description)
	}

	// The legacy v1 screening container must never be populated by v2.
	if create.Fields.ScreeningQuestions.Set {
		t.Errorf("legacy ScreeningQuestions = %+v, want unset", create.Fields.ScreeningQuestions)
	}
	if create.ScreeningQuestionsV2 == nil || len(create.ScreeningQuestionsV2) != 0 {
		t.Errorf("ScreeningQuestionsV2 = %+v, want non-nil empty slice", create.ScreeningQuestionsV2)
	}

	// Exact canonical fingerprint: complete 17 fields under schema 2.
	if got := string(create.Fingerprint()); got != v2CreateGolden {
		t.Errorf("fingerprint = %s, want %s", got, v2CreateGolden)
	}
}

// TestDecodeCreateV2_AllFieldsAndVariants covers S3/S5-3: all 17 groups are
// populated, all three screening variants are projected with exact per-variant
// keys, and the resulting schema-2 fingerprint is accepted by the persisted
// validator.
func TestDecodeCreateV2_AllFieldsAndVariants(t *testing.T) {
	create := mustCreateV2(t, createV2AllBody)

	requireString(t, "title", create.Title, "Backend Go")
	requireString(t, "required_requirements", create.RequiredRequirements, "5 años")
	if want := []string{"Go", "Postgres"}; !slices.Equal(create.Skills.Value, want) {
		t.Errorf("skills = %v, want %v", create.Skills.Value, want)
	}
	if create.Requester.Value == nil || create.Requester.Value.Kind != "client" {
		t.Fatalf("requester = %+v, want client value", create.Requester)
	}

	questions := create.ScreeningQuestionsV2
	if len(questions) != 3 {
		t.Fatalf("questions = %+v, want 3", questions)
	}
	if questions[0].ID != v2OpenID || questions[0].Type != "open" || questions[0].Prompt != "¿Disponibilidad?" {
		t.Errorf("open = %+v", questions[0])
	}
	if questions[0].Options != nil || questions[0].CorrectOptionID != "" {
		t.Errorf("open must have no options/correct_option_id: %+v", questions[0])
	}
	if want := []draftfields.ScreeningOptionV2{{ID: v2OptionRemoteID, Label: "Remoto"}, {ID: v2OptionHybridID, Label: "Híbrido"}}; !slices.Equal(questions[1].Options, want) {
		t.Errorf("informative options = %+v, want %v", questions[1].Options, want)
	}
	if questions[1].CorrectOptionID != "" {
		t.Errorf("informative must have no correct_option_id: %+v", questions[1])
	}
	if questions[2].CorrectOptionID != v2OptionSeniorID {
		t.Errorf("evaluated correct_option_id = %q, want %q", questions[2].CorrectOptionID, v2OptionSeniorID)
	}

	// Byte-exact complete-17-field schema-2 fingerprint, compared against an
	// independent contract fixture marshaled by the standard library JSON
	// encoder, not by any candidate helper.
	want, err := json.Marshal(expectedCreateV2AllDocument())
	if err != nil {
		t.Fatalf("marshal expected document: %v", err)
	}
	fp := create.Fingerprint()
	if !bytes.Equal(fp, want) {
		t.Errorf("fingerprint =\n%s\nwant\n%s", fp, want)
	}

	// The independent persisted validator must also accept the fingerprint.
	if err := ValidatePersistedDraftV2(fp); err != nil {
		t.Errorf("ValidatePersistedDraftV2(fingerprint) = %v, want nil", err)
	}
}

// expectedCreateV2AllDocument builds, from the contract alone, the complete
// canonical schema-2 document of createV2AllBody. It is marshaled in the test
// by the standard library JSON encoder, so it is an oracle independent of the
// codec under test.
func expectedCreateV2AllDocument() map[string]any {
	return map[string]any{
		"schema_version": int64(2),
		"fields": map[string]any{
			"title":                         "Backend Go",
			"location":                      map[string]any{"country": "MX"},
			"remote_scope":                  nil,
			"work_mode":                     "remote",
			"work_schedule":                 "full_time",
			"contract_type":                 "indefinite",
			"seniority":                     "senior",
			"professional_area":             "technology_systems",
			"requester":                     map[string]any{"kind": "client", "id": "11111111-2222-3333-4444-555555555555"},
			"skills":                        []any{"Go", "Postgres"},
			"languages":                     []any{map[string]any{"code": "es", "min_level": "native"}},
			"min_years_of_experience":       nil,
			"min_education_level":           nil,
			"accepts_in_progress_education": false,
			"benefits":                      []any{"health_insurance"},
			"custom_benefits":               []any{"Viajes"},
			"required_requirements":         "5 años",
			"preferred_requirements":        "Kubernetes",
			"screening_questions": []any{
				map[string]any{"id": v2OpenID, "type": "open", "prompt": "¿Disponibilidad?"},
				map[string]any{"id": v2InfoID, "type": "single_choice_informative", "prompt": "Modalidad", "options": []any{
					map[string]any{"id": v2OptionRemoteID, "label": "Remoto"},
					map[string]any{"id": v2OptionHybridID, "label": "Híbrido"},
				}},
				map[string]any{"id": v2EvalID, "type": "single_choice_evaluated", "prompt": "Nivel", "options": []any{
					map[string]any{"id": v2OptionJuniorID, "label": "Junior"},
					map[string]any{"id": v2OptionSeniorID, "label": "Senior"},
				}, "correct_option_id": v2OptionSeniorID},
			},
			"compensation": map[string]any{
				"mode": "range", "amount": nil, "min": "30000.00", "max": "45000.50",
				"currency": "MXN", "pay_period": "monthly", "basis": "gross", "public_visible": false,
			},
			"description": map[string]any{
				"schema_version": int64(1),
				"document": map[string]any{
					"type": "doc",
					"content": []any{
						map[string]any{
							"type":    "paragraph",
							"content": []any{map[string]any{"type": "text", "text": "Hola"}},
						},
					},
				},
			},
		},
	}
}

// TestDecodeCreateV2_ScreeningNormalization covers S3/S5-4: prompt and label
// are end-trimmed, the submitted UUID spelling is preserved and the exact
// correct_option_id membership is kept.
func TestDecodeCreateV2_ScreeningNormalization(t *testing.T) {
	upperID := "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"
	body := `{"fields":{"screening_questions":[` +
		`{"id":"` + upperID + `","type":"open","prompt":"  ¿Disponibilidad?  "},` +
		`{"id":"` + v2InfoID + `","type":"single_choice_informative","prompt":" Modalidad ","options":[` +
		`{"id":"` + v2OptionRemoteID + `","label":" Remoto "},` +
		`{"id":"` + v2OptionHybridID + `","label":" Híbrido "}]}]}}`
	create := mustCreateV2(t, body)

	if got := create.ScreeningQuestionsV2[0]; got.ID != upperID || got.Prompt != "¿Disponibilidad?" {
		t.Errorf("open = %+v, want trimmed prompt and preserved upper UUID", got)
	}
	if got := create.ScreeningQuestionsV2[1].Options; got[0].Label != "Remoto" || got[1].Label != "Híbrido" {
		t.Errorf("labels = %+v, want trimmed", got)
	}
	// The canonical fingerprint normalizes the text, so the persisted canonical
	// validator must accept it.
	if err := ValidatePersistedDraftV2(create.Fingerprint()); err != nil {
		t.Errorf("ValidatePersistedDraftV2 = %v, want nil", err)
	}
}

// TestDecodeCreateV2_ScreeningStructuralVersusValue covers S2/S5-5: a missing
// or unknown variant key is a structural request error while a recognized bad
// value is a validation error.
func TestDecodeCreateV2_ScreeningStructuralVersusValue(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		structural bool
	}{
		{"missing type", `{"fields":{"screening_questions":[{"id":"` + v2OpenID + `","prompt":"P"}]}}`, true},
		{"missing prompt", `{"fields":{"screening_questions":[{"id":"` + v2OpenID + `","type":"open"}]}}`, true},
		{"unknown key", `{"fields":{"screening_questions":[{"id":"` + v2OpenID + `","type":"open","prompt":"P","extra":1}]}}`, true},
		{"forbidden null key", `{"fields":{"screening_questions":[{"id":"` + v2OpenID + `","type":"open","prompt":"P","options":null}]}}`, true},
		{"unknown nested option key", `{"fields":{"screening_questions":[{"id":"` + v2InfoID + `","type":"single_choice_informative","prompt":"P","options":[{"id":"` + v2OptionRemoteID + `","label":"A","extra":1},{"id":"` + v2OptionHybridID + `","label":"B"}]}]}}`, true},
		{"empty prompt", `{"fields":{"screening_questions":[{"id":"` + v2OpenID + `","type":"open","prompt":"   "}]}}`, false},
		{"invalid uuid", `{"fields":{"screening_questions":[{"id":"nope","type":"open","prompt":"P"}]}}`, false},
		{"invalid type", `{"fields":{"screening_questions":[{"id":"` + v2OpenID + `","type":"yes_no","prompt":"P"}]}}`, false},
		{"too few options", `{"fields":{"screening_questions":[{"id":"` + v2InfoID + `","type":"single_choice_informative","prompt":"P","options":[{"id":"` + v2OptionRemoteID + `","label":"A"}]}]}}`, false},
		{"correct id not member", `{"fields":{"screening_questions":[{"id":"` + v2EvalID + `","type":"single_choice_evaluated","prompt":"P","options":[{"id":"` + v2OptionJuniorID + `","label":"A"},{"id":"` + v2OptionSeniorID + `","label":"B"}],"correct_option_id":"` + v2OptionRemoteID + `"}]}}`, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := DecodeCreateV2([]byte(tc.body))
			if tc.structural {
				if !errors.Is(err, ErrInvalidRequest) || errors.Is(err, ErrValidation) {
					t.Fatalf("err = %v, want structural ErrInvalidRequest only", err)
				}
				return
			}
			if !errors.Is(err, ErrValidation) || errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("err = %v, want value ErrValidation only", err)
			}
		})
	}
}

// TestDecodeCreateV2_ScreeningStructuralPrecedence covers S2/S5-5: a screening
// structural missing/unknown variant key is detected in the nested structural
// preflight and therefore beats an earlier-group value error, and it keeps the
// v1 nested structural ordering languages > screening > compensation >
// description. Every rejected call returns the zero result.
func TestDecodeCreateV2_ScreeningStructuralPrecedence(t *testing.T) {
	invalidScalar := `"work_mode":"teleport"`
	tests := []struct {
		name          string
		body          string
		wantScreening error
	}{
		{
			"unknown variant key beats invalid scalar",
			`{"fields":{` + invalidScalar + `,"screening_questions":[{"id":"` + v2OpenID + `","type":"open","prompt":"P","extra":1}]}}`,
			draftfields.ErrScreeningV2UnknownKey,
		},
		{
			"missing mandatory key beats invalid scalar",
			`{"fields":{` + invalidScalar + `,"screening_questions":[{"id":"` + v2OpenID + `","prompt":"P"}]}}`,
			draftfields.ErrScreeningV2MissingKey,
		},
		{
			"unknown nested option key beats invalid scalar",
			`{"fields":{` + invalidScalar + `,"screening_questions":[{"id":"` + v2InfoID + `","type":"single_choice_informative","prompt":"P","options":[{"id":"` + v2OptionRemoteID + `","label":"A","extra":1},{"id":"` + v2OptionHybridID + `","label":"B"}]}]}}`,
			draftfields.ErrScreeningV2UnknownKey,
		},
		{
			"missing mandatory option key beats invalid scalar",
			`{"fields":{` + invalidScalar + `,"screening_questions":[{"id":"` + v2InfoID + `","type":"single_choice_informative","prompt":"P","options":[{"id":"` + v2OptionRemoteID + `"},{"id":"` + v2OptionHybridID + `","label":"B"}]}]}}`,
			draftfields.ErrScreeningV2MissingKey,
		},
		{
			"requester structural wins over screening",
			`{"fields":{"requester":{"kind":"client","id":null,"extra":1},"screening_questions":[{"id":"` + v2OpenID + `","type":"open","prompt":"P","extra":1}]}}`,
			nil,
		},
		{
			"languages structural wins over screening",
			`{"fields":{"languages":[{"language":"es","custom_name":null,"level":null,"extra":1}],"screening_questions":[{"id":"` + v2OpenID + `","type":"open","prompt":"P","extra":1}]}}`,
			nil,
		},
		{
			"screening structural wins over compensation",
			`{"fields":{"screening_questions":[{"id":"` + v2OpenID + `","type":"open","prompt":"P","extra":1}],"compensation":{"mode":null,"amount":null,"min":null,"max":null,"currency":"MXN","pay_period":"monthly","basis":null,"public_visible":false,"extra":1}}}`,
			draftfields.ErrScreeningV2UnknownKey,
		},
		{
			"screening structural wins over description",
			`{"fields":{"screening_questions":[{"id":"` + v2OpenID + `","type":"open","prompt":"P","extra":1}],"description":{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"extra":1}}}`,
			draftfields.ErrScreeningV2UnknownKey,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			create, err := DecodeCreateV2([]byte(tc.body))
			if !errors.Is(err, ErrInvalidRequest) || errors.Is(err, ErrValidation) {
				t.Fatalf("err = %v, want structural ErrInvalidRequest only", err)
			}
			if tc.wantScreening != nil && !errors.Is(err, tc.wantScreening) {
				t.Errorf("err = %v, want sentinel %v", err, tc.wantScreening)
			}
			if tc.wantScreening == nil && (errors.Is(err, draftfields.ErrScreeningV2UnknownKey) || errors.Is(err, draftfields.ErrScreeningV2MissingKey)) {
				t.Errorf("err = %v, want the language structural error to win", err)
			}
			if !reflect.DeepEqual(create, CreateV2{}) {
				t.Errorf("create = %+v, want zero result", create)
			}
		})
	}
}

// TestDecodeCreateV2_ScreeningStructuralWalkPrecedence covers S2/S5-5: the
// structural preflight inspects every question and option independently of an
// earlier value error in the same group, so a later unknown/missing variant key
// still wins over an earlier empty prompt or label and precedes compensation
// and description. Every rejected call returns the zero result, never mutates
// the input bytes and preserves the exact sentinel chain.
func TestDecodeCreateV2_ScreeningStructuralWalkPrecedence(t *testing.T) {
	unknown := draftfields.ErrScreeningV2UnknownKey
	missing := draftfields.ErrScreeningV2MissingKey
	compensation := `"compensation":{"mode":null,"amount":null,"min":null,"max":null,"currency":"MXN","pay_period":"monthly","basis":null,"public_visible":false,"extra":1}`
	tests := []struct {
		name          string
		body          string
		wantScreening error
	}{
		{
			"empty first prompt then second question unknown key",
			`{"fields":{"screening_questions":[{"id":"` + v2OpenID + `","type":"open","prompt":"   "},{"id":"` + v2InfoID + `","type":"open","prompt":"P","extra":1}]}}`,
			unknown,
		},
		{
			"empty first prompt then second missing prompt",
			`{"fields":{"screening_questions":[{"id":"` + v2OpenID + `","type":"open","prompt":"   "},{"id":"` + v2InfoID + `","type":"open"}]}}`,
			missing,
		},
		{
			"empty question prompt then nested option unknown key",
			`{"fields":{"screening_questions":[{"id":"` + v2InfoID + `","type":"single_choice_informative","prompt":"   ","options":[{"id":"` + v2OptionRemoteID + `","label":"A"},{"id":"` + v2OptionHybridID + `","label":"B","extra":1}]}]}}`,
			unknown,
		},
		{
			"empty first option label then second option unknown key",
			`{"fields":{"screening_questions":[{"id":"` + v2InfoID + `","type":"single_choice_informative","prompt":"P","options":[{"id":"` + v2OptionRemoteID + `","label":"   "},{"id":"` + v2OptionHybridID + `","label":"B","extra":1}]}]}}`,
			unknown,
		},
		{
			"screening structural beats compensation structural",
			`{"fields":{"screening_questions":[{"id":"` + v2OpenID + `","type":"open","prompt":"   "},{"id":"` + v2InfoID + `","type":"open","prompt":"P","extra":1}],` + compensation + `}}`,
			unknown,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body := []byte(tc.body)
			before := slices.Clone(body)
			create, err := DecodeCreateV2(body)
			if !bytes.Equal(body, before) {
				t.Error("DecodeCreateV2 mutated the input bytes")
			}
			if !errors.Is(err, ErrInvalidRequest) || errors.Is(err, ErrValidation) {
				t.Fatalf("err = %v, want structural ErrInvalidRequest only", err)
			}
			if !errors.Is(err, tc.wantScreening) {
				t.Errorf("err = %v, want sentinel %v", err, tc.wantScreening)
			}
			if !reflect.DeepEqual(create, CreateV2{}) {
				t.Errorf("create = %+v, want zero result", create)
			}
		})
	}
}

// TestDecodeCreateV2_ShapeBudgetAndNestedReadOnly covers S2/S3/S5-6: the body
// budget, strict JSON, nested read-only keys and the unchanged description
// schema_version 1 envelope keep the inherited v1 precedence and taxonomy.
func TestDecodeCreateV2_ShapeBudgetAndNestedReadOnly(t *testing.T) {
	overLimit := []byte(`{"fields":{}}` + strings.Repeat(" ", MaxBodyBytes))
	if _, err := DecodeCreateV2(overLimit); !errors.Is(err, ErrPayloadTooLarge) {
		t.Fatalf("over limit err = %v, want ErrPayloadTooLarge", err)
	}

	invalid := []string{
		`{"fields":{"description":{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"extra":1}}}`,
		`{"fields":{"requester":{"kind":"client","id":null,"name":"x"}}}`,
		`{"fields":{"languages":[{"language":"es","custom_name":null,"level":null,"extra":1}]}}`,
		`{"fields":{"compensation":{"mode":null,"amount":null,"min":null,"max":null,"currency":"MXN","pay_period":"monthly","basis":null,"public_visible":false,"extra":1}}}`,
		`{"fields":{"screening_questions":[{"id":"` + v2OpenID + `","type":"open","prompt":"P"}]},"schema_version":2}`,
		`{"fields":{"description":{"schema_version":0,"document":{"type":"doc","content":[{"type":"paragraph"}]}}}}`,
		`{"fields":{"description":{"schema_version":2,"document":{"type":"doc","content":[{"type":"paragraph"}]}}}}`,
		`{"fields":{"description":{"schema_version":"1","document":{"type":"doc","content":[{"type":"paragraph"}]}}}}`,
		`{"fields":{"unknown_field":1}}`,
		`{"fields":{"title":"a",}}`,
	}
	for _, body := range invalid {
		t.Run(body, func(t *testing.T) {
			if _, err := DecodeCreateV2([]byte(body)); !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("err = %v, want ErrInvalidRequest", err)
			}
		})
	}

	// An integral spelling of the description schema_version 1 stays accepted.
	create := mustCreateV2(t, `{"fields":{"description":{"schema_version":1.0,"document":{"type":"doc","content":[{"type":"paragraph"}]}}}}`)
	if !create.Description.Valid || create.Description.Value == nil {
		t.Fatalf("description = %+v, want accepted document", create.Description)
	}
}

// TestDecodeCreateV2_ImmutableInputAndFingerprint covers S1/S5-7: the result is
// owned and never aliases the request bytes, and Fingerprint returns a fresh
// copy on every call.
func TestDecodeCreateV2_ImmutableInputAndFingerprint(t *testing.T) {
	body := []byte(`{"fields":{"title":"X","skills":["A","B"],"screening_questions":[{"id":"` + v2OpenID + `","type":"open","prompt":"P"}]}}`)
	create, err := DecodeCreateV2(body)
	if err != nil {
		t.Fatalf("DecodeCreateV2: %v", err)
	}
	for i := range body {
		body[i] = ' '
	}
	if create.Title.Value != "X" {
		t.Errorf("title = %q after input mutation, want X", create.Title.Value)
	}
	if want := []string{"A", "B"}; !slices.Equal(create.Skills.Value, want) {
		t.Errorf("skills = %v after input mutation, want %v", create.Skills.Value, want)
	}
	if create.ScreeningQuestionsV2[0].Prompt != "P" {
		t.Errorf("prompt = %q after input mutation, want P", create.ScreeningQuestionsV2[0].Prompt)
	}

	first := create.Fingerprint()
	if len(first) == 0 {
		t.Fatal("Fingerprint() is empty")
	}
	first[0] = '!'
	if second := create.Fingerprint(); second[0] == '!' {
		t.Error("Fingerprint() returned a slice aliasing internal state")
	}
}

// TestDecodeCreateV2_V1GoldensUnchanged covers S4/S5-8: the existing v1 create
// and patch codecs are byte-for-byte stable and still reject a typed v2
// screening question through the v1 prompt-only grammar.
func TestDecodeCreateV2_V1GoldensUnchanged(t *testing.T) {
	if got := string(mustCreate(t, `{"fields":{}}`).Fingerprint()); got != v1CreateGolden {
		t.Errorf("v1 create fingerprint = %s, want %s", got, v1CreateGolden)
	}
	if got := string(mustPatch(t, `{"fields":{"title":"X"}}`).Fingerprint()); got != `{"fields":{"title":"X"},"schema_version":1}` {
		t.Errorf("v1 patch fingerprint = %s, want the established golden", got)
	}

	for _, body := range []string{
		`{"fields":{"screening_questions":[{"id":"` + v2OpenID + `","type":"open","prompt":"P"}]}}`,
		`{"fields":{"screening_questions":[{"prompt":"P","type":"open"}]}}`,
	} {
		t.Run(body, func(t *testing.T) {
			if _, err := DecodeCreate([]byte(body)); !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("v1 typed question err = %v, want ErrInvalidRequest", err)
			}
		})
	}
}
