// Package draftinput composes the strict, normalized writable field input of a
// private vacancy draft create (POST) and explicit save (PATCH) request.
//
// Scope: this package is the pure request composer. It owns the exact
// {"fields": {...}} request envelope, the 1048576-byte request body budget, the
// writable field vocabulary, the create defaults and the canonical field
// fingerprint. It delegates every value rule to the approved field group
// validators (draftfields for scalars, collections, requester and languages,
// compensation; draftrich for the rich description) and reuses the strict
// draftjson decoder and canonical encoder unchanged.
//
// It performs no database, HTTP, network, catalog or organization access, no
// idempotency or ETag handling and no persistence. In particular, the requester
// organization and kind ownership lookup explicitly remains persistence work:
// this composer only checks that kind and id are lexically valid.
//
// DecodeCreate and DecodePatch accept the exact request envelope
// {"fields": {...}} and nothing else. A create body may carry an empty fields
// object (an empty draft); a patch body must not (400 empty_patch). The raw
// body is rejected before decode when it exceeds MaxBodyBytes; it is then
// decoded with the strict draftjson decoder, which rejects duplicate keys,
// invalid UTF-8, lone surrogate escapes, non-integer numbers and trailing data.
//
// Field semantics:
//
//   - Create applies the contract defaults: an omitted scalar or nullable
//     object becomes null, an omitted list becomes [], an omitted compensation
//     receives DefaultCompensation and an omitted description becomes null.
//   - Patch is presence-only: an omitted field stays absent (unchanged for a
//     later persistence step) and a present field is fully replaced. No nested
//     merge is ever performed, and a list set to null is invalid.
//
// The derived fields are never writable: description_plain and the nested
// requester.name are rejected as unknown/read-only keys. The derived plain text
// is exposed read-only through DescriptionPlain and is absent exactly when the
// rich description is null.
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
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancygeo"
	shared "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
)

// MaxBodyBytes is the inclusive request body limit, enforced before decode.
// A body longer than MaxBodyBytes is rejected with ErrPayloadTooLarge; field
// limits are separate and are enforced after decode by the group validators.
const MaxBodyBytes = 1048576

// Request-shape and value sentinels. DecodeCreate and DecodePatch never return
// a partial Fields alongside a non-nil error.
var (
	// ErrPayloadTooLarge rejects a raw body longer than MaxBodyBytes. It is
	// checked before any decode work.
	ErrPayloadTooLarge = errors.New("draftinput: request body exceeds 1048576 bytes")
	// ErrInvalidRequest rejects a body that cannot be understood as the
	// accepted request shape: malformed or non-strict JSON, a root that is not
	// exactly {"fields": {...}}, an unknown or read-only key at any level of a
	// delegated object, or an unsupported rich description schema_version.
	ErrInvalidRequest = errors.New("draftinput: invalid request body")
	// ErrValidation rejects a recognized writable field whose value violates
	// its field contract. It always wraps the underlying group validator error,
	// so callers may match a specific group sentinel with errors.Is.
	ErrValidation = errors.New("draftinput: field validation failed")
	// ErrEmptyPatch rejects a patch body whose fields object has no keys.
	ErrEmptyPatch = errors.New("draftinput: patch fields object is empty")
)

// Fields is the normalized writable field set of a private vacancy draft.
//
// Every field is tri-state through shared.Optional: absent (Set==false) means
// the key was not submitted, present-null (Set==true, Valid==false) means the
// key was submitted as JSON null and present-value (Set==true, Valid==true)
// carries the normalized value. Scalars, the requester object, the description
// object, compensation and every list use the same shape.
//
// After DecodeCreate every field is present (Set==true), so a create is a
// complete field set with contract defaults already applied. After DecodePatch
// only submitted fields are present, so a patch is a presence-only delta.
//
// Returned values are owned: no slice or pointer aliases the request bytes, and
// validators always allocate fresh results.
type Fields struct {
	// Schema-2-only requirement fields; absent in the historical v1 codec.
	MinYearsOfExperience       shared.Optional[string]
	MinEducationLevel          shared.Optional[string]
	AcceptsInProgressEducation shared.Optional[bool]
	Title                      shared.Optional[string]
	Location                   shared.Optional[*vacancygeo.Location]
	RemoteScope                shared.Optional[*vacancygeo.RemoteScope]
	WorkMode                   shared.Optional[string]
	WorkSchedule               shared.Optional[string]
	ContractType               shared.Optional[string]
	Seniority                  shared.Optional[string]
	ProfessionalArea           shared.Optional[string]
	Requester                  shared.Optional[*draftfields.Requester]
	Skills                     shared.Optional[[]string]
	Languages                  shared.Optional[[]draftfields.Language]
	Benefits                   shared.Optional[[]string]
	CustomBenefits             shared.Optional[[]string]
	RequiredRequirements       shared.Optional[string]
	PreferredRequirements      shared.Optional[string]
	ScreeningQuestions         shared.Optional[[]draftfields.ScreeningQuestion]
	Compensation               shared.Optional[draftfields.Compensation]
	Description                shared.Optional[*draftrich.Document]
}

// Create is the result of a valid POST body and carries a complete, defaulted
// writable field set plus its canonical fingerprint bytes.
type Create struct {
	Fields
	canonical []byte
}

// Patch is the result of a valid PATCH body and carries the presence-only set
// of submitted normalized fields plus the canonical fingerprint bytes of that
// exact delta.
type Patch struct {
	Fields
	canonical []byte
}

// DecodeCreate composes a create request from a raw POST body.
//
// The body must be exactly {"fields": {...}}; the fields object may be empty.
// The body length is checked against MaxBodyBytes before decode. Every omitted
// field receives its contract default, so the returned Create is a complete
// field set.
func DecodeCreate(body []byte) (Create, error) {
	fields, canonical, err := decode(body, false)
	if err != nil {
		return Create{}, err
	}
	return Create{Fields: fields, canonical: canonical}, nil
}

// DecodePatch composes an explicit-save request from a raw PATCH body.
//
// The body must be exactly {"fields": {...}}; the fields object must not be
// empty, or ErrEmptyPatch is returned. Only submitted fields are present in the
// result and every present field is fully replaced. No nested merge and no
// cross-field revalidation of absent fields is performed.
func DecodePatch(body []byte) (Patch, error) {
	fields, canonical, err := decode(body, true)
	if err != nil {
		return Patch{}, err
	}
	return Patch{Fields: fields, canonical: canonical}, nil
}

// Fingerprint returns the canonical go-json-v1 bytes of the normalized field
// set wrapped as {"schema_version": 1, "fields": {...}}.
//
// The representation is deterministic: object property order is irrelevant,
// array order is meaningful and preserved, create defaults and normalized
// money decimals are included, and the explicit schema_version 1 makes the
// representation self-describing. It is the POST idempotency fingerprint input
// described by the accepted contract.
//
// The returned slice is a fresh copy, so mutating it never changes the Create.
func (c Create) Fingerprint() []byte {
	return bytes.Clone(c.canonical)
}

// Fingerprint returns the canonical go-json-v1 bytes of the submitted patch
// delta wrapped as {"schema_version": 1, "fields": {...}} with only the fields
// present in the patch. The returned slice is a fresh copy.
func (p Patch) Fingerprint() []byte {
	return bytes.Clone(p.canonical)
}

// DescriptionPlain returns the derived plain text of the rich description. The
// boolean is false exactly when the description is null, which is the only case
// where the derived plain value is null. A non-null description with an empty
// paragraph returns an empty string with true, which is distinct from null.
//
// The derived value is server-side only and is never writable: a
// description_plain key in the request body is rejected as an unknown key.
func (f Fields) DescriptionPlain() (string, bool) {
	if !f.Description.Set || !f.Description.Valid || f.Description.Value == nil {
		return "", false
	}
	return f.Description.Value.Plain, true
}

// schemaVersion is the numeric private draft schema version carried by the
// canonical fingerprint representation.
const schemaVersion int64 = 1

// Writable field key vocabulary. writableFieldKeys is the exact set accepted at
// the fields object root; the remaining lists are the exact key sets of the
// nested objects that are delegated to a group validator. The request layer
// owns these shapes, so an unknown or read-only key is a request error and
// never a value error.
var (
	writableFieldKeys = []string{
		"title",
		"location",
		"remote_scope",
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
	scalarFieldKeys            = []string{"title", "work_mode", "work_schedule", "contract_type", "seniority", "professional_area", "required_requirements", "preferred_requirements"}
	requesterFieldKeys         = []string{"kind", "id"}
	languageFieldKeys          = []string{"language", "custom_name", "level"}
	screeningQuestionFieldKeys = []string{"prompt"}
	compensationFieldKeys      = []string{"mode", "amount", "min", "max", "currency", "pay_period", "basis", "public_visible"}
	descriptionFieldKeys       = []string{"schema_version", "document"}

	// Rich description key vocabularies. Only the key sets of known node and
	// mark types are checked here; the rich grammar and every attribute value
	// stay owned by draftrich and remain value errors.
	richNodeKeys = map[string][]string{
		"doc":         {"type", "content"},
		"paragraph":   {"type", "content"},
		"bulletList":  {"type", "content"},
		"orderedList": {"type", "attrs", "content"},
		"listItem":    {"type", "content"},
		"text":        {"type", "text", "marks"},
		"hardBreak":   {"type", "marks"},
	}
	richMarkKeys = map[string][]string{
		"bold":           {"type"},
		"italic":         {"type"},
		"fontSizePreset": {"type", "attrs"},
		"link":           {"type", "attrs"},
	}
	richOrderedListAttrKeys    = []string{"start", "type"}
	richFontSizePresetAttrKeys = []string{"preset"}
	richLinkAttrKeys           = []string{"href", "target", "rel", "class", "title"}
)

// decode is the shared create/patch composition pipeline.
//
// Order: body budget, strict raw decode, exact envelope shape, writable key
// vocabulary, nested key vocabulary and rich version, then the delegated field
// groups, then create defaults and finally the canonical fingerprint encoding.
// No partial result is ever returned with an error.
func decode(body []byte, patch bool) (Fields, []byte, error) {
	if len(body) > MaxBodyBytes {
		return Fields{}, nil, ErrPayloadTooLarge
	}

	value, err := draftjson.Decode(body)
	if err != nil {
		return Fields{}, nil, fmt.Errorf("%w: %w", ErrInvalidRequest, err)
	}

	root, ok := value.(map[string]any)
	if !ok || root == nil || len(root) != 1 {
		return Fields{}, nil, fmt.Errorf("%w: body must be exactly {\"fields\": {...}}", ErrInvalidRequest)
	}
	rawFields, present := root["fields"]
	if !present {
		return Fields{}, nil, fmt.Errorf("%w: body must be exactly {\"fields\": {...}}", ErrInvalidRequest)
	}
	fieldsObject, ok := rawFields.(map[string]any)
	if !ok || fieldsObject == nil {
		return Fields{}, nil, fmt.Errorf("%w: fields must be an object", ErrInvalidRequest)
	}

	for _, key := range slices.Sorted(maps.Keys(fieldsObject)) {
		if !slices.Contains(writableFieldKeys, key) {
			return Fields{}, nil, fmt.Errorf("%w: unknown or read-only key %q", ErrInvalidRequest, key)
		}
	}

	if patch && len(fieldsObject) == 0 {
		return Fields{}, nil, ErrEmptyPatch
	}

	if path, rejected := firstNestedKeyViolation(fieldsObject); rejected {
		return Fields{}, nil, fmt.Errorf("%w: unknown or read-only key %s", ErrInvalidRequest, path)
	}

	return compose(fieldsObject, patch)
}

// firstNestedKeyViolation reports the first unknown or read-only key inside a
// delegated object, or an unsupported rich description schema version. A value
// that is not an object is left to the group validator, which owns the
// wrong-type classification.
func firstNestedKeyViolation(fields map[string]any) (string, bool) {
	if path, bad := geographyKeyViolation(fields); bad {
		return path, true
	}
	if raw, present := fields["requester"]; present {
		if key, bad := unknownObjectKey(raw, requesterFieldKeys); bad {
			return "requester." + key, true
		}
	}
	if raw, present := fields["languages"]; present {
		if items, ok := raw.([]any); ok {
			for i, item := range items {
				if key, bad := unknownObjectKey(item, languageFieldKeys); bad {
					return fmt.Sprintf("languages[%d].%s", i, key), true
				}
			}
		}
	}
	if raw, present := fields["screening_questions"]; present {
		if items, ok := raw.([]any); ok {
			for i, item := range items {
				if key, bad := unknownObjectKey(item, screeningQuestionFieldKeys); bad {
					return fmt.Sprintf("screening_questions[%d].%s", i, key), true
				}
			}
		}
	}
	if raw, present := fields["compensation"]; present {
		if key, bad := unknownObjectKey(raw, compensationFieldKeys); bad {
			return "compensation." + key, true
		}
	}
	if raw, present := fields["description"]; present {
		if key, bad := unknownObjectKey(raw, descriptionFieldKeys); bad {
			return "description." + key, true
		}
		if object, ok := raw.(map[string]any); ok && object != nil {
			if version, ok := object["schema_version"].(int64); !ok || version != schemaVersion {
				return "description.schema_version", true
			}
			if violation, bad := firstRichKeyViolation(object["document"]); bad {
				return "description." + violation, true
			}
		}
	}
	return "", false
}

// unknownObjectKey returns the first key of object outside allowed, in sorted
// order so the reported path is deterministic. A non-object value reports no
// violation.
func unknownObjectKey(raw any, allowed []string) (string, bool) {
	object, ok := raw.(map[string]any)
	if !ok || object == nil {
		return "", false
	}
	for _, key := range slices.Sorted(maps.Keys(object)) {
		if !slices.Contains(allowed, key) {
			return key, true
		}
	}
	return "", false
}

// firstRichKeyViolation walks the decoded rich document subtree and reports the
// first key outside the known vocabulary of a known node or mark type.
//
// It is deliberately not a grammar validator: an unknown node or mark type, a
// missing or wrongly typed member and every attribute value rule stay owned by
// draftrich and are reported as value errors. Only the key sets of known types
// are inspected, which keeps this classification bounded by the decoder's depth
// and value limits without duplicating the rich grammar.
func firstRichKeyViolation(raw any) (string, bool) {
	node, ok := raw.(map[string]any)
	if !ok || node == nil {
		return "", false
	}
	return walkRichNode(node, "document")
}

// walkRichNode checks one known node and recurses into its content children.
func walkRichNode(node map[string]any, path string) (string, bool) {
	kind, ok := node["type"].(string)
	if !ok {
		return "", false
	}
	allowed, known := richNodeKeys[kind]
	if !known {
		return "", false
	}
	if key, bad := unknownObjectKey(node, allowed); bad {
		return path + "." + key, true
	}

	if kind == "orderedList" {
		if key, bad := unknownObjectKey(node["attrs"], richOrderedListAttrKeys); bad {
			return path + ".attrs." + key, true
		}
	}
	if violation, bad := walkRichMarks(node["marks"], path); bad {
		return violation, true
	}

	children, ok := node["content"].([]any)
	if !ok {
		return "", false
	}
	for i, child := range children {
		childNode, ok := child.(map[string]any)
		if !ok || childNode == nil {
			continue
		}
		if violation, bad := walkRichNode(childNode, fmt.Sprintf("%s.content[%d]", path, i)); bad {
			return violation, true
		}
	}
	return "", false
}

// walkRichMarks checks the marks of one node against the known mark key sets.
func walkRichMarks(raw any, path string) (string, bool) {
	marks, ok := raw.([]any)
	if !ok {
		return "", false
	}
	for i, item := range marks {
		mark, ok := item.(map[string]any)
		if !ok || mark == nil {
			continue
		}
		kind, ok := mark["type"].(string)
		if !ok {
			continue
		}
		allowed, known := richMarkKeys[kind]
		if !known {
			continue
		}
		if key, bad := unknownObjectKey(mark, allowed); bad {
			return fmt.Sprintf("%s.marks[%d].%s", path, i, key), true
		}
		switch kind {
		case "fontSizePreset":
			if key, bad := unknownObjectKey(mark["attrs"], richFontSizePresetAttrKeys); bad {
				return fmt.Sprintf("%s.marks[%d].attrs.%s", path, i, key), true
			}
		case "link":
			if key, bad := unknownObjectKey(mark["attrs"], richLinkAttrKeys); bad {
				return fmt.Sprintf("%s.marks[%d].attrs.%s", path, i, key), true
			}
		}
	}
	return "", false
}

// compose validates every delegated field group, applies create defaults and
// encodes the canonical fingerprint. descriptionValue is the already validated
// dynamic rich description (nil for null), reused verbatim so the fingerprint
// embeds the exact canonical rich bytes.
func compose(object map[string]any, patch bool) (Fields, []byte, error) {
	var out Fields

	scalars, err := draftfields.ValidateScalars(scalarSubmap(object))
	if err != nil {
		return Fields{}, nil, validationError(err)
	}
	out.Title = scalars.Title
	if err := composeGeography(object, &out); err != nil {
		return Fields{}, nil, err
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
			return Fields{}, nil, validationError(err)
		}
		out.Skills = presentCollection(items)
	}
	if raw, present := object["custom_benefits"]; present {
		items, err := draftfields.ValidateCustomBenefits(raw)
		if err != nil {
			return Fields{}, nil, validationError(err)
		}
		out.CustomBenefits = presentCollection(items)
	}
	if raw, present := object["benefits"]; present {
		items, err := draftfields.ValidateBenefits(raw)
		if err != nil {
			return Fields{}, nil, validationError(err)
		}
		out.Benefits = presentCollection(items)
	}
	if raw, present := object["languages"]; present {
		items, err := draftfields.ValidateLanguages(raw)
		if err != nil {
			return Fields{}, nil, validationError(err)
		}
		out.Languages = presentCollection(items)
	}
	if raw, present := object["screening_questions"]; present {
		items, err := draftfields.ValidateScreeningQuestions(raw)
		if err != nil {
			return Fields{}, nil, validationError(err)
		}
		out.ScreeningQuestions = presentCollection(items)
	}
	if raw, present := object["requester"]; present {
		requester, err := draftfields.ValidateRequester(raw)
		if err != nil {
			return Fields{}, nil, validationError(err)
		}
		out.Requester = shared.Optional[*draftfields.Requester]{Set: true, Valid: requester != nil, Value: requester}
	}
	if raw, present := object["compensation"]; present {
		compensation, err := draftfields.ValidateCompensation(raw)
		if err != nil {
			return Fields{}, nil, validationError(err)
		}
		out.Compensation = shared.Optional[draftfields.Compensation]{Set: true, Valid: true, Value: compensation}
	}

	var descriptionValue any
	if raw, present := object["description"]; present {
		document, err := draftrich.ValidateDocument(raw)
		if err != nil {
			if errors.Is(err, draftrich.ErrDocumentVersion) {
				return Fields{}, nil, fmt.Errorf("%w: unsupported description schema version", ErrInvalidRequest)
			}
			return Fields{}, nil, validationError(err)
		}
		descriptionValue = raw
		out.Description = shared.Optional[*draftrich.Document]{Set: true, Valid: document != nil, Value: document}
	}

	if !patch {
		applyCreateDefaults(&out)
	}

	canonical, err := draftjson.EncodeValidatedValue(canonicalDocument(out, descriptionValue))
	if err != nil {
		return Fields{}, nil, fmt.Errorf("%w: %w", ErrInvalidRequest, err)
	}
	return out, canonical, nil
}

// scalarSubmap extracts the scalar group from the fields object, preserving
// presence, so the scalar validator never sees a key from another group. The
// result is always non-nil, which is valid for an empty patch.
func scalarSubmap(object map[string]any) map[string]any {
	submap := make(map[string]any, len(scalarFieldKeys))
	for _, key := range scalarFieldKeys {
		if value, present := object[key]; present {
			submap[key] = value
		}
	}
	return submap
}

// presentCollection wraps a validated list as a present value. Validators
// always return freshly allocated slices, including a non-nil empty slice for
// an accepted empty array.
func presentCollection[T any](items []T) shared.Optional[[]T] {
	return shared.Optional[[]T]{Set: true, Valid: true, Value: items}
}

// validationError classifies a group validator failure, keeping the underlying
// error matchable with errors.Is.
func validationError(err error) error {
	return fmt.Errorf("%w: %w", ErrValidation, err)
}

// applyCreateDefaults fills every absent field of a create with its contract
// default: a scalar or nullable object becomes null, a list becomes a non-nil
// empty list and compensation receives DefaultCompensation.
func applyCreateDefaults(fields *Fields) {
	fields.Title = withNullDefault(fields.Title)
	fields.Location = withNullDefault(fields.Location)
	fields.RemoteScope = withNullDefault(fields.RemoteScope)
	fields.WorkMode = withNullDefault(fields.WorkMode)
	fields.WorkSchedule = withNullDefault(fields.WorkSchedule)
	fields.ContractType = withNullDefault(fields.ContractType)
	fields.Seniority = withNullDefault(fields.Seniority)
	fields.ProfessionalArea = withNullDefault(fields.ProfessionalArea)
	fields.RequiredRequirements = withNullDefault(fields.RequiredRequirements)
	fields.PreferredRequirements = withNullDefault(fields.PreferredRequirements)
	fields.Requester = withNullDefault(fields.Requester)
	fields.Description = withNullDefault(fields.Description)

	fields.Skills = withEmptyDefault(fields.Skills)
	fields.Benefits = withEmptyDefault(fields.Benefits)
	fields.CustomBenefits = withEmptyDefault(fields.CustomBenefits)
	fields.Languages = withEmptyDefault(fields.Languages)
	fields.ScreeningQuestions = withEmptyDefault(fields.ScreeningQuestions)

	if !fields.Compensation.Set {
		fields.Compensation = shared.Optional[draftfields.Compensation]{Set: true, Valid: true, Value: draftfields.DefaultCompensation()}
	}
}

// withNullDefault turns an absent field into a present null.
func withNullDefault[T any](opt shared.Optional[T]) shared.Optional[T] {
	if opt.Set {
		return opt
	}
	return shared.Optional[T]{Set: true}
}

// withEmptyDefault turns an absent list into a present non-nil empty list.
func withEmptyDefault[T any](opt shared.Optional[[]T]) shared.Optional[[]T] {
	if opt.Set {
		return opt
	}
	return shared.Optional[[]T]{Set: true, Valid: true, Value: []T{}}
}

// canonicalDocument wraps the normalized fields as the self-describing
// fingerprint representation {"schema_version": 1, "fields": {...}}.
func canonicalDocument(fields Fields, descriptionValue any) map[string]any {
	return map[string]any{
		"schema_version": schemaVersion,
		"fields":         canonicalFields(fields, descriptionValue),
	}
}

// canonicalFields builds the JSON-compatible normalized field map included in
// the fingerprint. Only fields present in the composition appear; for a create
// that is every field, for a patch only the submitted delta.
func canonicalFields(fields Fields, descriptionValue any) map[string]any {
	out := make(map[string]any, len(writableFieldKeys))

	setNullableScalar(out, "title", fields.Title)
	if fields.Location.Set {
		out["location"] = vacancygeo.LocationValue(fields.Location.Value)
	}
	if fields.RemoteScope.Set {
		out["remote_scope"] = vacancygeo.RemoteValue(fields.RemoteScope.Value)
	}
	setNullableScalar(out, "work_mode", fields.WorkMode)
	setNullableScalar(out, "work_schedule", fields.WorkSchedule)
	setNullableScalar(out, "contract_type", fields.ContractType)
	setNullableScalar(out, "seniority", fields.Seniority)
	setNullableScalar(out, "professional_area", fields.ProfessionalArea)
	setNullableScalar(out, "required_requirements", fields.RequiredRequirements)
	setNullableScalar(out, "preferred_requirements", fields.PreferredRequirements)

	if fields.Requester.Set {
		out["requester"] = requesterValue(fields.Requester)
	}
	if fields.Skills.Set {
		out["skills"] = stringValues(fields.Skills)
	}
	if fields.Languages.Set {
		out["languages"] = languageValues(fields.Languages)
	}
	if fields.Benefits.Set {
		out["benefits"] = stringValues(fields.Benefits)
	}
	if fields.CustomBenefits.Set {
		out["custom_benefits"] = stringValues(fields.CustomBenefits)
	}
	if fields.ScreeningQuestions.Set {
		out["screening_questions"] = screeningQuestionValues(fields.ScreeningQuestions)
	}
	if fields.Compensation.Set {
		out["compensation"] = compensationValue(fields.Compensation.Value)
	}
	if fields.Description.Set {
		out["description"] = descriptionValue
	}

	return out
}

func setNullableScalar(out map[string]any, key string, opt shared.Optional[string]) {
	if !opt.Set {
		return
	}
	if !opt.Valid {
		out[key] = nil
		return
	}
	out[key] = opt.Value
}

func requesterValue(opt shared.Optional[*draftfields.Requester]) any {
	if !opt.Valid || opt.Value == nil {
		return nil
	}
	var id any
	if opt.Value.ID != nil {
		id = *opt.Value.ID
	}
	return map[string]any{"kind": opt.Value.Kind, "id": id}
}

func stringValues(opt shared.Optional[[]string]) any {
	if !opt.Valid {
		return nil
	}
	values := make([]any, 0, len(opt.Value))
	for _, value := range opt.Value {
		values = append(values, value)
	}
	return values
}

func languageValues(opt shared.Optional[[]draftfields.Language]) any {
	if !opt.Valid {
		return nil
	}
	values := make([]any, 0, len(opt.Value))
	for _, item := range opt.Value {
		values = append(values, map[string]any{
			"language":    item.Language,
			"custom_name": nullableString(item.CustomName),
			"level":       nullableString(item.Level),
		})
	}
	return values
}

func screeningQuestionValues(opt shared.Optional[[]draftfields.ScreeningQuestion]) any {
	if !opt.Valid {
		return nil
	}
	values := make([]any, 0, len(opt.Value))
	for _, item := range opt.Value {
		values = append(values, map[string]any{"prompt": item.Prompt})
	}
	return values
}

func compensationValue(comp draftfields.Compensation) any {
	return map[string]any{
		"mode":           nullableString(comp.Mode),
		"amount":         nullableString(comp.Amount),
		"min":            nullableString(comp.Min),
		"max":            nullableString(comp.Max),
		"currency":       nullableString(comp.Currency),
		"pay_period":     nullableString(comp.PayPeriod),
		"basis":          nullableString(comp.Basis),
		"public_visible": comp.PublicVisible,
	}
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}
