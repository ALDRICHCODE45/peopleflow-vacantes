// Package draftfields validates the non-rich scalar field group of a private
// vacancy draft.
//
// Scope: this package is only the scalar validator. It does not decode raw
// JSON, does not touch the rich or monetary string groups, does not apply a
// request body budget, does not normalize enums and does not persist or map
// any DTO. Its input is the already-decoded map[string]any produced by the
// strict draft JSON decoder; unknown keys, wrong dynamic types and
// out-of-limit values are rejected.
//
// The validator is presence-preserving: an absent field stays absent, an
// explicitly null field stays null and a field with a value is normalized and
// returned. No default is ever filled in. Any rejection returns a zero
// Scalars, so a caller that keeps the previous draft state never observes a
// partial result. The input map is read-only and is never mutated.
//
// Free text is trimmed of Unicode White_Space at both ends only: interior
// whitespace, U+FEFF, combining marks and every other rune are preserved
// verbatim and no Unicode NFC/NFD normalization is applied. A value that
// becomes empty after trimming becomes null. Enum values are exact literals
// and are never trimmed, case-folded or normalized.
package draftfields

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	shared "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
)

// Scalar key names of the private vacancy draft scalar group.
const (
	scalarKeyTitle                 = "title"
	scalarKeyLocation              = "location"
	scalarKeyRequiredRequirements  = "required_requirements"
	scalarKeyPreferredRequirements = "preferred_requirements"
	scalarKeyWorkMode              = "work_mode"
	scalarKeyWorkSchedule          = "work_schedule"
	scalarKeyContractType          = "contract_type"
	scalarKeySeniority             = "seniority"
	scalarKeyProfessionalArea      = "professional_area"
)

// Inclusive limits, applied after end-trimming.
const (
	maxTitleCodepoints    = 200
	maxLocationCodepoints = 300
	maxRequirementsBytes  = 16384
)

// Validation sentinels. Every rejected input returns a zero Scalars.
var (
	// ErrNilMap rejects a nil input map.
	ErrNilMap = errors.New("draftfields: nil input map")
	// ErrUnknownKey rejects a key outside the scalar group.
	ErrUnknownKey = errors.New("draftfields: unknown scalar key")
	// ErrWrongType rejects a non-string, non-null value.
	ErrWrongType = errors.New("draftfields: scalar must be a string or null")
	// ErrInvalidUTF8 rejects a Go string that is not valid UTF-8.
	ErrInvalidUTF8 = errors.New("draftfields: string is not valid utf-8")
	// ErrTooLong rejects a value above its codepoint or byte limit.
	ErrTooLong = errors.New("draftfields: scalar exceeds its limit")
	// ErrInvalidEnum rejects a value outside the exact literal set.
	ErrInvalidEnum = errors.New("draftfields: value is not an allowed literal")
)

// Exact enum literal sets. Enums are compared verbatim and are never trimmed,
// case-folded or Unicode-normalized.
var (
	allowedWorkModes         = []string{"onsite", "remote", "hybrid"}
	allowedWorkSchedules     = []string{"full_time", "part_time"}
	allowedContractTypes     = []string{"project", "indefinite", "professional_services", "temporary", "internship"}
	allowedSeniorities       = []string{"intern", "junior", "mid", "senior", "lead"}
	allowedProfessionalAreas = []string{
		"technology_systems",
		"engineering",
		"product",
		"design_creative",
		"sales_business_development",
		"marketing_communications",
		"administration_finance",
		"human_resources",
		"operations_production",
		"logistics_transport",
		"customer_service_support",
		"healthcare",
		"education_training",
		"legal",
		"construction_maintenance",
		"tourism_hospitality_gastronomy",
	}
)

// Scalars is the presence-preserving scalar subset of a private vacancy draft.
//
// Each field is tri-state: Set==false means the key was absent, Set==true with
// Valid==false means the key was present as null and Set==true with Valid==true
// carries the normalized value.
type Scalars struct {
	Title                 shared.Optional[string]
	Location              shared.Optional[string]
	RequiredRequirements  shared.Optional[string]
	PreferredRequirements shared.Optional[string]
	WorkMode              shared.Optional[string]
	WorkSchedule          shared.Optional[string]
	ContractType          shared.Optional[string]
	Seniority             shared.Optional[string]
	ProfessionalArea      shared.Optional[string]
}

// ValidateScalars validates the scalar subset of a decoded draft map.
//
// A nil map is rejected. An empty non-nil map is valid and leaves every field
// absent. Every key must belong to the scalar group: a key from another draft
// group (for example a monetary or rich string field) is rejected as unknown.
// Every present value must be null or a string; any other dynamic type rejects
// the whole group.
//
// Free text (title, location, required_requirements, preferred_requirements)
// is validated as UTF-8, trimmed of Unicode White_Space at both ends only and
// measured after trimming. Title is limited to 200 codepoints, location to 300
// codepoints and each requirements field to 16384 UTF-8 bytes. An empty result
// becomes null.
//
// Enums (work_mode, work_schedule, contract_type, seniority, professional_area)
// must match one of the exact literals below and are never trimmed or
// case-folded.
func ValidateScalars(raw map[string]any) (Scalars, error) {
	if raw == nil {
		return Scalars{}, ErrNilMap
	}

	for key := range raw {
		if !isScalarKey(key) {
			return Scalars{}, fmt.Errorf("%w: %q", ErrUnknownKey, key)
		}
	}

	var out Scalars

	for _, rule := range []struct {
		key           string
		maxCodepoints int
		maxBytes      int
		dst           *shared.Optional[string]
	}{
		{scalarKeyTitle, maxTitleCodepoints, 0, &out.Title},
		{scalarKeyLocation, maxLocationCodepoints, 0, &out.Location},
		{scalarKeyRequiredRequirements, 0, maxRequirementsBytes, &out.RequiredRequirements},
		{scalarKeyPreferredRequirements, 0, maxRequirementsBytes, &out.PreferredRequirements},
	} {
		if err := validateFreeText(raw, rule.key, rule.maxCodepoints, rule.maxBytes, rule.dst); err != nil {
			return Scalars{}, err
		}
	}

	for _, rule := range []struct {
		key     string
		allowed []string
		dst     *shared.Optional[string]
	}{
		{scalarKeyWorkMode, allowedWorkModes, &out.WorkMode},
		{scalarKeyWorkSchedule, allowedWorkSchedules, &out.WorkSchedule},
		{scalarKeyContractType, allowedContractTypes, &out.ContractType},
		{scalarKeySeniority, allowedSeniorities, &out.Seniority},
		{scalarKeyProfessionalArea, allowedProfessionalAreas, &out.ProfessionalArea},
	} {
		if err := validateEnum(raw, rule.key, rule.allowed, rule.dst); err != nil {
			return Scalars{}, err
		}
	}

	return out, nil
}

// isScalarKey reports whether key names one of the nine scalar-group fields.
func isScalarKey(key string) bool {
	switch key {
	case scalarKeyTitle,
		scalarKeyLocation,
		scalarKeyRequiredRequirements,
		scalarKeyPreferredRequirements,
		scalarKeyWorkMode,
		scalarKeyWorkSchedule,
		scalarKeyContractType,
		scalarKeySeniority,
		scalarKeyProfessionalArea:
		return true
	default:
		return false
	}
}

// lookupString reads one key and classifies its presence.
//
// It reports present==false for an absent key, isNull==true for a present
// JSON null and value for a present string. A present non-string is rejected
// with ErrWrongType and a present string that is not valid UTF-8 is rejected
// with ErrInvalidUTF8 before any trimming, counting or comparison.
func lookupString(raw map[string]any, key string) (value string, present, isNull bool, err error) {
	rawValue, ok := raw[key]
	if !ok {
		return "", false, false, nil
	}
	if rawValue == nil {
		return "", true, true, nil
	}
	text, ok := rawValue.(string)
	if !ok {
		return "", true, false, fmt.Errorf("%w: %s", ErrWrongType, key)
	}
	if !utf8.ValidString(text) {
		return "", true, false, fmt.Errorf("%w: %s", ErrInvalidUTF8, key)
	}
	return text, true, false, nil
}

// validateFreeText validates one free-text field into dst. The codepoint and
// byte limits are enforced after end-trimming; a limit of zero is not
// enforced. A value that trims to empty becomes null.
func validateFreeText(raw map[string]any, key string, maxCodepoints, maxBytes int, dst *shared.Optional[string]) error {
	value, present, isNull, err := lookupString(raw, key)
	if err != nil || !present {
		return err
	}
	if isNull {
		dst.Set = true
		return nil
	}

	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		dst.Set = true
		return nil
	}
	if maxCodepoints > 0 && utf8.RuneCountInString(trimmed) > maxCodepoints {
		return fmt.Errorf("%w: %s exceeds %d codepoints", ErrTooLong, key, maxCodepoints)
	}
	if maxBytes > 0 && len(trimmed) > maxBytes {
		return fmt.Errorf("%w: %s exceeds %d bytes", ErrTooLong, key, maxBytes)
	}

	dst.Set = true
	dst.Valid = true
	dst.Value = trimmed
	return nil
}

// validateEnum validates one enum field into dst against the exact allowed
// literals. The value is compared verbatim: no trimming, case-folding or
// normalization is applied.
func validateEnum(raw map[string]any, key string, allowed []string, dst *shared.Optional[string]) error {
	value, present, isNull, err := lookupString(raw, key)
	if err != nil || !present {
		return err
	}
	if isNull {
		dst.Set = true
		return nil
	}

	if !slices.Contains(allowed, value) {
		return fmt.Errorf("%w: %s", ErrInvalidEnum, key)
	}
	dst.Set = true
	dst.Valid = true
	dst.Value = value
	return nil
}
