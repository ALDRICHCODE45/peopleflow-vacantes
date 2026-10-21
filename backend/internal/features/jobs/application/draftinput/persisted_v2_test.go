package draftinput

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftfields"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
)

// The expectations in this file describe the persisted complete-document
// contract: the stored schema-2 root {schema_version, fields} with exactly the
// complete 17 fields, every value already normalized, and the v2 screening
// questions. The validator never repairs stored bytes, never applies create
// defaults and never reuses the v1 screening projection.
//
// Fixtures and the v1 composer helpers (writableKeys, mustCreate, mustPatch)
// are shared with draftinput_test.go in the same package; this file does not
// repeat the delegated leaf-validator matrix.

// persistedV2DefaultDoc is a complete canonical schema-2 document whose
// nullable fields are null, arrays are empty and compensation carries the
// contract defaults.
const persistedV2DefaultDoc = `{"schema_version":2,"fields":{"min_years_of_experience":null,"min_education_level":null,"accepts_in_progress_education":false,` +
	`"title":null,"location":null,"remote_scope":null,"work_mode":null,"work_schedule":null,"contract_type":null,"seniority":null,"professional_area":null,` +
	`"requester":null,` +
	`"skills":[],"languages":[],"benefits":[],"custom_benefits":[],` +
	`"required_requirements":null,"preferred_requirements":null,` +
	`"screening_questions":[],` +
	`"compensation":{"mode":null,"amount":null,"min":null,"max":null,"currency":"MXN","pay_period":"monthly","basis":null,"public_visible":false},` +
	`"description":null}}`

// persistedV2PopulatedDoc is a complete canonical schema-2 document exercising
// all 17 field groups and all three screening v2 question types.
const persistedV2PopulatedDoc = `{"schema_version":2,"fields":{
 "min_years_of_experience":"1.5","min_education_level":"bachelor","accepts_in_progress_education":true,
	"title":"Backend Go",
	"location":{"country":"MX"},
	"remote_scope":null,
	"work_mode":"remote",
	"work_schedule":"full_time",
	"contract_type":"indefinite",
	"seniority":"senior",
	"professional_area":"technology_systems",
	"requester":{"kind":"client","id":"11111111-2222-3333-4444-555555555555"},
	"skills":["Go","Postgres"],
	"languages":[{"code":"es","min_level":"native"},{"code":"nah","min_level":"B2"}],
	"benefits":["health_insurance","remote_stipend"],
	"custom_benefits":["Viajes"],
	"required_requirements":"5 años",
	"preferred_requirements":"Kubernetes",
	"screening_questions":[
		{"id":"d2b3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c6d","type":"open","prompt":"Describe un proyecto."},
		{"id":"c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c","type":"single_choice_informative","prompt":"¿Qué modalidad prefieres?","options":[{"id":"3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f","label":"Remoto"},{"id":"4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f70","label":"Híbrido"}]},
		{"id":"b0f1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d","type":"single_choice_evaluated","prompt":"¿Qué palabra clave declara una función?","options":[{"id":"1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d","label":"func"},{"id":"2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e","label":"function"}],"correct_option_id":"1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"}
	],
	"compensation":{"mode":"range","amount":null,"min":"30000.00","max":"45000.50","currency":"MXN","pay_period":"monthly","basis":"gross","public_visible":false},
	"description":{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hola","marks":[{"type":"link","attrs":{"href":"https://example.com/","target":"_blank","rel":"noopener","class":null,"title":null}}]}]}]}}
}}`

// persistedV2ReorderedDoc carries the same default value as
// persistedV2DefaultDoc with reordered keys, reordered compensation keys and
// extra JSON whitespace, proving the validator checks values rather than raw
// JSON bytes, key order or spacing.
const persistedV2ReorderedDoc = `{
	"fields" : {
        "accepts_in_progress_education": false, "min_education_level": null, "min_years_of_experience": null,
		"description" : null ,
		"compensation" : { "public_visible" : false , "basis" : null , "pay_period" : "monthly" , "currency" : "MXN" , "max" : null , "min" : null , "amount" : null , "mode" : null } ,
		"screening_questions" : [ ] ,
		"preferred_requirements" : null ,
		"required_requirements" : null ,
		"custom_benefits" : [ ] ,
		"benefits" : [ ] ,
		"languages" : [ ] ,
		"skills" : [ ] ,
		"requester" : null ,
		"professional_area" : null ,
		"seniority" : null ,
		"contract_type" : null ,
		"work_schedule" : null ,
		"work_mode" : null ,
		"location" : null ,
		"remote_scope" : null ,
		"title" : null
	} ,
	"schema_version" : 2
}`

// persistedV2NullableKeys lists every nullable persisted field in contract
// order: the nine scalars plus requester and description.
var persistedV2NullableKeys = []string{
	"min_years_of_experience", "min_education_level",
	"title",
	"location",
	"remote_scope",
	"work_mode",
	"work_schedule",
	"contract_type",
	"seniority",
	"professional_area",
	"required_requirements",
	"preferred_requirements",
	"requester",
	"description",
}

func persistedV2DecodeDoc(t *testing.T, body string) map[string]any {
	t.Helper()
	value, err := draftjson.Decode([]byte(body))
	if err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	doc, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("fixture root = %T, want object", value)
	}
	return doc
}

func persistedV2EncodeDoc(t *testing.T, doc map[string]any) []byte {
	t.Helper()
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("encode fixture: %v", err)
	}
	return raw
}

// persistedV2Doc decodes the canonical default fixture, applies mutate and
// re-encodes it, so a table can override or delete exactly one value.
func persistedV2Doc(t *testing.T, mutate func(doc map[string]any)) []byte {
	t.Helper()
	doc := persistedV2DecodeDoc(t, persistedV2DefaultDoc)
	mutate(doc)
	return persistedV2EncodeDoc(t, doc)
}

func persistedV2Raw(t *testing.T, body string) any {
	t.Helper()
	value, err := draftjson.Decode([]byte(body))
	if err != nil {
		t.Fatalf("decode raw fixture %s: %v", body, err)
	}
	return value
}

func requirePersistedV2(t *testing.T, err, sentinel error) {
	t.Helper()
	if !errors.Is(err, sentinel) {
		t.Fatalf("err = %v, want %v", err, sentinel)
	}
}

func requirePersistedV2NonCanonical(t *testing.T, err error, path string) {
	t.Helper()
	requirePersistedV2(t, err, ErrPersistedDraftNonCanonical)
	if errors.Is(err, ErrPersistedDraftRoot) || errors.Is(err, ErrPersistedDraftVersion) {
		t.Fatalf("field error %v must not be a root or version error", err)
	}
	if path != "" && !strings.Contains(err.Error(), path) {
		t.Fatalf("err = %v, want field path %q", err, path)
	}
}

// TestValidatePersistedDraftV2_AcceptsCanonicalDocuments covers the accepted
// complete documents: contract defaults, all 17 populated groups with all three
// screening types and JSON formatting variation.
func TestValidatePersistedDraftV2_AcceptsCanonicalDocuments(t *testing.T) {
	cases := map[string]string{
		"canonical defaults":        persistedV2DefaultDoc,
		"populated all 17 groups":   persistedV2PopulatedDoc,
		"reordered whitespace JSON": persistedV2ReorderedDoc,
		"integral version spelling": strings.Replace(persistedV2DefaultDoc, `"schema_version":2`, `"schema_version" : 2.0`, 1),
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			if err := ValidatePersistedDraftV2([]byte(body)); err != nil {
				t.Fatalf("ValidatePersistedDraftV2() = %v, want nil", err)
			}
		})
	}
}

// TestValidatePersistedDraftV2_AcceptsPermittedNull proves that every nullable
// field accepts an explicit null while every other field stays valid.
func TestValidatePersistedDraftV2_AcceptsPermittedNull(t *testing.T) {
	doc := persistedV2Doc(t, func(doc map[string]any) {
		fields := doc["fields"].(map[string]any)
		for _, key := range persistedV2NullableKeys {
			fields[key] = nil
		}
	})
	if err := ValidatePersistedDraftV2(doc); err != nil {
		t.Fatalf("ValidatePersistedDraftV2() = %v, want nil", err)
	}
}

// TestValidatePersistedDraftV2_RejectsRootShape covers the exact stored
// envelope: the root must be exactly {schema_version, fields} with a non-nil
// fields object.
func TestValidatePersistedDraftV2_RejectsRootShape(t *testing.T) {
	bodies := map[string]string{
		"null root":              `null`,
		"array root":             `[]`,
		"string root":            `"x"`,
		"number root":            `2`,
		"missing fields":         `{"schema_version":2}`,
		"missing schema_version": `{"fields":{}}`,
		"extra root key":         `{"schema_version":2,"fields":{},"extra":1}`,
		"fields null":            `{"schema_version":2,"fields":null}`,
		"fields array":           `{"schema_version":2,"fields":[]}`,
		"fields string":          `{"schema_version":2,"fields":"x"}`,
		"empty fields object":    `{"schema_version":2,"fields":{}}`,
	}
	for name, body := range bodies {
		t.Run(name, func(t *testing.T) {
			requirePersistedV2(t, ValidatePersistedDraftV2([]byte(body)), ErrPersistedDraftRoot)
		})
	}
}

// TestValidatePersistedDraftV2_RejectsReadEnvelopeMetadata covers top-level
// read-envelope metadata and derived keys: the fields object must be exactly
// the 17 writable keys.
func TestValidatePersistedDraftV2_RejectsReadEnvelopeMetadata(t *testing.T) {
	for _, key := range []string{
		"description_plain", "id", "status", "created_at", "updated_at", "version",
		"organization", "principal", "principal_recruiter_id", "created_by", "actor",
	} {
		t.Run(key, func(t *testing.T) {
			body := persistedV2Doc(t, func(doc map[string]any) {
				doc["fields"].(map[string]any)[key] = "x"
			})
			requirePersistedV2(t, ValidatePersistedDraftV2(body), ErrPersistedDraftRoot)
		})
	}
}

// TestValidatePersistedDraftV2_RejectsEachMissingField deletes every one of the
// 17 required keys and expects a structural root rejection.
func TestValidatePersistedDraftV2_RejectsEachMissingField(t *testing.T) {
	for _, key := range writableKeys {
		t.Run(key, func(t *testing.T) {
			body := persistedV2Doc(t, func(doc map[string]any) {
				delete(doc["fields"].(map[string]any), key)
			})
			requirePersistedV2(t, ValidatePersistedDraftV2(body), ErrPersistedDraftRoot)
		})
	}
}

// TestValidatePersistedDraftV2_RejectsVersion covers every non-2 version value,
// distinguishable from the root and field errors.
func TestValidatePersistedDraftV2_RejectsVersion(t *testing.T) {
	cases := map[string]any{
		"schema 1": int64(1),
		"schema 3": int64(3),
		"string":   "2",
		"null":     nil,
		"bool":     true,
	}
	for name, value := range cases {
		t.Run(name, func(t *testing.T) {
			body := persistedV2Doc(t, func(doc map[string]any) {
				doc["schema_version"] = value
			})
			err := ValidatePersistedDraftV2(body)
			requirePersistedV2(t, err, ErrPersistedDraftVersion)
			if errors.Is(err, ErrPersistedDraftRoot) || errors.Is(err, ErrPersistedDraftNonCanonical) {
				t.Fatalf("version error %v must be distinguishable", err)
			}
		})
	}
}

// TestValidatePersistedDraftV2_RejectsStrictJSON reuses the strict draftjson
// decoder: malformed JSON, duplicate keys, invalid UTF-8, a lone surrogate and
// a non-integer number are structural root rejections.
func TestValidatePersistedDraftV2_RejectsStrictJSON(t *testing.T) {
	bodies := [][]byte{
		[]byte(`{"schema_version":2,"fields":`),
		[]byte(`{"schema_version":2,"fields":{}} {"x":1}`),
		[]byte(`{"schema_version":2,"fields":{"title":null,"title":null}}`),
		[]byte("{\"schema_version\":2,\"fields\":{\"title\":\"\xff\"}}"),
		[]byte(`{"schema_version":2,"fields":{"title":"\uD800"}}`),
		[]byte(`{"schema_version":2.5,"fields":{}}`),
	}
	for _, body := range bodies {
		t.Run(string(body), func(t *testing.T) {
			err := ValidatePersistedDraftV2(body)
			requirePersistedV2(t, err, ErrPersistedDraftRoot)
			if errors.Is(err, ErrPersistedDraftVersion) {
				t.Fatalf("strict JSON error %v must not be a version error", err)
			}
		})
	}
}

// TestValidatePersistedDraftV2_RejectsNullNonNullableGroups covers the six
// required non-null groups: a stored null is a field error, not a structural
// root error.
func TestValidatePersistedDraftV2_RejectsNullNonNullableGroups(t *testing.T) {
	for _, key := range []string{
		"skills", "languages", "benefits", "custom_benefits", "screening_questions", "compensation",
	} {
		t.Run(key, func(t *testing.T) {
			body := persistedV2Doc(t, func(doc map[string]any) {
				doc["fields"].(map[string]any)[key] = nil
			})
			requirePersistedV2NonCanonical(t, ValidatePersistedDraftV2(body), "fields."+key)
		})
	}
}

// TestValidatePersistedDraftV2_RejectsNonCanonicalValues covers the per-group
// normalization contract: a stored value that the normalizer would change is
// rejected with its field path.
func TestValidatePersistedDraftV2_RejectsNonCanonicalValues(t *testing.T) {
	canonicalCompensation := func(doc map[string]any) map[string]any {
		return doc["fields"].(map[string]any)["compensation"].(map[string]any)
	}
	cases := map[string]struct {
		mutate func(doc map[string]any)
		path   string
	}{
		"scalar trim": {
			func(doc map[string]any) { doc["fields"].(map[string]any)["title"] = "  Backend Go  " },
			"fields.title",
		},
		"scalar empty to null": {
			func(doc map[string]any) { doc["fields"].(map[string]any)["location"] = "" },
			"fields.location",
		},
		"skills trim": {
			func(doc map[string]any) { doc["fields"].(map[string]any)["skills"] = []any{" Go "} },
			"fields.skills",
		},
		"custom benefits trim": {
			func(doc map[string]any) { doc["fields"].(map[string]any)["custom_benefits"] = []any{" Viajes "} },
			"fields.custom_benefits",
		},
		"benefit code untrimmed": {
			func(doc map[string]any) { doc["fields"].(map[string]any)["benefits"] = []any{" health_insurance "} },
			"fields.benefits",
		},
		"language custom name trim": {
			func(doc map[string]any) {
				doc["fields"].(map[string]any)["languages"] = []any{
					map[string]any{"language": "other", "custom_name": " Náhuatl ", "level": nil},
				}
			},
			"fields.languages",
		},
		"money short decimal": {
			func(doc map[string]any) {
				comp := canonicalCompensation(doc)
				comp["mode"] = "fixed"
				comp["amount"] = "30000"
			},
			"fields.compensation",
		},
		"money too many decimals": {
			func(doc map[string]any) {
				comp := canonicalCompensation(doc)
				comp["mode"] = "fixed"
				comp["amount"] = "1.234"
			},
			"fields.compensation",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			body := persistedV2Doc(t, tc.mutate)
			requirePersistedV2NonCanonical(t, ValidatePersistedDraftV2(body), tc.path)
		})
	}
}

// TestValidatePersistedDraftV2_RejectsRequesterDerivedName verifies that the
// read-time derived requester.name is not part of the stored requester.
func TestValidatePersistedDraftV2_RejectsRequesterDerivedName(t *testing.T) {
	body := persistedV2Doc(t, func(doc map[string]any) {
		doc["fields"].(map[string]any)["requester"] = map[string]any{
			"kind": "client",
			"id":   nil,
			"name": "Derivado",
		}
	})
	requirePersistedV2NonCanonical(t, ValidatePersistedDraftV2(body), "fields.requester")
}

// TestValidatePersistedDraftV2_PreservesFieldErrorChain verifies that the
// underlying group validator sentinel stays matchable through errors.Is.
func TestValidatePersistedDraftV2_PreservesFieldErrorChain(t *testing.T) {
	cases := map[string]struct {
		mutate func(doc map[string]any)
		want   error
	}{
		"invalid enum": {
			func(doc map[string]any) { doc["fields"].(map[string]any)["work_mode"] = "Onsite" },
			draftfields.ErrInvalidEnum,
		},
		"duplicate skills after trim": {
			func(doc map[string]any) { doc["fields"].(map[string]any)["skills"] = []any{"Go", " Go "} },
			draftfields.ErrCollectionDuplicate,
		},
		"compensation shape": {
			func(doc map[string]any) {
				comp := doc["fields"].(map[string]any)["compensation"].(map[string]any)
				comp["mode"] = "fixed"
				comp["amount"] = "1.00"
				comp["min"] = "1.00"
			},
			draftfields.ErrCompensationShape,
		},
		"screening noncanonical whitespace": {
			func(doc map[string]any) {
				doc["fields"].(map[string]any)["screening_questions"] = []any{
					map[string]any{"id": "d2b3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c6d", "type": "open", "prompt": "  Prompt  "},
				}
			},
			draftfields.ErrScreeningV2NonCanonical,
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			body := persistedV2Doc(t, tc.mutate)
			err := ValidatePersistedDraftV2(body)
			requirePersistedV2(t, err, ErrPersistedDraftNonCanonical)
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want wrapped %v", err, tc.want)
			}
		})
	}
}

// TestValidatePersistedDraftV2_RejectsDescriptionGrammar verifies the stored
// description envelope keeps the schema-1 strict keys and draftrich grammar.
func TestValidatePersistedDraftV2_RejectsDescriptionGrammar(t *testing.T) {
	cases := map[string]string{
		"missing document":       `{"schema_version":1}`,
		"unknown envelope key":   `{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"extra":1}`,
		"unsupported version":    `{"schema_version":2,"document":{"type":"doc","content":[{"type":"paragraph"}]}}`,
		"unknown node type":      `{"schema_version":1,"document":{"type":"doc","content":[{"type":"heading"}]}}`,
		"unknown node key":       `{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","extra":1}]}}`,
		"empty text":             `{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]}}`,
		"non object description": `"x"`,
	}
	for name, description := range cases {
		t.Run(name, func(t *testing.T) {
			body := persistedV2Doc(t, func(doc map[string]any) {
				doc["fields"].(map[string]any)["description"] = persistedV2Raw(t, description)
			})
			requirePersistedV2NonCanonical(t, ValidatePersistedDraftV2(body), "fields.description")
		})
	}
}

// TestValidatePersistedDraftV2_PreservesDescriptionValues verifies that a
// canonical link mark keeps its exact text and href: nothing is trimmed,
// rewritten or normalized.
func TestValidatePersistedDraftV2_PreservesDescriptionValues(t *testing.T) {
	description := `{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hola","marks":[{"type":"link","attrs":{"href":"https://example.com/a?b=c","target":"_blank","rel":"noopener","class":null,"title":null}}]}]}]}}`
	body := persistedV2Doc(t, func(doc map[string]any) {
		doc["fields"].(map[string]any)["description"] = persistedV2Raw(t, description)
	})
	if err := ValidatePersistedDraftV2(body); err != nil {
		t.Fatalf("ValidatePersistedDraftV2() = %v, want nil", err)
	}
}

// TestValidatePersistedDraftV2_DoesNotMutateInput protects the stored bytes on
// both the success and the failure path.
func TestValidatePersistedDraftV2_DoesNotMutateInput(t *testing.T) {
	cases := map[string]struct {
		fixture string
		wantErr bool
	}{
		"canonical": {persistedV2PopulatedDoc, false},
		"noncanonical": {
			strings.Replace(persistedV2DefaultDoc, `"title":null`, `"title":" x "`, 1),
			true,
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			raw := []byte(tc.fixture)
			before := bytes.Clone(raw)
			err := ValidatePersistedDraftV2(raw)
			if (err != nil) != tc.wantErr {
				t.Fatalf("ValidatePersistedDraftV2() = %v, wantErr %v", err, tc.wantErr)
			}
			if !bytes.Equal(raw, before) {
				t.Errorf("input mutated:\nbefore %s\nafter  %s", before, raw)
			}
		})
	}
}

// TestValidatePersistedDraftV2_HasNoRequestBodyCap verifies that the request
// body budget is not copied into the persisted API: a valid document longer
// than MaxBodyBytes is still accepted.
func TestValidatePersistedDraftV2_HasNoRequestBodyCap(t *testing.T) {
	padded := append(bytes.Repeat([]byte(" "), MaxBodyBytes+16), []byte(persistedV2DefaultDoc)...)
	if len(padded) <= MaxBodyBytes {
		t.Fatalf("len(padded) = %d, want > %d", len(padded), MaxBodyBytes)
	}
	if err := ValidatePersistedDraftV2(padded); err != nil {
		t.Fatalf("ValidatePersistedDraftV2() = %v, want nil", err)
	}
}

// TestValidatePersistedDraftV2_V1ComposerRegression verifies the additive file
// leaves the v1 create/patch composer and its v1 screening projection intact.
func TestValidatePersistedDraftV2_V1ComposerRegression(t *testing.T) {
	patch := mustPatch(t, `{"fields":{"title":"X"}}`)
	if want := `{"fields":{"title":"X"},"schema_version":1}`; string(patch.Fingerprint()) != want {
		t.Errorf("patch fingerprint = %s, want %s", patch.Fingerprint(), want)
	}

	create := mustCreate(t, `{"fields":{"screening_questions":[{"prompt":"Q"}]}}`)
	if !create.ScreeningQuestions.Valid || len(create.ScreeningQuestions.Value) != 1 || create.ScreeningQuestions.Value[0].Prompt != "Q" {
		t.Errorf("v1 screening projection = %+v, want the prompt-only projection", create.ScreeningQuestions)
	}

	typedRequest := []byte(`{"fields":{"screening_questions":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","type":"open","prompt":"Q"}]}}`)
	if _, err := DecodeCreate(typedRequest); !errors.Is(err, ErrInvalidRequest) {
		t.Errorf("v1 DecodeCreate typed v2 screening err = %v, want ErrInvalidRequest", err)
	}
}
