package draftinput

import (
	"bytes"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftfields"
	shared "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
)

// The expectations in this file describe the private vacancy draft create/PATCH
// input contract: the exact {"fields": {...}} envelope, create defaults,
// presence-only patch, full replacement of nested values, strict rejection of
// unknown/read-only keys, the 1048576-byte body budget and the canonical
// {"schema_version": 1, "fields": {...}} fingerprint.

// writableKeys lists the 17 writable field keys in contract order.
var writableKeys = []string{
	"title",
	"location",
	"work_mode",
	"work_schedule",
	"contract_type",
	"seniority",
	"professional_area",
	"requester",
	"skills",
	"languages",
	"benefits",
	"custom_benefits",
	"required_requirements",
	"preferred_requirements",
	"screening_questions",
	"compensation",
	"description",
}

const (
	docText           = `{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hola"}]}]}}`
	docEmptyParagraph = `{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]}}`
	compDefaults      = `{"mode":null,"amount":null,"min":null,"max":null,"currency":"MXN","pay_period":"monthly","basis":null,"public_visible":false}`
)

func mustCreate(t *testing.T, body string) Create {
	t.Helper()
	create, err := DecodeCreate([]byte(body))
	if err != nil {
		t.Fatalf("DecodeCreate(%s): %v", body, err)
	}
	return create
}

func mustPatch(t *testing.T, body string) Patch {
	t.Helper()
	patch, err := DecodePatch([]byte(body))
	if err != nil {
		t.Fatalf("DecodePatch(%s): %v", body, err)
	}
	return patch
}

// presentKeys returns the Set keys of a field set, in contract order.
func presentKeys(f Fields) []string {
	var keys []string
	for _, key := range writableKeys {
		if scalarOptionalFor(f, key).Set || groupPresent(f, key) {
			keys = append(keys, key)
		}
	}
	return keys
}

// groupPresent reports the Set flag for the non-scalar fields.
func groupPresent(f Fields, key string) bool {
	switch key {
	case "requester":
		return f.Requester.Set
	case "skills":
		return f.Skills.Set
	case "languages":
		return f.Languages.Set
	case "benefits":
		return f.Benefits.Set
	case "custom_benefits":
		return f.CustomBenefits.Set
	case "screening_questions":
		return f.ScreeningQuestions.Set
	case "compensation":
		return f.Compensation.Set
	case "description":
		return f.Description.Set
	default:
		return false
	}
}

// scalarOptionalFor returns the scalar Optional addressed by its wire key.
func scalarOptionalFor(f Fields, key string) shared.Optional[string] {
	switch key {
	case "title":
		return f.Title
	case "location":
		return f.Location
	case "work_mode":
		return f.WorkMode
	case "work_schedule":
		return f.WorkSchedule
	case "contract_type":
		return f.ContractType
	case "seniority":
		return f.Seniority
	case "professional_area":
		return f.ProfessionalArea
	case "required_requirements":
		return f.RequiredRequirements
	case "preferred_requirements":
		return f.PreferredRequirements
	default:
		return shared.Optional[string]{}
	}
}

func requireNull(t *testing.T, name string, opt shared.Optional[string]) {
	t.Helper()
	if opt != (shared.Optional[string]{Set: true}) {
		t.Errorf("%s = %+v, want present null", name, opt)
	}
}

func requireString(t *testing.T, name string, opt shared.Optional[string], want string) {
	t.Helper()
	if opt != (shared.Optional[string]{Set: true, Valid: true, Value: want}) {
		t.Errorf("%s = %+v, want present %q", name, opt, want)
	}
}

func requireEmptyStringSlice(t *testing.T, name string, opt shared.Optional[[]string]) {
	t.Helper()
	if !opt.Set || !opt.Valid || opt.Value == nil || len(opt.Value) != 0 {
		t.Errorf("%s = %+v, want present non-nil empty slice", name, opt)
	}
}

// TestDecodeCreate_EmptyFieldsAppliesFullDefaults covers the POST omission
// table: scalar/nullable object -> null, list -> [], compensation defaults,
// description -> null, and every field present after a create default.
func TestDecodeCreate_EmptyFieldsAppliesFullDefaults(t *testing.T) {
	create := mustCreate(t, `{"fields":{}}`)

	for _, key := range writableKeys {
		switch key {
		case "requester", "skills", "languages", "benefits", "custom_benefits", "screening_questions", "compensation", "description":
			continue
		}
		requireNull(t, key, scalarOptionalFor(create.Fields, key))
	}

	requireEmptyStringSlice(t, "skills", create.Skills)
	requireEmptyStringSlice(t, "benefits", create.Benefits)
	requireEmptyStringSlice(t, "custom_benefits", create.CustomBenefits)

	if !create.Languages.Set || !create.Languages.Valid || create.Languages.Value == nil || len(create.Languages.Value) != 0 {
		t.Errorf("languages = %+v, want present non-nil empty slice", create.Languages)
	}
	if !create.ScreeningQuestions.Set || !create.ScreeningQuestions.Valid || create.ScreeningQuestions.Value == nil || len(create.ScreeningQuestions.Value) != 0 {
		t.Errorf("screening_questions = %+v, want present non-nil empty slice", create.ScreeningQuestions)
	}
	if !create.Requester.Set || create.Requester.Valid {
		t.Errorf("requester = %+v, want present null", create.Requester)
	}

	requireCompensationDefaults(t, create.Compensation)

	if !create.Description.Set || create.Description.Valid {
		t.Errorf("description = %+v, want present null", create.Description)
	}
	if plain, ok := create.DescriptionPlain(); ok || plain != "" {
		t.Errorf("DescriptionPlain() = (%q, %v), want (\"\", false)", plain, ok)
	}

	if got := presentKeys(create.Fields); !slices.Equal(got, writableKeys) {
		t.Errorf("present keys = %v, want all 17 %v", got, writableKeys)
	}
	if len(create.Fingerprint()) == 0 {
		t.Error("Fingerprint() is empty")
	}
}

func requireCompensationDefaults(t *testing.T, opt shared.Optional[draftfields.Compensation]) {
	t.Helper()
	if !opt.Set || !opt.Valid {
		t.Fatalf("compensation = %+v, want present value", opt)
	}
	comp := opt.Value
	if comp.Mode != nil || comp.Amount != nil || comp.Min != nil || comp.Max != nil || comp.Basis != nil {
		t.Errorf("compensation nullable fields = %+v, want all nil", comp)
	}
	if comp.Currency == nil || *comp.Currency != "MXN" {
		t.Errorf("compensation currency = %v, want MXN", comp.Currency)
	}
	if comp.PayPeriod == nil || *comp.PayPeriod != "monthly" {
		t.Errorf("compensation pay_period = %v, want monthly", comp.PayPeriod)
	}
	if comp.PublicVisible {
		t.Error("compensation public_visible = true, want false")
	}
}

// TestDecodeCreate_PartialFields verifies that omitted fields still receive
// defaults when other fields are supplied.
func TestDecodeCreate_PartialFields(t *testing.T) {
	create := mustCreate(t, `{"fields":{"title":"  Backend Go  ","professional_area":"technology_systems"}}`)

	requireString(t, "title", create.Title, "Backend Go")
	requireString(t, "professional_area", create.ProfessionalArea, "technology_systems")
	requireNull(t, "location", create.Location)
	requireEmptyStringSlice(t, "skills", create.Skills)
	requireCompensationDefaults(t, create.Compensation)
}

// TestDecodeCreate_AllFieldGroups exercises every group with a valid value.
func TestDecodeCreate_AllFieldGroups(t *testing.T) {
	body := `{"fields":{
		"title":"Backend Go",
		"location":"CDMX",
		"work_mode":"remote",
		"work_schedule":"full_time",
		"contract_type":"indefinite",
		"seniority":"senior",
		"professional_area":"technology_systems",
		"requester":{"kind":"client","id":"11111111-2222-3333-4444-555555555555"},
		"skills":["Go","Postgres"],
		"languages":[
			{"language":"es","custom_name":null,"level":"native"},
			{"language":"other","custom_name":"Náhuatl","level":null}
		],
		"benefits":["health_insurance","remote_stipend"],
		"custom_benefits":["Viajes"],
		"required_requirements":"5 años",
		"preferred_requirements":"Kubernetes",
		"screening_questions":[{"prompt":"¿Disponibilidad?"}],
		"compensation":{"mode":"range","amount":null,"min":"30000","max":"45000.5","currency":"MXN","pay_period":"monthly","basis":"gross","public_visible":false},
		"description":` + docText + `
	}}`
	create := mustCreate(t, body)

	requireString(t, "title", create.Title, "Backend Go")
	requireString(t, "location", create.Location, "CDMX")
	requireString(t, "work_mode", create.WorkMode, "remote")
	requireString(t, "work_schedule", create.WorkSchedule, "full_time")
	requireString(t, "contract_type", create.ContractType, "indefinite")
	requireString(t, "seniority", create.Seniority, "senior")
	requireString(t, "professional_area", create.ProfessionalArea, "technology_systems")
	requireString(t, "required_requirements", create.RequiredRequirements, "5 años")
	requireString(t, "preferred_requirements", create.PreferredRequirements, "Kubernetes")

	if !create.Requester.Valid || create.Requester.Value == nil {
		t.Fatalf("requester = %+v, want present value", create.Requester)
	}
	if create.Requester.Value.Kind != "client" {
		t.Errorf("requester kind = %q, want client", create.Requester.Value.Kind)
	}
	if create.Requester.Value.ID == nil || *create.Requester.Value.ID != "11111111-2222-3333-4444-555555555555" {
		t.Errorf("requester id = %v, want the submitted UUID", create.Requester.Value.ID)
	}

	if want := []string{"Go", "Postgres"}; !slices.Equal(create.Skills.Value, want) {
		t.Errorf("skills = %v, want %v", create.Skills.Value, want)
	}
	if want := []string{"health_insurance", "remote_stipend"}; !slices.Equal(create.Benefits.Value, want) {
		t.Errorf("benefits = %v, want %v", create.Benefits.Value, want)
	}
	if want := []string{"Viajes"}; !slices.Equal(create.CustomBenefits.Value, want) {
		t.Errorf("custom_benefits = %v, want %v", create.CustomBenefits.Value, want)
	}

	if len(create.Languages.Value) != 2 {
		t.Fatalf("languages = %+v, want 2 items", create.Languages.Value)
	}
	first := create.Languages.Value[0]
	if first.Language != "es" || first.CustomName != nil || first.Level == nil || *first.Level != "native" {
		t.Errorf("languages[0] = %+v, want es/nil/native", first)
	}
	second := create.Languages.Value[1]
	if second.Language != "other" || second.CustomName == nil || *second.CustomName != "Náhuatl" || second.Level != nil {
		t.Errorf("languages[1] = %+v, want other/Náhuatl/nil", second)
	}

	if len(create.ScreeningQuestions.Value) != 1 || create.ScreeningQuestions.Value[0].Prompt != "¿Disponibilidad?" {
		t.Errorf("screening_questions = %+v", create.ScreeningQuestions.Value)
	}

	comp := create.Compensation.Value
	if comp.Mode == nil || *comp.Mode != "range" || comp.Amount != nil {
		t.Errorf("compensation mode/amount = %+v, want range/null", comp)
	}
	if comp.Min == nil || *comp.Min != "30000.00" {
		t.Errorf("compensation min = %v, want 30000.00", comp.Min)
	}
	if comp.Max == nil || *comp.Max != "45000.50" {
		t.Errorf("compensation max = %v, want 45000.50", comp.Max)
	}

	if create.Description.Value == nil || len(create.Description.Value.Canonical) == 0 {
		t.Fatal("description = nil, want present document")
	}
	if plain, ok := create.DescriptionPlain(); !ok || plain != "Hola" {
		t.Errorf("DescriptionPlain() = (%q, %v), want (Hola, true)", plain, ok)
	}
	if !bytes.Contains(create.Fingerprint(), create.Description.Value.Canonical) {
		t.Error("fingerprint does not embed the canonical rich description bytes")
	}
}

// TestDecodeCreate_RequesterOwnershipRemainsPersistenceWork verifies that only
// lexical kind/id validity is checked, with no catalog or organization lookup.
func TestDecodeCreate_RequesterOwnershipRemainsPersistenceWork(t *testing.T) {
	for _, body := range []string{
		`{"fields":{"requester":{"kind":"client","id":null}}}`,
		`{"fields":{"requester":{"kind":"internal_area","id":"FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"}}}`,
	} {
		t.Run(body, func(t *testing.T) {
			create := mustCreate(t, body)
			if !create.Requester.Valid || create.Requester.Value == nil {
				t.Fatalf("requester = %+v, want accepted lexical value", create.Requester)
			}
		})
	}
}

// TestDecodeCreate_UnsupportedRichVersionIsInvalidRequest verifies that a rich
// description whose numeric schema version is not 1 is a request error.
func TestDecodeCreate_UnsupportedRichVersionIsInvalidRequest(t *testing.T) {
	for _, body := range []string{
		`{"fields":{"description":{"schema_version":0,"document":{"type":"doc","content":[{"type":"paragraph"}]}}}}`,
		`{"fields":{"description":{"schema_version":2,"document":{"type":"doc","content":[{"type":"paragraph"}]}}}}`,
		`{"fields":{"description":{"document":{"type":"doc","content":[{"type":"paragraph"}]}}}}`,
		`{"fields":{"description":{"schema_version":"1","document":{"type":"doc","content":[{"type":"paragraph"}]}}}}`,
	} {
		t.Run(body, func(t *testing.T) {
			_, err := DecodeCreate([]byte(body))
			if !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("err = %v, want ErrInvalidRequest", err)
			}
			if errors.Is(err, ErrValidation) {
				t.Errorf("err = %v, must not be ErrValidation", err)
			}
		})
	}
}

// TestDecodeCreate_RichVersionIntegralSpelling verifies that an integral
// spelling of version 1 is accepted by the strict decoder and the rich
// validator.
func TestDecodeCreate_RichVersionIntegralSpelling(t *testing.T) {
	create := mustCreate(t, `{"fields":{"description":{"schema_version":1.0,"document":{"type":"doc","content":[{"type":"paragraph"}]}}}}`)
	if !create.Description.Valid || create.Description.Value == nil {
		t.Fatalf("description = %+v, want accepted document", create.Description)
	}
}

// TestDecodePatch_EmptyFieldsRejected covers the 400 empty_patch rule.
func TestDecodePatch_EmptyFieldsRejected(t *testing.T) {
	if _, err := DecodePatch([]byte(`{"fields":{}}`)); !errors.Is(err, ErrEmptyPatch) {
		t.Fatalf("err = %v, want ErrEmptyPatch", err)
	}
}

// TestDecodePatch_PresenceOnly verifies that only submitted fields are present
// and that every group becomes present when submitted.
func TestDecodePatch_PresenceOnly(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		present string
	}{
		{"scalar", `{"fields":{"title":"X"}}`, "title"},
		{"requester null", `{"fields":{"requester":null}}`, "requester"},
		{"skills", `{"fields":{"skills":[]}}`, "skills"},
		{"languages", `{"fields":{"languages":[]}}`, "languages"},
		{"benefits", `{"fields":{"benefits":[]}}`, "benefits"},
		{"custom_benefits", `{"fields":{"custom_benefits":[]}}`, "custom_benefits"},
		{"screening_questions", `{"fields":{"screening_questions":[]}}`, "screening_questions"},
		{"compensation", `{"fields":{"compensation":` + compDefaults + `}}`, "compensation"},
		{"description null", `{"fields":{"description":null}}`, "description"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			patch := mustPatch(t, tc.body)
			if got := presentKeys(patch.Fields); !slices.Equal(got, []string{tc.present}) {
				t.Errorf("present keys = %v, want only [%s]", got, tc.present)
			}
		})
	}
}

// TestDecodePatch_NullGroupsRejected verifies that a list or object group set
// to null is invalid: only a real value fully replaces a present field.
func TestDecodePatch_NullGroupsRejected(t *testing.T) {
	for _, body := range []string{
		`{"fields":{"skills":null}}`,
		`{"fields":{"languages":null}}`,
		`{"fields":{"benefits":null}}`,
		`{"fields":{"custom_benefits":null}}`,
		`{"fields":{"screening_questions":null}}`,
		`{"fields":{"compensation":null}}`,
	} {
		t.Run(body, func(t *testing.T) {
			_, err := DecodePatch([]byte(body))
			if !errors.Is(err, ErrValidation) {
				t.Fatalf("err = %v, want ErrValidation", err)
			}
		})
	}
}

// TestDecodePatch_NoNestedMerge verifies that a present nested object is a full
// replacement: partial objects and null objects are not merged with a previous
// state, and nullable scalars/objects can be explicitly cleared.
func TestDecodePatch_NoNestedMerge(t *testing.T) {
	if _, err := DecodePatch([]byte(`{"fields":{"compensation":{"currency":"USD"}}}`)); !errors.Is(err, ErrValidation) {
		t.Errorf("partial compensation err = %v, want ErrValidation", err)
	}

	patch := mustPatch(t, `{"fields":{"requester":null,"description":null,"title":null}}`)
	if !patch.Requester.Set || patch.Requester.Valid {
		t.Errorf("requester = %+v, want present null", patch.Requester)
	}
	if !patch.Description.Set || patch.Description.Valid {
		t.Errorf("description = %+v, want present null", patch.Description)
	}
	if !patch.Title.Set || patch.Title.Valid {
		t.Errorf("title = %+v, want present null", patch.Title)
	}
	if plain, ok := patch.DescriptionPlain(); ok || plain != "" {
		t.Errorf("DescriptionPlain() = (%q, %v), want (\"\", false)", plain, ok)
	}

	// A present empty list replaces the whole list with an empty list.
	replaced := mustPatch(t, `{"fields":{"languages":[]}}`)
	if !replaced.Languages.Valid || replaced.Languages.Value == nil || len(replaced.Languages.Value) != 0 {
		t.Errorf("languages = %+v, want present empty non-nil slice", replaced.Languages)
	}
}

// TestDecodePatch_PreservesOrderAndNormalization verifies full replacement with
// preserved array order and normalized money.
func TestDecodePatch_PreservesOrderAndNormalization(t *testing.T) {
	patch := mustPatch(t, `{"fields":{
		"skills":["Zeta","Alpha"],
		"languages":[{"language":"other","custom_name":"B","level":null},{"language":"en","custom_name":null,"level":"basic"}],
		"compensation":{"mode":"fixed","amount":"0.0","min":null,"max":null,"currency":"USD","pay_period":"semimonthly","basis":"net","public_visible":true}
	}}`)

	if want := []string{"Zeta", "Alpha"}; !slices.Equal(patch.Skills.Value, want) {
		t.Errorf("skills = %v, want order-preserved %v", patch.Skills.Value, want)
	}
	if len(patch.Languages.Value) != 2 || patch.Languages.Value[0].Language != "other" || patch.Languages.Value[1].Language != "en" {
		t.Errorf("languages = %+v, want submitted order", patch.Languages.Value)
	}
	if patch.Compensation.Value.Amount == nil || *patch.Compensation.Value.Amount != "0.00" {
		t.Errorf("amount = %v, want normalized 0.00", patch.Compensation.Value.Amount)
	}
	if patch.Compensation.Value.PublicVisible != true {
		t.Error("public_visible = false, want true")
	}
}

// TestDecode_RequestShapeRejected verifies the exact {"fields": {...}} envelope.
func TestDecode_RequestShapeRejected(t *testing.T) {
	bodies := []string{
		``,
		`null`,
		`[]`,
		`{}`,
		`{"fields":null}`,
		`{"fields":[]}`,
		`{"fields":"x"}`,
		`{"fields":{},"extra":1}`,
		`{"fields":{},"other":{}}`,
	}
	for _, body := range bodies {
		t.Run(body, func(t *testing.T) {
			if _, err := DecodeCreate([]byte(body)); !errors.Is(err, ErrInvalidRequest) {
				t.Errorf("DecodeCreate err = %v, want ErrInvalidRequest", err)
			}
			if _, err := DecodePatch([]byte(body)); !errors.Is(err, ErrInvalidRequest) && !errors.Is(err, ErrEmptyPatch) {
				t.Errorf("DecodePatch err = %v, want ErrInvalidRequest or ErrEmptyPatch", err)
			}
		})
	}
}

// TestDecodePatch_EmptyIsNotRequestShape ensures `{"fields":{}}` stays a valid
// create body while the patch body errors only with empty_patch.
func TestDecodePatch_EmptyIsNotRequestShape(t *testing.T) {
	if _, err := DecodeCreate([]byte(`{"fields":{}}`)); err != nil {
		t.Fatalf("DecodeCreate empty fields: %v", err)
	}
	if _, err := DecodePatch([]byte(`{"fields":{}}`)); !errors.Is(err, ErrEmptyPatch) {
		t.Fatalf("DecodePatch err = %v, want ErrEmptyPatch", err)
	}
}

// TestDecode_UnknownAndReadOnlyKeysRejected verifies that unknown and
// read-only keys, including the nested derived requester.name, are request
// errors rather than value errors.
func TestDecode_UnknownAndReadOnlyKeysRejected(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"unknown", `{"fields":{"unknown_field":"x"}}`},
		{"title case", `{"fields":{"Title":"x"}}`},
		{"id", `{"fields":{"id":"x"}}`},
		{"status", `{"fields":{"status":"draft"}}`},
		{"version", `{"fields":{"version":"1"}}`},
		{"principal", `{"fields":{"principal":null}}`},
		{"principal_recruiter_id", `{"fields":{"principal_recruiter_id":null}}`},
		{"created_by", `{"fields":{"created_by":null}}`},
		{"created_at", `{"fields":{"created_at":null}}`},
		{"updated_at", `{"fields":{"updated_at":null}}`},
		{"organization", `{"fields":{"organization":null}}`},
		{"actor", `{"fields":{"actor":null}}`},
		{"description_plain", `{"fields":{"description_plain":"x"}}`},
		{"legacy closing_date", `{"fields":{"closingDate":"2026-01-01"}}`},
		{"nested requester.name", `{"fields":{"requester":{"kind":"client","id":null,"name":"X"}}}`},
		{"nested language key", `{"fields":{"languages":[{"language":"es","custom_name":null,"level":null,"extra":1}]}}`},
		{"nested screening key", `{"fields":{"screening_questions":[{"prompt":"Q","extra":1}]}}`},
		{"nested compensation key", `{"fields":{"compensation":{"mode":null,"amount":null,"min":null,"max":null,"currency":null,"pay_period":null,"basis":null,"public_visible":false,"extra":1}}}`},
		{"nested description key", `{"fields":{"description":{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"extra":1}}}`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := DecodeCreate([]byte(tc.body))
			if !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("err = %v, want ErrInvalidRequest", err)
			}
			if errors.Is(err, ErrValidation) {
				t.Errorf("err = %v, must not be ErrValidation", err)
			}
			if _, err := DecodePatch([]byte(tc.body)); !errors.Is(err, ErrInvalidRequest) {
				t.Errorf("DecodePatch err = %v, want ErrInvalidRequest", err)
			}
		})
	}
}

// TestDecode_MalformedJSONRejected verifies the strict raw decoder is reused.
func TestDecode_MalformedJSONRejected(t *testing.T) {
	invalidUTF8 := "{\"fields\":{\"title\":\"\xff\"}}"
	bodies := []string{
		`{"fields":`,
		`{"fields":{}} {"x":1}`,
		`{"fields":{},}`,
		`{"fields":{"title":"a"},"fields":{}}`,
		`{"fields":{"title":"\uD800"}}`,
		`{"fields":{"description":{"schema_version":1.5,"document":{}}}}`,
		invalidUTF8,
	}
	for _, body := range bodies {
		t.Run(body, func(t *testing.T) {
			if _, err := DecodeCreate([]byte(body)); !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("err = %v, want ErrInvalidRequest", err)
			}
		})
	}
}

// TestDecode_ValidationErrors covers every delegated field group. A nil group
// sentinel means the only required distinguishing error is ErrValidation.
func TestDecode_ValidationErrors(t *testing.T) {
	longTitle := `"` + strings.Repeat("a", 201) + `"`
	partialComp := `{"mode":null,"amount":null,"min":null,"max":null,"currency":null,"pay_period":null,"basis":null}`
	badAmount := `{"mode":"fixed","amount":"1.234","min":null,"max":null,"currency":"MXN","pay_period":"monthly","basis":"gross","public_visible":false}`
	fixedWithMin := `{"mode":"fixed","amount":"1","min":"1.00","max":null,"currency":"MXN","pay_period":"monthly","basis":"gross","public_visible":false}`

	tests := []struct {
		name  string
		body  string
		group error
	}{
		{"title wrong type", `{"fields":{"title":5}}`, nil},
		{"work_mode not a literal", `{"fields":{"work_mode":"Onsite"}}`, draftfields.ErrInvalidEnum},
		{"title too long", `{"fields":{"title":` + longTitle + `}}`, draftfields.ErrTooLong},
		{"skills wrong type", `{"fields":{"skills":"x"}}`, draftfields.ErrCollectionNotArray},
		{"skills null", `{"fields":{"skills":null}}`, draftfields.ErrCollectionNilRoot},
		{"skills duplicate after trim", `{"fields":{"skills":["Go"," Go "]}}`, draftfields.ErrCollectionDuplicate},
		{"skills empty after trim", `{"fields":{"skills":[" "]}}`, draftfields.ErrCollectionEmpty},
		{"benefits unknown code", `{"fields":{"benefits":["bogus"]}}`, draftfields.ErrCollectionInvalidLiteral},
		{"screening missing prompt", `{"fields":{"screening_questions":[{}]}}`, draftfields.ErrScreeningQuestionMissingPrompt},
		{"requester unknown kind", `{"fields":{"requester":{"kind":"bogus","id":null}}}`, nil},
		{"requester missing id", `{"fields":{"requester":{"kind":"client"}}}`, nil},
		{"requester non-lexical id", `{"fields":{"requester":{"kind":"client","id":"abc"}}}`, nil},
		{"languages unknown level", `{"fields":{"languages":[{"language":"es","custom_name":null,"level":"fluent"}]}}`, nil},
		{"languages es with custom name", `{"fields":{"languages":[{"language":"es","custom_name":"X","level":null}]}}`, nil},
		{"compensation missing key", `{"fields":{"compensation":` + partialComp + `}}`, draftfields.ErrCompensationMissingKey},
		{"compensation bad amount", `{"fields":{"compensation":` + badAmount + `}}`, draftfields.ErrCompensationInvalidAmount},
		{"compensation fixed with min", `{"fields":{"compensation":` + fixedWithMin + `}}`, draftfields.ErrCompensationShape},
		{"compensation null", `{"fields":{"compensation":null}}`, draftfields.ErrCompensationNilRoot},
		{"description missing document", `{"fields":{"description":{"schema_version":1}}}`, nil},
		{"description non-object", `{"fields":{"description":"x"}}`, nil},
		{"description empty doc", `{"fields":{"description":{"schema_version":1,"document":{"type":"doc"}}}}`, nil},
		{"description unknown node", `{"fields":{"description":{"schema_version":1,"document":{"type":"doc","content":[{"type":"heading"}]}}}}`, nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := DecodeCreate([]byte(tc.body))
			if !errors.Is(err, ErrValidation) {
				t.Fatalf("err = %v, want ErrValidation", err)
			}
			if tc.group != nil && !errors.Is(err, tc.group) {
				t.Errorf("err = %v, want wrapped %v", err, tc.group)
			}
			if _, err := DecodePatch([]byte(tc.body)); !errors.Is(err, ErrValidation) {
				t.Errorf("DecodePatch err = %v, want ErrValidation", err)
			}
		})
	}
}

// TestDecode_PayloadSizeBoundary verifies the body budget is enforced before
// decode and that exactly MaxBodyBytes is accepted.
func TestDecode_PayloadSizeBoundary(t *testing.T) {
	prefix := []byte(`{"fields":{}}`)
	atLimit := append([]byte{}, prefix...)
	atLimit = append(atLimit, bytes.Repeat([]byte{' '}, MaxBodyBytes-len(prefix))...)
	if len(atLimit) != MaxBodyBytes {
		t.Fatalf("len(atLimit) = %d, want %d", len(atLimit), MaxBodyBytes)
	}
	if _, err := DecodeCreate(atLimit); err != nil {
		t.Fatalf("DecodeCreate at limit: %v", err)
	}

	overLimit := append(append([]byte{}, atLimit...), ' ')
	if _, err := DecodeCreate(overLimit); !errors.Is(err, ErrPayloadTooLarge) {
		t.Fatalf("DecodeCreate over limit err = %v, want ErrPayloadTooLarge", err)
	}
	if _, err := DecodePatch(overLimit); !errors.Is(err, ErrPayloadTooLarge) {
		t.Fatalf("DecodePatch over limit err = %v, want ErrPayloadTooLarge", err)
	}
}

// TestCreateFingerprint_DeterministicAndSelfDescribing verifies the canonical
// fingerprint representation: schema_version 1, defaults included, property
// order irrelevant, array order meaningful and normalized decimals stable.
func TestCreateFingerprint_DeterministicAndSelfDescribing(t *testing.T) {
	if fp := mustCreate(t, `{"fields":{}}`).Fingerprint(); !bytes.Contains(fp, []byte(`"schema_version":1`)) {
		t.Errorf("fingerprint %s does not include schema_version 1", fp)
	}

	defaulted := mustCreate(t, `{"fields":{}}`).Fingerprint()
	explicit := mustCreate(t, `{"fields":{"compensation":`+compDefaults+`}}`).Fingerprint()
	if !bytes.Equal(defaulted, explicit) {
		t.Errorf("defaulted vs explicit compensation fingerprints differ:\n%s\n%s", defaulted, explicit)
	}

	ordered := mustCreate(t, `{"fields":{"title":"Ingeniero","location":"CDMX"}}`).Fingerprint()
	reordered := mustCreate(t, `{"fields":{"location":"CDMX","title":"Ingeniero"}}`).Fingerprint()
	if !bytes.Equal(ordered, reordered) {
		t.Errorf("property order changed the fingerprint:\n%s\n%s", ordered, reordered)
	}

	sameDecimals := []string{
		`{"fields":{"compensation":{"mode":"fixed","amount":"0","min":null,"max":null,"currency":"MXN","pay_period":"monthly","basis":"gross","public_visible":false}}}`,
		`{"fields":{"compensation":{"mode":"fixed","amount":"0.0","min":null,"max":null,"currency":"MXN","pay_period":"monthly","basis":"gross","public_visible":false}}}`,
		`{"fields":{"compensation":{"mode":"fixed","amount":"0.00","min":null,"max":null,"currency":"MXN","pay_period":"monthly","basis":"gross","public_visible":false}}}`,
	}
	base := mustCreate(t, sameDecimals[0]).Fingerprint()
	for _, body := range sameDecimals[1:] {
		if fp := mustCreate(t, body).Fingerprint(); !bytes.Equal(base, fp) {
			t.Errorf("decimal normalization changed the fingerprint for %s:\n%s\n%s", body, base, fp)
		}
	}

	firstOrder := mustCreate(t, `{"fields":{"skills":["A","B"]}}`).Fingerprint()
	secondOrder := mustCreate(t, `{"fields":{"skills":["B","A"]}}`).Fingerprint()
	if bytes.Equal(firstOrder, secondOrder) {
		t.Error("array order must be meaningful but fingerprints are equal")
	}
}

// TestPatchFingerprint_ExactCanonicalBytes verifies the canonical byte shape of
// the fingerprint and that the rich description subtree is reused verbatim.
func TestPatchFingerprint_ExactCanonicalBytes(t *testing.T) {
	patch := mustPatch(t, `{"fields":{"title":"X"}}`)
	if want := `{"fields":{"title":"X"},"schema_version":1}`; string(patch.Fingerprint()) != want {
		t.Errorf("fingerprint = %s, want %s", patch.Fingerprint(), want)
	}

	patch = mustPatch(t, `{"fields":{"description":`+docText+`}}`)
	if !patch.Description.Valid || patch.Description.Value == nil {
		t.Fatal("description = nil, want present document")
	}
	want := `{"fields":{"description":` + string(patch.Description.Value.Canonical) + `},"schema_version":1}`
	if got := string(patch.Fingerprint()); got != want {
		t.Errorf("fingerprint = %s, want %s", got, want)
	}
}

// TestFingerprint_ReturnsCopy protects the immutability of the canonical bytes.
func TestFingerprint_ReturnsCopy(t *testing.T) {
	create := mustCreate(t, `{"fields":{"title":"X"}}`)
	first := create.Fingerprint()
	if len(first) == 0 {
		t.Fatal("Fingerprint() is empty")
	}
	first[0] = '!'
	if second := create.Fingerprint(); second[0] == '!' {
		t.Error("Fingerprint() returned a slice aliasing internal state")
	}

	patch := mustPatch(t, `{"fields":{"title":"X"}}`)
	firstPatch := patch.Fingerprint()
	firstPatch[0] = '!'
	if second := patch.Fingerprint(); second[0] == '!' {
		t.Error("Patch.Fingerprint() returned a slice aliasing internal state")
	}
}

// TestDecode_InputNotAliased verifies the decoded result is owned and does not
// depend on the request bytes after decode.
func TestDecode_InputNotAliased(t *testing.T) {
	body := []byte(`{"fields":{"title":"X","skills":["A","B"]}}`)
	create := mustCreate(t, string(body))
	for i := range body {
		body[i] = ' '
	}
	if create.Title.Value != "X" {
		t.Errorf("title = %q after input mutation, want X", create.Title.Value)
	}
	if want := []string{"A", "B"}; !slices.Equal(create.Skills.Value, want) {
		t.Errorf("skills = %v after input mutation, want %v", create.Skills.Value, want)
	}
}

// TestFields_DescriptionPlain covers the derived plain contract: it is null
// exactly when the description is null and an empty paragraph is not null.
func TestFields_DescriptionPlain(t *testing.T) {
	tests := []struct {
		name      string
		body      string
		wantPlain string
		wantOK    bool
	}{
		{"null create", `{"fields":{}}`, "", false},
		{"null patch", `{"fields":{"description":null}}`, "", false},
		{"empty paragraph", `{"fields":{"description":` + docEmptyParagraph + `}}`, "", true},
		{"text", `{"fields":{"description":` + docText + `}}`, "Hola", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			fields := mustCreate(t, tc.body).Fields
			plain, ok := fields.DescriptionPlain()
			if plain != tc.wantPlain || ok != tc.wantOK {
				t.Errorf("DescriptionPlain() = (%q, %v), want (%q, %v)", plain, ok, tc.wantPlain, tc.wantOK)
			}
		})
	}

	patch := mustPatch(t, `{"fields":{"description":null}}`)
	if plain, ok := patch.DescriptionPlain(); ok || plain != "" {
		t.Errorf("patch cleared DescriptionPlain() = (%q, %v), want (\"\", false)", plain, ok)
	}
}

// TestDecode_RichKeyShapeRejected verifies that an unknown key inside a known
// rich node, mark or attr object is a request error, not a value error. The
// composer checks only the key sets of known types; the rich grammar and every
// attribute value stay owned by draftrich.
func TestDecode_RichKeyShapeRejected(t *testing.T) {
	tests := []struct {
		name string
		doc  string
	}{
		{
			"node extra",
			`{"type":"doc","content":[{"type":"paragraph","extra":1}]}`,
		},
		{
			"deep node extra",
			`{"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph"},{"type":"paragraph","extra":1}]}]}]}`,
		},
		{
			"mark extra",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"bold","extra":1}]}]}]}`,
		},
		{
			"ordered list attrs extra",
			`{"type":"doc","content":[{"type":"orderedList","attrs":{"start":1,"type":null,"extra":1},"content":[{"type":"listItem","content":[{"type":"paragraph"}]}]}]}`,
		},
		{
			"font size attrs extra",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"fontSizePreset","attrs":{"preset":"normal","extra":1}}]}]}]}`,
		},
		{
			"link attrs extra",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":"https://example.com/","target":null,"rel":null,"class":null,"title":null,"extra":1}}]}]}]}`,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body := `{"fields":{"description":{"schema_version":1,"document":` + tc.doc + `}}}`
			if _, err := DecodeCreate([]byte(body)); !errors.Is(err, ErrInvalidRequest) {
				t.Errorf("DecodeCreate err = %v, want ErrInvalidRequest", err)
			}
			if _, err := DecodePatch([]byte(body)); !errors.Is(err, ErrInvalidRequest) {
				t.Errorf("DecodePatch err = %v, want ErrInvalidRequest", err)
			}
		})
	}
}

// TestDecode_RichGrammarStaysValidation verifies that rich grammar and
// attribute value failures remain value errors: the composer checks key shapes
// only and never reimplements the rich grammar.
func TestDecode_RichGrammarStaysValidation(t *testing.T) {
	tests := []struct {
		name string
		doc  string
	}{
		{"empty doc", `{"type":"doc"}`},
		{"empty doc content", `{"type":"doc","content":[]}`},
		{"ordered list start zero", `{"type":"doc","content":[{"type":"orderedList","attrs":{"start":0,"type":null},"content":[{"type":"listItem","content":[{"type":"paragraph"}]}]}]}`},
		{"font size invalid preset", `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"fontSizePreset","attrs":{"preset":"huge"}}]}]}]}`},
		{"link invalid href", `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":"http://example.com/","target":null,"rel":null,"class":null,"title":null}}]}]}]}`},
		{"unknown mark type", `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"underline"}]}]}]}`},
		{"empty text", `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]}`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body := `{"fields":{"description":{"schema_version":1,"document":` + tc.doc + `}}}`
			if _, err := DecodeCreate([]byte(body)); !errors.Is(err, ErrValidation) {
				t.Errorf("DecodeCreate err = %v, want ErrValidation", err)
			}
			if _, err := DecodePatch([]byte(body)); !errors.Is(err, ErrValidation) {
				t.Errorf("DecodePatch err = %v, want ErrValidation", err)
			}
		})
	}
}
