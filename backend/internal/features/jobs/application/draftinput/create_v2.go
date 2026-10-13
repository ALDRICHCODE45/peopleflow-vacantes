// Screening v2 create codec.
//
// Scope: this additive file composes the strict, normalized writable field
// input of a private vacancy draft schema-2 create (POST) request. It is the
// create-only sibling of DecodeCreate: it reuses the exact {"fields": {...}}
// request envelope, the MaxBodyBytes body budget, the writable field
// vocabulary and the create defaults of the unchanged groups, and it replaces
// only the screening_questions group with the typed v2 validator and a typed
// v2 result. Patch (DecodePatchV2), store writes, idempotency, HTTP envelopes
// and routes remain out of scope. It performs no database, HTTP, network,
// catalog, organization, ETag or persistence access.
//
// The accepted body is always exactly {"fields": {...}} and never carries a
// client schema_version: a root schema marker is an unknown root key and a
// request error. The raw body is rejected before decode when it exceeds
// MaxBodyBytes; it is then decoded with the strict draftjson decoder, which
// rejects duplicate keys, invalid UTF-8, lone surrogate escapes, non-integer
// numbers and trailing data.
//
// The unchanged groups are validated, defaulted and projected by the same
// draftinput and draftfields helpers as v1. The screening_questions group is
// validated for values by draftfields.ValidateScreeningQuestionsV2 and for
// structure by a bounded structural-only walk of the variant key sets. The walk
// inspects every question and option independently of any earlier value error,
// in the v1 nested order requester, languages, screening_questions,
// compensation, description, so an unknown or missing variant key preempts
// every value composition error; every recognized bad value wraps ErrValidation
// and is still produced at the screening slot of the value composition, exactly
// as in v1. The legacy v1 Fields.ScreeningQuestions container is deliberately
// left unset and the typed questions are exposed through
// CreateV2.ScreeningQuestionsV2, so a v2 question is never projected through
// the lossy v1 prompt-only helper.
//
// Error taxonomy (identical to v1 where the rule is shared):
//
//   - ErrPayloadTooLarge: raw body longer than MaxBodyBytes, checked first.
//   - ErrInvalidRequest: malformed/non-strict JSON, a root that is not exactly
//     {"fields": {...}}, an unknown or read-only key at any level of a
//     delegated object (including a screening variant key set extra), an
//     unsupported rich description schema_version or a missing mandatory
//     screening variant key.
//   - ErrValidation: a recognized writable field value that violates its
//     contract. The underlying group validator error stays matchable with
//     errors.Is.
//
// No partial result is ever returned with an error, the input bytes are never
// mutated and the returned result is owned.
package draftinput

import (
	"bytes"
	"errors"
	"fmt"
	"maps"
	"slices"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftfields"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftrich"
	shared "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
)

// CreateV2 is the result of a valid schema-2 POST body.
//
// It reuses the v1 Fields container for the 16 unchanged groups and carries the
// typed v2 screening questions separately in ScreeningQuestionsV2. The promoted
// legacy Fields.ScreeningQuestions is always left unset: a v2 question is never
// projected through the lossy v1 prompt-only representation.
//
// After DecodeCreateV2 every unchanged field is present (Set==true) with its
// create default applied and ScreeningQuestionsV2 is a non-nil slice, so a
// CreateV2 is a complete field set.
type CreateV2 struct {
	Fields
	// ScreeningQuestionsV2 carries the validated, normalized v2 screening
	// questions in submitted order. It is always non-nil after a successful
	// decode, an accepted empty array included.
	ScreeningQuestionsV2 []draftfields.ScreeningQuestionV2
	canonical            []byte
}

// DecodeCreateV2 composes a schema-2 create request from a raw POST body.
//
// The body must be exactly {"fields": {...}} and must not carry a client
// schema_version; the fields object may be empty. The body length is checked
// against MaxBodyBytes before decode. Every unchanged group receives its
// contract default; screening_questions defaults to a non-nil empty array.
func DecodeCreateV2(body []byte) (CreateV2, error) {
	if len(body) > MaxBodyBytes {
		return CreateV2{}, ErrPayloadTooLarge
	}

	value, err := draftjson.Decode(body)
	if err != nil {
		return CreateV2{}, fmt.Errorf("%w: %w", ErrInvalidRequest, err)
	}

	root, ok := value.(map[string]any)
	if !ok || root == nil || len(root) != 1 {
		return CreateV2{}, fmt.Errorf("%w: body must be exactly {\"fields\": {...}}", ErrInvalidRequest)
	}
	rawFields, present := root["fields"]
	if !present {
		return CreateV2{}, fmt.Errorf("%w: body must be exactly {\"fields\": {...}}", ErrInvalidRequest)
	}
	fieldsObject, ok := rawFields.(map[string]any)
	if !ok || fieldsObject == nil {
		return CreateV2{}, fmt.Errorf("%w: fields must be an object", ErrInvalidRequest)
	}

	for _, key := range slices.Sorted(maps.Keys(fieldsObject)) {
		if !slices.Contains(writableFieldKeys, key) {
			return CreateV2{}, fmt.Errorf("%w: unknown or read-only key %q", ErrInvalidRequest, key)
		}
	}

	if err := firstNestedKeyViolationV2(fieldsObject); err != nil {
		return CreateV2{}, err
	}

	return composeV2(fieldsObject)
}

// Fingerprint returns the canonical go-json-v1 bytes of the normalized field
// set wrapped as {"schema_version": 2, "fields": {...complete 17 fields...}}.
//
// The representation is deterministic: object property order is irrelevant,
// array order is meaningful and preserved, create defaults and normalized
// money decimals are included, and the schema_version 2 marker makes it the
// exact value accepted by ValidatePersistedDraftV2. The screening questions are
// projected with their exact per-variant keys.
//
// The returned slice is a fresh copy, so mutating it never changes the
// CreateV2.
func (c CreateV2) Fingerprint() []byte {
	return bytes.Clone(c.canonical)
}

// firstNestedKeyViolationV2 reports the first structural nested violation in the
// same order as the v1 precheck: requester, languages, screening_questions,
// compensation and description.
//
// The screening_questions slot runs screeningStructuralViolation, a bounded
// structural-only walk that inspects every question and option independently of
// any earlier value error and surfaces only the missing/unknown variant key
// sentinels, wrapping the underlying error so errors.Is still matches. Every
// other screening outcome is ignored here and re-derived by the value
// composition at the screening slot, so a screening value error never preempts
// an earlier group value error while a structural screening key still beats
// every value error, exactly as in v1. A non-object or null screening value is
// left to the value composition as well.
func firstNestedKeyViolationV2(fields map[string]any) error {
	if raw, present := fields["requester"]; present {
		if key, bad := unknownObjectKey(raw, requesterFieldKeys); bad {
			return fmt.Errorf("%w: unknown or read-only key %s", ErrInvalidRequest, "requester."+key)
		}
	}
	if raw, present := fields["languages"]; present {
		if items, ok := raw.([]any); ok {
			for i, item := range items {
				if key, bad := unknownObjectKey(item, languageFieldKeys); bad {
					return fmt.Errorf("%w: unknown or read-only key %s", ErrInvalidRequest, fmt.Sprintf("languages[%d].%s", i, key))
				}
			}
		}
	}
	if raw, present := fields["screening_questions"]; present {
		if err := screeningStructuralViolation(raw); err != nil {
			return fmt.Errorf("%w: %w", ErrInvalidRequest, err)
		}
	}
	if raw, present := fields["compensation"]; present {
		if key, bad := unknownObjectKey(raw, compensationFieldKeys); bad {
			return fmt.Errorf("%w: unknown or read-only key %s", ErrInvalidRequest, "compensation."+key)
		}
	}
	if raw, present := fields["description"]; present {
		if key, bad := unknownObjectKey(raw, descriptionFieldKeys); bad {
			return fmt.Errorf("%w: unknown or read-only key %s", ErrInvalidRequest, "description."+key)
		}
		if object, ok := raw.(map[string]any); ok && object != nil {
			if version, ok := object["schema_version"].(int64); !ok || version != schemaVersion {
				return fmt.Errorf("%w: unknown or read-only key %s", ErrInvalidRequest, "description.schema_version")
			}
			if violation, bad := firstRichKeyViolation(object["document"]); bad {
				return fmt.Errorf("%w: unknown or read-only key %s", ErrInvalidRequest, "description."+violation)
			}
		}
	}
	return nil
}

// Screening v2 structural vocabulary. These small allow-lists mirror the key
// sets owned by the draftfields present-value validator; they exist only so the
// structural preflight can inspect every question and option in one bounded
// walk without the validator's fail-fast value semantics. The value rules stay
// owned by ValidateScreeningQuestionsV2 and are never duplicated here.
var (
	screeningV2StructuralVariantKeys = map[string][]string{
		"open":                      {"id", "type", "prompt"},
		"single_choice_informative": {"id", "type", "prompt", "options"},
		"single_choice_evaluated":   {"id", "type", "prompt", "options", "correct_option_id"},
	}
	screeningV2StructuralOptionKeys = []string{"id", "label"}
)

// screeningStructuralViolation performs the bounded, structural-only screening
// preflight.
//
// It walks every question and every option independently of any value error in
// the group, so a later unknown or missing variant key is never hidden behind
// an earlier empty prompt or label. A question without a type key is a missing
// mandatory key; a non-object question, a non-string type, an unknown type
// literal, a present non-array options value and a non-object option are all
// left to the value composition and are not classified here. For a known type
// literal the type discriminates the allowed key set, an unknown key is
// reported before a missing mandatory key, and the keys are inspected in the
// variant's contract order.
//
// The returned error wraps draftfields.ErrScreeningV2UnknownKey or
// draftfields.ErrScreeningV2MissingKey with an exact field path, never returns a
// partial result and never mutates the input.
func screeningStructuralViolation(raw any) error {
	items, ok := raw.([]any)
	if !ok || items == nil {
		return nil
	}
	for i, item := range items {
		object, ok := item.(map[string]any)
		if !ok || object == nil {
			continue
		}
		rawType, present := object["type"]
		if !present {
			return fmt.Errorf("%w: screening_questions[%d].%s", draftfields.ErrScreeningV2MissingKey, i, "type")
		}
		typeName, ok := rawType.(string)
		if !ok {
			continue
		}
		allowed, known := screeningV2StructuralVariantKeys[typeName]
		if !known {
			continue
		}
		if key, bad := unknownObjectKey(object, allowed); bad {
			return fmt.Errorf("%w: screening_questions[%d].%q", draftfields.ErrScreeningV2UnknownKey, i, key)
		}
		for _, key := range allowed {
			if _, present := object[key]; !present {
				return fmt.Errorf("%w: screening_questions[%d].%s", draftfields.ErrScreeningV2MissingKey, i, key)
			}
		}
		if options, present := object["options"]; present {
			if err := screeningStructuralOptionViolation(options, i); err != nil {
				return err
			}
		}
	}
	return nil
}

// screeningStructuralOptionViolation walks the options of a known single-choice
// question independently. A non-array options value and a non-object option are
// left to the value composition. An unknown option key is reported before a
// missing mandatory option key.
func screeningStructuralOptionViolation(raw any, questionIndex int) error {
	items, ok := raw.([]any)
	if !ok || items == nil {
		return nil
	}
	for j, item := range items {
		object, ok := item.(map[string]any)
		if !ok || object == nil {
			continue
		}
		if key, bad := unknownObjectKey(object, screeningV2StructuralOptionKeys); bad {
			return fmt.Errorf("%w: screening_questions[%d].options[%d].%q", draftfields.ErrScreeningV2UnknownKey, questionIndex, j, key)
		}
		for _, key := range screeningV2StructuralOptionKeys {
			if _, present := object[key]; !present {
				return fmt.Errorf("%w: screening_questions[%d].options[%d].%s", draftfields.ErrScreeningV2MissingKey, questionIndex, j, key)
			}
		}
	}
	return nil
}

// composeV2 validates every field group, applies the create defaults and
// encodes the canonical schema-2 fingerprint. The group order mirrors the v1
// composer; only screening_questions uses the typed v2 validator.
func composeV2(object map[string]any) (CreateV2, error) {
	var out CreateV2

	scalars, err := draftfields.ValidateScalars(scalarSubmap(object))
	if err != nil {
		return CreateV2{}, validationError(err)
	}
	out.Title = scalars.Title
	out.Location = scalars.Location
	out.WorkMode = scalars.WorkMode
	out.WorkSchedule = scalars.WorkSchedule
	out.ContractType = scalars.ContractType
	out.Seniority = scalars.Seniority
	out.ProfessionalArea = scalars.ProfessionalArea
	out.RequiredRequirements = scalars.RequiredRequirements
	out.PreferredRequirements = scalars.PreferredRequirements

	if raw, present := object["skills"]; present {
		items, err := draftfields.ValidateSkills(raw)
		if err != nil {
			return CreateV2{}, validationError(err)
		}
		out.Skills = presentCollection(items)
	}
	if raw, present := object["custom_benefits"]; present {
		items, err := draftfields.ValidateCustomBenefits(raw)
		if err != nil {
			return CreateV2{}, validationError(err)
		}
		out.CustomBenefits = presentCollection(items)
	}
	if raw, present := object["benefits"]; present {
		items, err := draftfields.ValidateBenefits(raw)
		if err != nil {
			return CreateV2{}, validationError(err)
		}
		out.Benefits = presentCollection(items)
	}
	if raw, present := object["languages"]; present {
		items, err := draftfields.ValidateLanguages(raw)
		if err != nil {
			return CreateV2{}, validationError(err)
		}
		out.Languages = presentCollection(items)
	}
	if raw, present := object["screening_questions"]; present {
		questions, err := draftfields.ValidateScreeningQuestionsV2(raw)
		if err != nil {
			// Structural missing/unknown keys were already rejected by the
			// nested structural preflight; this keeps the same classification as
			// a defensive fallback and never changes value-error precedence.
			if screeningStructuralError(err) {
				return CreateV2{}, fmt.Errorf("%w: %w", ErrInvalidRequest, err)
			}
			return CreateV2{}, validationError(err)
		}
		out.ScreeningQuestionsV2 = questions
	}
	if raw, present := object["requester"]; present {
		requester, err := draftfields.ValidateRequester(raw)
		if err != nil {
			return CreateV2{}, validationError(err)
		}
		out.Requester = shared.Optional[*draftfields.Requester]{Set: true, Valid: requester != nil, Value: requester}
	}
	if raw, present := object["compensation"]; present {
		compensation, err := draftfields.ValidateCompensation(raw)
		if err != nil {
			return CreateV2{}, validationError(err)
		}
		out.Compensation = shared.Optional[draftfields.Compensation]{Set: true, Valid: true, Value: compensation}
	}

	var descriptionValue any
	if raw, present := object["description"]; present {
		document, err := draftrich.ValidateDocument(raw)
		if err != nil {
			if errors.Is(err, draftrich.ErrDocumentVersion) {
				return CreateV2{}, fmt.Errorf("%w: unsupported description schema version", ErrInvalidRequest)
			}
			return CreateV2{}, validationError(err)
		}
		descriptionValue = raw
		out.Description = shared.Optional[*draftrich.Document]{Set: true, Valid: document != nil, Value: document}
	}

	applyCreateDefaults(&out.Fields)
	// The v1 screening projection is never populated: the typed v2 questions
	// are carried by ScreeningQuestionsV2 and projected with their exact
	// per-variant keys below.
	out.Fields.ScreeningQuestions = shared.Optional[[]draftfields.ScreeningQuestion]{}
	if out.ScreeningQuestionsV2 == nil {
		out.ScreeningQuestionsV2 = []draftfields.ScreeningQuestionV2{}
	}

	projected := canonicalFields(out.Fields, descriptionValue)
	projected["screening_questions"] = screeningV2Values(out.ScreeningQuestionsV2)
	canonical, err := draftjson.EncodeValidatedValue(canonicalDocumentV2(projected))
	if err != nil {
		return CreateV2{}, fmt.Errorf("%w: %w", ErrInvalidRequest, err)
	}
	out.canonical = canonical
	return out, nil
}

// screeningStructuralError reports whether a screening v2 validator failure is
// structural (a missing or unknown variant key), which the create contract
// classifies as an invalid request rather than a value error.
func screeningStructuralError(err error) bool {
	return errors.Is(err, draftfields.ErrScreeningV2MissingKey) || errors.Is(err, draftfields.ErrScreeningV2UnknownKey)
}

// canonicalDocumentV2 wraps the normalized fields as the self-describing
// schema-2 fingerprint representation {"schema_version": 2, "fields": {...}}.
// The schema marker is the same numeric private draft schema version as the
// persisted v2 root.
func canonicalDocumentV2(fields map[string]any) map[string]any {
	return map[string]any{
		"schema_version": persistedDraftSchemaVersion,
		"fields":         fields,
	}
}

// screeningV2Values projects the typed v2 questions to the canonical wire
// array. Every variant emits exactly its own keys: open emits id/type/prompt,
// single_choice_informative adds options and single_choice_evaluated adds
// options and correct_option_id. The projection is derived from the validated
// typed value, so it can never emit a key of another variant.
func screeningV2Values(questions []draftfields.ScreeningQuestionV2) any {
	values := make([]any, 0, len(questions))
	for _, question := range questions {
		out := map[string]any{
			"id":     question.ID,
			"type":   question.Type,
			"prompt": question.Prompt,
		}
		if question.Options != nil {
			options := make([]any, 0, len(question.Options))
			for _, option := range question.Options {
				options = append(options, map[string]any{"id": option.ID, "label": option.Label})
			}
			out["options"] = options
		}
		if question.CorrectOptionID != "" {
			out["correct_option_id"] = question.CorrectOptionID
		}
		values = append(values, out)
	}
	return values
}
