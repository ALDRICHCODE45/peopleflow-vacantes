// Nested requester and language group of a private vacancy draft.
//
// Scope: this file implements only the two nested-value validators. It does not
// decode raw JSON, does not validate the scalar, rich string, compensation or
// collection groups and does not persist or map any DTO. Its input is the
// already-decoded value produced by the strict draft JSON decoder. The file is
// self-contained: it depends on no other draftfields file, reuses no B6 or B8
// helper and only imports the standard library.
//
// ValidateRequester treats JSON null as a valid "no requester" value and
// returns a nil *Requester with a nil error; any other non-nil input must be an
// exact non-nil map[string]any whose only keys are the mandatory kind and id.
// kind is the exact literal internal_area or client and may not be null. id is
// either null or a lexical UUID in the canonical 36-character form
// 8-4-4-4-12 with ASCII hex digits and hyphens at byte positions 8, 13, 18 and
// 23; the version and variant nibbles are unrestricted and the submitted case
// is preserved verbatim. No trimming, case-folding, catalog, organization or
// kind-ownership lookup and no default is ever applied.
//
// ValidateLanguages requires an exact non-nil []any of at most 100 items. Each
// item must be an exact non-nil map[string]any whose only keys are the
// mandatory language, custom_name and level. language is the exact literal es,
// en or other and may not be null; level is null or the exact literal basic,
// intermediate, advanced or native. custom_name is null or a valid UTF-8
// string that is end-trimmed of Unicode White_Space, becomes null when empty
// and is limited to 200 codepoints; interior whitespace, U+FEFF, combining
// marks and the submitted case are preserved. Normalization runs before the
// es/en rule, so a custom_name that trims to empty satisfies it while a
// substantive value is rejected for es and en; other may carry either. Enums
// are compared verbatim and duplicates, order and every other submitted value
// are preserved with no CEFR mapping, NFC normalization or deduplication.
//
// Every rejected input returns a nil output, so a caller never observes a
// partial result. Accepted results are freshly allocated: no returned pointer
// or slice aliases the input or any other result, and the input is only read,
// never mutated.
package draftfields

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

// Requester wire key names.
const (
	requesterKeyKind = "kind"
	requesterKeyID   = "id"
)

// Language wire key names.
const (
	languageKeyLanguage   = "language"
	languageKeyCustomName = "custom_name"
	languageKeyLevel      = "level"
)

// Limits for the nested requester and language group.
const (
	// maxLanguageItems is the inclusive item limit of the languages array.
	maxLanguageItems = 100
	// maxLanguageCustomNameCodepoints is the inclusive codepoint limit of a
	// custom language name after end-trimming.
	maxLanguageCustomNameCodepoints = 200
)

// Exact enum literal sets. Values are compared verbatim and are never trimmed,
// case-folded or Unicode-normalized.
var (
	allowedRequesterKinds = []string{"internal_area", "client"}
	allowedLanguages      = []string{"es", "en", "other"}
	allowedLanguageLevels = []string{"basic", "intermediate", "advanced", "native"}
)

// requesterKeyOrder lists the two required requester keys.
var requesterKeyOrder = []string{requesterKeyKind, requesterKeyID}

// languageKeyOrder lists the three required language keys.
var languageKeyOrder = []string{languageKeyLanguage, languageKeyCustomName, languageKeyLevel}

// Requester validation sentinels. Every rejected input returns a nil
// *Requester; a nil input is valid and returns nil, nil.
var (
	// errRequesterNotObject rejects a non-nil input that is not a non-nil map.
	errRequesterNotObject = errors.New("draftfields: requester is not a non-nil object")
	// errRequesterMissingKey rejects an object without kind or id.
	errRequesterMissingKey = errors.New("draftfields: missing requester key")
	// errRequesterUnknownKey rejects a key outside kind and id.
	errRequesterUnknownKey = errors.New("draftfields: unknown requester key")
	// errRequesterWrongType rejects a value of the wrong dynamic type.
	errRequesterWrongType = errors.New("draftfields: requester value has the wrong type")
	// errRequesterInvalidKind rejects a kind outside the exact literal set.
	errRequesterInvalidKind = errors.New("draftfields: requester kind is not an allowed literal")
	// errRequesterInvalidID rejects an id that is not a lexical UUID.
	errRequesterInvalidID = errors.New("draftfields: requester id is not a lexical UUID")
)

// Language validation sentinels. Every rejected input returns a nil slice.
var (
	// errLanguagesNilRoot rejects a null or typed-nil languages array.
	errLanguagesNilRoot = errors.New("draftfields: languages root is null")
	// errLanguagesNotArray rejects a non-nil root that is not an array.
	errLanguagesNotArray = errors.New("draftfields: languages root is not an array")
	// errLanguagesTooMany rejects an array above its item limit.
	errLanguagesTooMany = errors.New("draftfields: languages exceeds its item limit")
	// errLanguageNotObject rejects an item that is not a non-nil map.
	errLanguageNotObject = errors.New("draftfields: language is not a non-nil object")
	// errLanguageUnknownKey rejects a key outside language, custom_name, level.
	errLanguageUnknownKey = errors.New("draftfields: unknown language key")
	// errLanguageMissingKey rejects an object without a mandatory key.
	errLanguageMissingKey = errors.New("draftfields: missing language key")
	// errLanguageWrongType rejects a value of the wrong dynamic type.
	errLanguageWrongType = errors.New("draftfields: language value has the wrong type")
	// errLanguageInvalidLanguage rejects a language outside the literal set.
	errLanguageInvalidLanguage = errors.New("draftfields: language is not an allowed literal")
	// errLanguageInvalidLevel rejects a level outside the literal set.
	errLanguageInvalidLevel = errors.New("draftfields: language level is not an allowed literal")
	// errLanguageInvalidUTF8 rejects a custom_name that is not valid UTF-8.
	errLanguageInvalidUTF8 = errors.New("draftfields: language custom_name is not valid utf-8")
	// errLanguageTooLong rejects a custom_name above its codepoint limit.
	errLanguageTooLong = errors.New("draftfields: language custom_name exceeds its codepoint limit")
	// errLanguageCustomNameForbidden rejects a non-null custom_name for es/en.
	errLanguageCustomNameForbidden = errors.New("draftfields: es and en require a null custom_name")
)

// Requester is the validated requester of a private vacancy draft. Kind is one
// of the exact literals internal_area or client; ID is nil for a null id and
// otherwise points to a freshly allocated copy of the submitted UUID string.
type Requester struct {
	Kind string
	ID   *string
}

// Language is one validated language of a private vacancy draft. Language
// carries the exact submitted literal; CustomName is nil for a null or empty
// custom name and otherwise points to a freshly allocated, end-trimmed value;
// Level is nil for a null level and otherwise points to the exact literal.
type Language struct {
	Language   string
	CustomName *string
	Level      *string
}

// ValidateRequester validates the requester of a private vacancy draft.
//
// A nil input is valid and returns nil, nil. Any other input must be an exact
// non-nil map[string]any carrying exactly the two required keys kind and id; a
// typed-nil map, a non-object, an unknown key (including the read-time derived
// name), a missing key or a wrong dynamic type rejects the whole requester and
// returns a nil *Requester.
//
// kind must be the exact literal internal_area or client and may not be null.
// id must be null or a lexical UUID: exactly 36 ASCII characters in the
// canonical 8-4-4-4-12 form, hex digits with hyphens at byte positions 8, 13,
// 18 and 23, with unrestricted version and variant nibbles and the submitted
// case preserved. No trimming, case-folding, catalog or ownership lookup and
// no default is applied.
func ValidateRequester(raw any) (*Requester, error) {
	if raw == nil {
		return nil, nil
	}
	object, ok := raw.(map[string]any)
	if !ok || object == nil {
		return nil, errRequesterNotObject
	}

	for key := range object {
		if !isRequesterKey(key) {
			return nil, fmt.Errorf("%w: %q", errRequesterUnknownKey, key)
		}
	}
	for _, key := range requesterKeyOrder {
		if _, present := object[key]; !present {
			return nil, fmt.Errorf("%w: %s", errRequesterMissingKey, key)
		}
	}

	kind, ok := object[requesterKeyKind].(string)
	if !ok {
		return nil, fmt.Errorf("%w: %s", errRequesterWrongType, requesterKeyKind)
	}
	if !nestedContainsLiteral(allowedRequesterKinds, kind) {
		return nil, fmt.Errorf("%w: %s", errRequesterInvalidKind, requesterKeyKind)
	}

	var id *string
	if rawID := object[requesterKeyID]; rawID != nil {
		text, ok := rawID.(string)
		if !ok {
			return nil, fmt.Errorf("%w: %s", errRequesterWrongType, requesterKeyID)
		}
		if !nestedIsUUID36(text) {
			return nil, fmt.Errorf("%w: %s", errRequesterInvalidID, requesterKeyID)
		}
		id = nestedStringPtr(text)
	}

	return &Requester{Kind: kind, ID: id}, nil
}

// ValidateLanguages validates the languages array of a private vacancy draft.
//
// raw must be an exact non-nil []any of at most 100 items. Each item must be an
// exact non-nil map[string]any whose only keys are the mandatory language,
// custom_name and level. A null or typed-nil root, a non-array root, an item
// that is not a non-nil object, an unknown key, a missing key or a wrong
// dynamic type rejects the whole array and returns a nil slice.
//
// language must be the exact literal es, en or other and may not be null. level
// must be null or the exact literal basic, intermediate, advanced or native.
// custom_name must be null or a valid UTF-8 string; it is end-trimmed of
// Unicode White_Space, an empty result becomes null and a result above 200
// codepoints is rejected. Normalization runs before the es/en rule: es and en
// require a null custom_name after trimming, while other accepts null or a
// name. Interior whitespace, U+FEFF, combining marks, case, order and
// duplicates are preserved and no CEFR mapping, NFC normalization or
// deduplication is applied.
//
// An accepted empty array returns a fresh non-nil empty slice and every
// returned slice and pointer is freshly allocated.
func ValidateLanguages(raw any) ([]Language, error) {
	items, err := nestedArray(raw)
	if err != nil {
		return nil, err
	}
	if len(items) > maxLanguageItems {
		return nil, fmt.Errorf("%w: languages exceeds %d items", errLanguagesTooMany, maxLanguageItems)
	}

	out := make([]Language, 0, len(items))
	for i, item := range items {
		language, err := validateLanguageItem(item, i)
		if err != nil {
			return nil, err
		}
		out = append(out, language)
	}
	return out, nil
}

// nestedArray extracts the exact non-nil []any root shared by the languages
// API. A null interface, a typed-nil []any and any non-array value are rejected
// with distinct sentinels.
func nestedArray(raw any) ([]any, error) {
	if raw == nil {
		return nil, errLanguagesNilRoot
	}
	items, ok := raw.([]any)
	if !ok {
		return nil, errLanguagesNotArray
	}
	if items == nil {
		return nil, errLanguagesNilRoot
	}
	return items, nil
}

// validateLanguageItem validates one languages[] item at index.
//
// The order is fixed: object shape, exact key set, mandatory keys, dynamic
// types of all three values, then the language literal, custom_name
// normalization (before the es/en rule) and finally the level literal. Every
// failure returns a zero Language.
func validateLanguageItem(item any, index int) (Language, error) {
	object, ok := item.(map[string]any)
	if !ok || object == nil {
		return Language{}, fmt.Errorf("%w: languages[%d]", errLanguageNotObject, index)
	}

	for key := range object {
		if !isLanguageKey(key) {
			return Language{}, fmt.Errorf("%w: languages[%d].%q", errLanguageUnknownKey, index, key)
		}
	}
	for _, key := range languageKeyOrder {
		if _, present := object[key]; !present {
			return Language{}, fmt.Errorf("%w: languages[%d].%s", errLanguageMissingKey, index, key)
		}
	}

	// Concrete type checks for all three values before any literal or
	// normalization rule, so a wrong dynamic type is never masked by a
	// literal mismatch.
	language, ok := object[languageKeyLanguage].(string)
	if !ok {
		return Language{}, fmt.Errorf("%w: languages[%d].%s", errLanguageWrongType, index, languageKeyLanguage)
	}
	customNameValue := object[languageKeyCustomName]
	if customNameValue != nil {
		if _, ok := customNameValue.(string); !ok {
			return Language{}, fmt.Errorf("%w: languages[%d].%s", errLanguageWrongType, index, languageKeyCustomName)
		}
	}
	levelValue := object[languageKeyLevel]
	if levelValue != nil {
		if _, ok := levelValue.(string); !ok {
			return Language{}, fmt.Errorf("%w: languages[%d].%s", errLanguageWrongType, index, languageKeyLevel)
		}
	}

	if !nestedContainsLiteral(allowedLanguages, language) {
		return Language{}, fmt.Errorf("%w: languages[%d].%s", errLanguageInvalidLanguage, index, languageKeyLanguage)
	}

	customName, err := normalizeLanguageCustomName(customNameValue, index)
	if err != nil {
		return Language{}, err
	}
	if customName != nil && (language == "es" || language == "en") {
		return Language{}, fmt.Errorf("%w: languages[%d].%s", errLanguageCustomNameForbidden, index, languageKeyCustomName)
	}

	var level *string
	if levelValue != nil {
		literal, _ := levelValue.(string)
		if !nestedContainsLiteral(allowedLanguageLevels, literal) {
			return Language{}, fmt.Errorf("%w: languages[%d].%s", errLanguageInvalidLevel, index, languageKeyLevel)
		}
		level = nestedStringPtr(literal)
	}

	return Language{Language: language, CustomName: customName, Level: level}, nil
}

// normalizeLanguageCustomName validates and normalizes one custom_name value.
//
// A null yields a nil pointer. A string must be valid UTF-8, is end-trimmed of
// Unicode White_Space, becomes nil when empty and is rejected above 200
// codepoints. Interior whitespace, U+FEFF, combining marks and case are
// preserved and the result is freshly allocated. It never trims or
// case-folds an enum.
func normalizeLanguageCustomName(value any, index int) (*string, error) {
	if value == nil {
		return nil, nil
	}
	text, ok := value.(string)
	if !ok {
		return nil, fmt.Errorf("%w: languages[%d].%s", errLanguageWrongType, index, languageKeyCustomName)
	}
	if !utf8.ValidString(text) {
		return nil, fmt.Errorf("%w: languages[%d].%s", errLanguageInvalidUTF8, index, languageKeyCustomName)
	}

	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(trimmed) > maxLanguageCustomNameCodepoints {
		return nil, fmt.Errorf("%w: languages[%d].%s exceeds %d codepoints", errLanguageTooLong, index, languageKeyCustomName, maxLanguageCustomNameCodepoints)
	}
	return nestedStringPtr(trimmed), nil
}

// isRequesterKey reports whether key names one of the two requester fields.
func isRequesterKey(key string) bool {
	switch key {
	case requesterKeyKind, requesterKeyID:
		return true
	default:
		return false
	}
}

// isLanguageKey reports whether key names one of the three language fields.
func isLanguageKey(key string) bool {
	switch key {
	case languageKeyLanguage, languageKeyCustomName, languageKeyLevel:
		return true
	default:
		return false
	}
}

// nestedContainsLiteral reports whether value equals one of allowed verbatim.
func nestedContainsLiteral(allowed []string, value string) bool {
	for _, literal := range allowed {
		if literal == value {
			return true
		}
	}
	return false
}

// nestedIsUUID36 reports whether value is exactly 36 ASCII characters in the
// canonical 8-4-4-4-12 lexical UUID form: hyphens at byte positions 8, 13, 18
// and 23 and ASCII hex digits everywhere else. Version and variant nibbles are
// unrestricted and case is not inspected, so no separate UUID parser is
// involved.
func nestedIsUUID36(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i := 0; i < 36; i++ {
		switch i {
		case 8, 13, 18, 23:
			if value[i] != '-' {
				return false
			}
		default:
			if !nestedIsASCIIHexDigit(value[i]) {
				return false
			}
		}
	}
	return true
}

// nestedIsASCIIHexDigit reports whether b is an ASCII hexadecimal digit.
func nestedIsASCIIHexDigit(b byte) bool {
	switch {
	case b >= '0' && b <= '9':
		return true
	case b >= 'a' && b <= 'f':
		return true
	case b >= 'A' && b <= 'F':
		return true
	default:
		return false
	}
}

// nestedStringPtr returns a freshly allocated pointer to value.
func nestedStringPtr(value string) *string {
	v := value
	return &v
}
