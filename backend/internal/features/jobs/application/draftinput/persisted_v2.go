// Persisted private vacancy draft v2 complete-document validation.
//
// Scope: this additive file validates an already stored canonical schema-2
// document whose root is exactly {"schema_version": 2, "fields": {...}} and
// whose fields object carries the complete 17 writable fields. It is a pure
// value validator: it decodes with the strict draftjson technical limits,
// reuses the approved draftfields and draftrich validators and the composer's
// normalized wire projection helpers, and rejects any stored value that is not
// already canonical. It does not decode a client request, does not apply a
// request body budget, does not apply create defaults, does not repair stored
// bytes, does not touch a store, database, route, version dispatcher or HTTP
// envelope, and performs no persistence.
//
// The stored value is compared, never the raw JSON bytes: key order, JSON
// whitespace and JSON string escapes are accepted as long as the decoded
// values are canonical. The original input bytes and the decoded tree are only
// read and are never mutated.
//
// Error taxonomy:
//
//   - ErrPersistedDraftRoot: the decoded document is not the exact persisted
//     envelope. The root is not exactly {schema_version, fields}, the fields
//     value is not a non-nil object, the fields object is not exactly the 17
//     writable keys (missing or read-envelope metadata/derived keys), or the
//     strict decoder rejected malformed JSON, duplicate keys, invalid UTF-8, a
//     lone surrogate escape or a non-integer number.
//   - ErrPersistedDraftVersion: schema_version is present but is not the
//     integer 2.
//   - ErrPersistedDraftNonCanonical: a stored field value violates its
//     contract or differs from the normalized wire projection. The underlying
//     group validator error stays matchable with errors.Is.
//
// Every rejection is a later server invariant failure, not a client HTTP 400
// result; no HTTP mapping is introduced here.
package draftinput

import (
	"errors"
	"fmt"
	"maps"
	"reflect"
	"slices"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftfields"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftrich"
	shared "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
)

const (
	// persistedDraftSchemaVersion is the numeric schema marker of a stored
	// schema-2 private vacancy draft root.
	persistedDraftSchemaVersion int64 = 2
	// persistedDescriptionSchemaVersion is the unchanged nested rich
	// description envelope version. It is independent from the v1 fingerprint
	// and from the schema-2 read marker.
	persistedDescriptionSchemaVersion int64 = 1
)

// Persisted-document validation sentinels.
var (
	// ErrPersistedDraftRoot rejects a stored document whose decoded value is
	// not the exact persisted schema-2 envelope: wrong root shape, a fields
	// value that is not a non-nil object, a fields object that is not exactly
	// the 17 writable keys, or malformed/non-strict JSON rejected by the
	// strict decoder.
	ErrPersistedDraftRoot = errors.New("draftinput: persisted draft root is not the exact schema-2 envelope")
	// ErrPersistedDraftVersion rejects a stored document whose present
	// schema_version is not the integer 2. It is distinguishable from the
	// root and field errors.
	ErrPersistedDraftVersion = errors.New("draftinput: persisted draft schema version is not 2")
	// ErrPersistedDraftNonCanonical rejects a stored field value that violates
	// its contract or differs from the normalized wire projection. It always
	// wraps the underlying group validator error when there is one, so a
	// caller may still match a specific sentinel with errors.Is.
	ErrPersistedDraftNonCanonical = errors.New("draftinput: persisted draft value is not canonical")
)

// ValidatePersistedDraftV2 validates an already stored canonical schema-2
// private vacancy draft document.
//
// canonical is the stored byte slice. It is decoded with the strict draftjson
// decoder, so its technical depth and value limits apply while the request
// body budget does not: the persisted API has no 1048576-byte request cap.
// Encoding order, inter-token whitespace and JSON string escapes are
// irrelevant because only the decoded values are validated; the input bytes
// and the decoded tree are never mutated.
//
// The root must be exactly {"schema_version": 2, "fields": {...}} with a
// non-nil fields object holding exactly the 17 writable field keys, all
// present and none unknown: read-envelope metadata and derived keys are
// rejected. Every field group is validated with its approved validator and
// then compared against the normalized wire projection, so a stored value that
// a normalizer would trim, rewrite or empty into null is rejected instead of
// silently repaired. Screening questions are validated with the approved
// persisted screening v2 wrapper and are never fed through the v1 prompt-only
// projection. No create default is filled and no omitted field is repaired.
func ValidatePersistedDraftV2(canonical []byte) error {
	value, err := draftjson.Decode(canonical)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrPersistedDraftRoot, err)
	}

	root, ok := value.(map[string]any)
	if !ok || root == nil {
		return persistedRootError("root must be an object")
	}
	if _, present := root["schema_version"]; !present {
		return persistedRootError("root is missing schema_version")
	}
	if _, present := root["fields"]; !present {
		return persistedRootError("root is missing fields")
	}
	if len(root) != 2 {
		return persistedRootError("root must contain exactly schema_version and fields")
	}
	if version, ok := root["schema_version"].(int64); !ok || version != persistedDraftSchemaVersion {
		return fmt.Errorf("%w: got %v", ErrPersistedDraftVersion, root["schema_version"])
	}

	fields, ok := root["fields"].(map[string]any)
	if !ok || fields == nil {
		return persistedRootError("fields must be an object")
	}
	if err := persistedFieldsShape(fields); err != nil {
		return err
	}
	return persistedValidateFields(fields)
}

// persistedFieldsShape enforces the exact complete-17-key vocabulary of the
// stored fields object: no unknown/read-only key and no missing required key.
func persistedFieldsShape(fields map[string]any) error {
	for _, key := range slices.Sorted(maps.Keys(fields)) {
		if !slices.Contains(writableFieldKeys, key) {
			return persistedRootError("unknown or read-only key %q in fields", key)
		}
	}
	for _, key := range writableFieldKeys {
		if _, present := fields[key]; !present {
			return persistedRootError("missing required field %q", key)
		}
	}
	return nil
}

// persistedValidateFields validates every complete field group and then
// compares each stored value against its normalized wire projection. The
// comparison deliberately excludes screening_questions, which is owned by
// ValidatePersistedScreeningQuestionsV2 and must never be projected through the
// v1 prompt-only helper.
func persistedValidateFields(fields map[string]any) error {
	scalars, err := draftfields.ValidateScalars(scalarSubmap(fields))
	if err != nil {
		return persistedFieldError("fields", err)
	}
	requester, err := draftfields.ValidateRequester(fields["requester"])
	if err != nil {
		return persistedFieldError("fields.requester", err)
	}
	skills, err := draftfields.ValidateSkills(fields["skills"])
	if err != nil {
		return persistedFieldError("fields.skills", err)
	}
	languages, err := draftfields.ValidateLanguages(fields["languages"])
	if err != nil {
		return persistedFieldError("fields.languages", err)
	}
	benefits, err := draftfields.ValidateBenefits(fields["benefits"])
	if err != nil {
		return persistedFieldError("fields.benefits", err)
	}
	customBenefits, err := draftfields.ValidateCustomBenefits(fields["custom_benefits"])
	if err != nil {
		return persistedFieldError("fields.custom_benefits", err)
	}
	if err := draftfields.ValidatePersistedScreeningQuestionsV2(fields["screening_questions"]); err != nil {
		return persistedFieldError("fields.screening_questions", err)
	}
	compensation, err := draftfields.ValidateCompensation(fields["compensation"])
	if err != nil {
		return persistedFieldError("fields.compensation", err)
	}
	document, err := persistedValidateDescription(fields["description"])
	if err != nil {
		return err
	}

	// Build the normalized projection of the 16 non-screening groups and
	// compare it with the stored values. Only the projection values are
	// compared, never the raw stored bytes, so reordered keys, extra JSON
	// whitespace and JSON escapes are accepted.
	var projected Fields
	projected.Title = scalars.Title
	projected.Location = scalars.Location
	projected.WorkMode = scalars.WorkMode
	projected.WorkSchedule = scalars.WorkSchedule
	projected.ContractType = scalars.ContractType
	projected.Seniority = scalars.Seniority
	projected.ProfessionalArea = scalars.ProfessionalArea
	projected.RequiredRequirements = scalars.RequiredRequirements
	projected.PreferredRequirements = scalars.PreferredRequirements
	projected.Requester = shared.Optional[*draftfields.Requester]{Set: true, Valid: requester != nil, Value: requester}
	projected.Skills = presentCollection(skills)
	projected.Languages = presentCollection(languages)
	projected.Benefits = presentCollection(benefits)
	projected.CustomBenefits = presentCollection(customBenefits)
	projected.Compensation = shared.Optional[draftfields.Compensation]{Set: true, Valid: true, Value: compensation}
	projected.Description = shared.Optional[*draftrich.Document]{Set: true, Valid: document != nil, Value: document}

	projectedValues := canonicalFields(projected, fields["description"])
	for _, key := range writableFieldKeys {
		if key == "screening_questions" {
			continue
		}
		if !reflect.DeepEqual(fields[key], projectedValues[key]) {
			return persistedValueError(key)
		}
	}
	return nil
}

// persistedValidateDescription validates the stored rich description envelope.
//
// A null description is valid. A non-null value must keep the exact schema-1
// envelope keys and version and the draftrich grammar, which preserves the
// submitted text and href. The envelope key and version checks mirror the v1
// composer; the grammar, node types, attributes and limits stay owned by
// draftrich. No new rich normalization is invented.
func persistedValidateDescription(raw any) (*draftrich.Document, error) {
	if key, bad := unknownObjectKey(raw, descriptionFieldKeys); bad {
		return nil, persistedValueError("description." + key)
	}
	if object, ok := raw.(map[string]any); ok && object != nil {
		if version, ok := object["schema_version"].(int64); !ok || version != persistedDescriptionSchemaVersion {
			return nil, persistedValueError("description.schema_version")
		}
		if violation, bad := firstRichKeyViolation(object["document"]); bad {
			return nil, persistedValueError("description." + violation)
		}
	}
	document, err := draftrich.ValidateDocument(raw)
	if err != nil {
		return nil, persistedFieldError("fields.description", err)
	}
	return document, nil
}

// persistedRootError classifies a stored-envelope structural rejection.
func persistedRootError(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrPersistedDraftRoot, fmt.Sprintf(format, args...))
}

// persistedValueError reports a stored value that differs from its normalized
// wire projection, without an underlying validator error.
func persistedValueError(key string) error {
	return fmt.Errorf("%w: fields.%s", ErrPersistedDraftNonCanonical, key)
}

// persistedFieldError classifies a stored field that a group validator
// rejected, preserving the underlying error for errors.Is.
func persistedFieldError(path string, err error) error {
	return fmt.Errorf("%w: %s: %w", ErrPersistedDraftNonCanonical, path, err)
}
