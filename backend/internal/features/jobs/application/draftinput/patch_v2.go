// Schema-2 presence-only patch codec; no persistence or HTTP integration.
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

// PatchV2 carries only submitted schema-2 fields; legacy screening stays unset.
// ScreeningQuestionsV2 distinguishes omission from a supplied empty array.
type PatchV2 struct {
	Fields
	ScreeningQuestionsV2 shared.Optional[[]draftfields.ScreeningQuestionV2]
	canonical            []byte
}

// DecodePatchV2 validates an exact fields envelope without applying defaults.
// Present groups are fully replaced; empty fields return ErrEmptyPatch.
func DecodePatchV2(body []byte) (PatchV2, error) {
	if len(body) > MaxBodyBytes {
		return PatchV2{}, ErrPayloadTooLarge
	}

	value, err := draftjson.Decode(body)
	if err != nil {
		return PatchV2{}, fmt.Errorf("%w: %w", ErrInvalidRequest, err)
	}

	root, ok := value.(map[string]any)
	if !ok || root == nil || len(root) != 1 {
		return PatchV2{}, fmt.Errorf("%w: body must be exactly {\"fields\": {...}}", ErrInvalidRequest)
	}
	rawFields, present := root["fields"]
	if !present {
		return PatchV2{}, fmt.Errorf("%w: body must be exactly {\"fields\": {...}}", ErrInvalidRequest)
	}
	fieldsObject, ok := rawFields.(map[string]any)
	if !ok || fieldsObject == nil {
		return PatchV2{}, fmt.Errorf("%w: fields must be an object", ErrInvalidRequest)
	}

	for _, key := range slices.Sorted(maps.Keys(fieldsObject)) {
		if !slices.Contains(writableFieldKeysV2, key) {
			return PatchV2{}, fmt.Errorf("%w: unknown or read-only key %q", ErrInvalidRequest, key)
		}
	}

	if len(fieldsObject) == 0 {
		return PatchV2{}, ErrEmptyPatch
	}

	if err := firstNestedKeyViolationV2(fieldsObject); err != nil {
		return PatchV2{}, err
	}

	return composePatchV2(fieldsObject)
}

// Fingerprint returns an owned copy of the canonical schema-2 delta.
func (p PatchV2) Fingerprint() []byte { return bytes.Clone(p.canonical) }

// composePatchV2 preserves create/v1 value ordering but never applies defaults.
func composePatchV2(object map[string]any) (PatchV2, error) {
	var out PatchV2

	scalars, err := validateScalarsV2(object)
	if err != nil {
		return PatchV2{}, validationError(err)
	}
	out.Title = scalars.Title
	if err := composeGeography(object, &out.Fields); err != nil {
		return PatchV2{}, err
	}
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
			return PatchV2{}, validationError(err)
		}
		out.Skills = presentCollection(items)
	}
	if raw, present := object["custom_benefits"]; present {
		items, err := draftfields.ValidateCustomBenefits(raw)
		if err != nil {
			return PatchV2{}, validationError(err)
		}
		out.CustomBenefits = presentCollection(items)
	}
	if raw, present := object["benefits"]; present {
		items, err := draftfields.ValidateBenefits(raw)
		if err != nil {
			return PatchV2{}, validationError(err)
		}
		out.Benefits = presentCollection(items)
	}
	if raw, present := object["languages"]; present {
		items, err := draftfields.ValidateLanguagesV2(raw)
		if err != nil {
			return PatchV2{}, validationError(err)
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
				return PatchV2{}, fmt.Errorf("%w: %w", ErrInvalidRequest, err)
			}
			return PatchV2{}, validationError(err)
		}
		out.ScreeningQuestionsV2 = presentCollection(questions)
	}
	if raw, present := object["requester"]; present {
		requester, err := draftfields.ValidateRequester(raw)
		if err != nil {
			return PatchV2{}, validationError(err)
		}
		out.Requester = shared.Optional[*draftfields.Requester]{Set: true, Valid: requester != nil, Value: requester}
	}
	if raw, present := object["compensation"]; present {
		compensation, err := draftfields.ValidateCompensation(raw)
		if err != nil {
			return PatchV2{}, validationError(err)
		}
		out.Compensation = shared.Optional[draftfields.Compensation]{Set: true, Valid: true, Value: compensation}
	}

	var descriptionValue any
	if raw, present := object["description"]; present {
		document, err := draftrich.ValidateDocument(raw)
		if err != nil {
			if errors.Is(err, draftrich.ErrDocumentVersion) {
				return PatchV2{}, fmt.Errorf("%w: unsupported description schema version", ErrInvalidRequest)
			}
			return PatchV2{}, validationError(err)
		}
		descriptionValue = raw
		out.Description = shared.Optional[*draftrich.Document]{Set: true, Valid: document != nil, Value: document}
	}

	if err := composeRequirementsV2(object, &out.Fields); err != nil {
		return PatchV2{}, err
	}
	projected := canonicalFieldsV2(out.Fields, descriptionValue)
	if out.ScreeningQuestionsV2.Set {
		projected["screening_questions"] = screeningV2Values(out.ScreeningQuestionsV2.Value)
	}
	canonical, err := draftjson.EncodeValidatedValue(canonicalDocumentV2(projected))
	if err != nil {
		return PatchV2{}, fmt.Errorf("%w: %w", ErrInvalidRequest, err)
	}
	out.canonical = canonical
	return out, nil
}
