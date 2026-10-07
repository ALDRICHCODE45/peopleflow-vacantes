// Compensation group of a private vacancy draft.
//
// Scope: this file implements only the compensation (monetary) validator. It
// does not decode raw JSON, does not validate the scalar or rich string groups
// and does not persist or map any DTO. Its input is the already-decoded
// map[string]any produced by the strict draft JSON decoder.
//
// The validator requires an exact non-nil object with all eight compensation
// keys. Every present string field is nullable and is returned as a freshly
// allocated *string; public_visible is a required bool and may not be null. A
// rejected input always returns a zero Compensation, so a caller never observes
// a partial result, and the input map is only read, never mutated.
//
// Money is validated with a private ASCII scanner and exact uint64 cents. No
// float conversion, rounding or trimming is performed: the token must match
// ^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$, which caps the amount at
// 999999999999.99. Accepted tokens are normalized to exactly two decimals
// (for example "0" -> "0.00" and "1.2" -> "1.20").
//
// Every amount is validated before any cross-field shape rule. The shape rules
// are: null mode requires amount, min and max to be null; fixed mode requires
// min and max to be null; range mode requires amount to be null and, when both
// bounds are present, min to be less than or equal to max.
package draftfields

import (
	"errors"
	"fmt"
)

// Compensation wire key names.
const (
	compensationKeyMode          = "mode"
	compensationKeyAmount        = "amount"
	compensationKeyMin           = "min"
	compensationKeyMax           = "max"
	compensationKeyCurrency      = "currency"
	compensationKeyPayPeriod     = "pay_period"
	compensationKeyBasis         = "basis"
	compensationKeyPublicVisible = "public_visible"
)

// compensationKeyOrder lists the eight required keys in contract order.
var compensationKeyOrder = []string{
	compensationKeyMode,
	compensationKeyAmount,
	compensationKeyMin,
	compensationKeyMax,
	compensationKeyCurrency,
	compensationKeyPayPeriod,
	compensationKeyBasis,
	compensationKeyPublicVisible,
}

// compensationStringKeyOrder lists the nullable string keys.
var compensationStringKeyOrder = []string{
	compensationKeyMode,
	compensationKeyAmount,
	compensationKeyMin,
	compensationKeyMax,
	compensationKeyCurrency,
	compensationKeyPayPeriod,
	compensationKeyBasis,
}

// maxCompensationCents is the exact maximum amount in cents (999999999999.99).
const maxCompensationCents uint64 = 99999999999999

// Exact enum literal sets. Values are compared verbatim and are never trimmed,
// case-folded or Unicode-normalized.
var (
	allowedCompensationModes      = []string{"fixed", "range"}
	allowedCompensationCurrencies = []string{"MXN", "USD"}
	allowedCompensationPayPeriods = []string{"hourly", "weekly", "semimonthly", "monthly", "yearly"}
	allowedCompensationBases      = []string{"gross", "net"}
)

// Compensation validation sentinels. Every rejected input returns a zero
// Compensation.
var (
	// ErrCompensationNilRoot rejects a null root, including a typed-nil map.
	ErrCompensationNilRoot = errors.New("draftfields: compensation root is null")
	// ErrCompensationNotObject rejects a non-nil root that is not a map.
	ErrCompensationNotObject = errors.New("draftfields: compensation root is not an object")
	// ErrCompensationMissingKey rejects an object without one of the eight keys.
	ErrCompensationMissingKey = errors.New("draftfields: missing compensation key")
	// ErrCompensationUnknownKey rejects a key outside the compensation group.
	ErrCompensationUnknownKey = errors.New("draftfields: unknown compensation key")
	// ErrCompensationWrongType rejects a value of the wrong dynamic type.
	ErrCompensationWrongType = errors.New("draftfields: compensation value has the wrong type")
	// ErrCompensationInvalidEnum rejects a value outside the exact literal set.
	ErrCompensationInvalidEnum = errors.New("draftfields: compensation value is not an allowed literal")
	// ErrCompensationInvalidAmount rejects a token outside the money grammar.
	ErrCompensationInvalidAmount = errors.New("draftfields: compensation amount is not a valid decimal string")
	// ErrCompensationShape rejects a mode/amount presence combination.
	ErrCompensationShape = errors.New("draftfields: compensation mode and amount presence are inconsistent")
	// ErrCompensationMinExceedsMax rejects a range whose minimum is above its
	// maximum.
	ErrCompensationMinExceedsMax = errors.New("draftfields: compensation minimum exceeds maximum")
)

// Compensation is the presence-preserving monetary subset of a private vacancy
// draft.
//
// Each nullable field is nil when the key was present as JSON null and points
// to a freshly allocated normalized value otherwise. PublicVisible is a plain
// bool; the key is required and may not be null. A zero Compensation is the
// only value returned alongside a non-nil error.
type Compensation struct {
	Mode          *string
	Amount        *string
	Min           *string
	Max           *string
	Currency      *string
	PayPeriod     *string
	Basis         *string
	PublicVisible bool
}

// ValidateCompensation validates the compensation group of a decoded draft map.
//
// raw must be a non-nil map[string]any carrying all eight compensation keys:
// mode, amount, min, max, currency, pay_period, basis and public_visible. A nil
// or typed-nil root, a non-object root, an unknown key, a missing key or a
// wrong dynamic type rejects the whole group. Every error returns a zero
// Compensation and the input map is never mutated.
func ValidateCompensation(raw any) (Compensation, error) {
	if raw == nil {
		return Compensation{}, ErrCompensationNilRoot
	}
	object, ok := raw.(map[string]any)
	if !ok {
		return Compensation{}, ErrCompensationNotObject
	}
	if object == nil {
		return Compensation{}, ErrCompensationNilRoot
	}

	for key := range object {
		if !isCompensationKey(key) {
			return Compensation{}, fmt.Errorf("%w: %q", ErrCompensationUnknownKey, key)
		}
	}
	for _, key := range compensationKeyOrder {
		if _, present := object[key]; !present {
			return Compensation{}, fmt.Errorf("%w: %s", ErrCompensationMissingKey, key)
		}
	}

	// Concrete type checks for every key, before any enum or money rule.
	for _, key := range compensationStringKeyOrder {
		if value := object[key]; value != nil {
			if _, ok := value.(string); !ok {
				return Compensation{}, fmt.Errorf("%w: %s", ErrCompensationWrongType, key)
			}
		}
	}
	if _, ok := object[compensationKeyPublicVisible].(bool); !ok {
		return Compensation{}, fmt.Errorf("%w: %s", ErrCompensationWrongType, compensationKeyPublicVisible)
	}

	var out Compensation

	// Exact enum literals.
	mode, err := compensationEnumValue(object, compensationKeyMode, allowedCompensationModes)
	if err != nil {
		return Compensation{}, err
	}
	out.Mode = mode

	currency, err := compensationEnumValue(object, compensationKeyCurrency, allowedCompensationCurrencies)
	if err != nil {
		return Compensation{}, err
	}
	out.Currency = currency

	payPeriod, err := compensationEnumValue(object, compensationKeyPayPeriod, allowedCompensationPayPeriods)
	if err != nil {
		return Compensation{}, err
	}
	out.PayPeriod = payPeriod

	basis, err := compensationEnumValue(object, compensationKeyBasis, allowedCompensationBases)
	if err != nil {
		return Compensation{}, err
	}
	out.Basis = basis

	// Every amount is validated before any cross-field shape rule.
	amount, _, err := compensationMoneyValue(object, compensationKeyAmount)
	if err != nil {
		return Compensation{}, err
	}
	out.Amount = amount

	minimum, minimumCents, err := compensationMoneyValue(object, compensationKeyMin)
	if err != nil {
		return Compensation{}, err
	}
	out.Min = minimum

	maximum, maximumCents, err := compensationMoneyValue(object, compensationKeyMax)
	if err != nil {
		return Compensation{}, err
	}
	out.Max = maximum

	out.PublicVisible = object[compensationKeyPublicVisible].(bool)

	if err := validateCompensationShape(out.Mode, amount != nil, minimum != nil, maximum != nil, minimumCents, maximumCents); err != nil {
		return Compensation{}, err
	}

	return out, nil
}

// DefaultCompensation returns an independent compensation draft with the
// contract defaults: mode, amount, min, max and basis null, currency MXN,
// pay_period monthly and public_visible false. Every call allocates fresh
// pointers, so mutating one result never affects another.
func DefaultCompensation() Compensation {
	return Compensation{
		Mode:          nil,
		Amount:        nil,
		Min:           nil,
		Max:           nil,
		Currency:      stringPtr("MXN"),
		PayPeriod:     stringPtr("monthly"),
		Basis:         nil,
		PublicVisible: false,
	}
}

// isCompensationKey reports whether key names one of the eight compensation
// fields.
func isCompensationKey(key string) bool {
	switch key {
	case compensationKeyMode,
		compensationKeyAmount,
		compensationKeyMin,
		compensationKeyMax,
		compensationKeyCurrency,
		compensationKeyPayPeriod,
		compensationKeyBasis,
		compensationKeyPublicVisible:
		return true
	default:
		return false
	}
}

// compensationEnumValue returns the exact literal for one nullable enum key.
// A present null yields a nil pointer; a wrong dynamic type or a value outside
// the allowed literals is rejected.
func compensationEnumValue(object map[string]any, key string, allowed []string) (*string, error) {
	value := object[key]
	if value == nil {
		return nil, nil
	}
	text, ok := value.(string)
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrCompensationWrongType, key)
	}
	if !compensationContainsLiteral(allowed, text) {
		return nil, fmt.Errorf("%w: %s", ErrCompensationInvalidEnum, key)
	}
	return stringPtr(text), nil
}

// compensationMoneyValue returns the normalized amount and exact cents for one
// nullable money key. A present null yields a nil pointer; a token outside the
// money grammar is rejected.
func compensationMoneyValue(object map[string]any, key string) (*string, uint64, error) {
	value := object[key]
	if value == nil {
		return nil, 0, nil
	}
	text, ok := value.(string)
	if !ok {
		return nil, 0, fmt.Errorf("%w: %s", ErrCompensationWrongType, key)
	}
	normalized, cents, ok := scanCompensationAmount(text)
	if !ok {
		return nil, 0, fmt.Errorf("%w: %s", ErrCompensationInvalidAmount, key)
	}
	return stringPtr(normalized), cents, nil
}

// compensationContainsLiteral reports whether value equals one of allowed.
func compensationContainsLiteral(allowed []string, value string) bool {
	for _, literal := range allowed {
		if literal == value {
			return true
		}
	}
	return false
}

// validateCompensationShape enforces the mode/amount presence rules. It is only
// reached after every amount token has been validated.
func validateCompensationShape(mode *string, hasAmount, hasMin, hasMax bool, minCents, maxCents uint64) error {
	switch {
	case mode == nil:
		if hasAmount || hasMin || hasMax {
			return fmt.Errorf("%w: null mode requires amount, min and max to be null", ErrCompensationShape)
		}
	case *mode == "fixed":
		if hasMin || hasMax {
			return fmt.Errorf("%w: fixed mode requires min and max to be null", ErrCompensationShape)
		}
	case *mode == "range":
		if hasAmount {
			return fmt.Errorf("%w: range mode requires amount to be null", ErrCompensationShape)
		}
		if hasMin && hasMax && minCents > maxCents {
			return fmt.Errorf("%w: min %d cents exceeds max %d cents", ErrCompensationMinExceedsMax, minCents, maxCents)
		}
	}
	return nil
}

// scanCompensationAmount parses value against the exact ASCII money grammar
// ^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$ and returns the canonical two-decimal
// form plus its exact value in cents. It never trims, rounds or uses floating
// point arithmetic. Any byte outside the grammar, including any non-ASCII or
// invalid UTF-8 byte, is rejected.
func scanCompensationAmount(value string) (normalized string, cents uint64, ok bool) {
	n := len(value)
	if n == 0 {
		return "", 0, false
	}

	intEnd := 0
	switch {
	case value[0] == '0':
		intEnd = 1
		if n > 1 && value[1] != '.' {
			return "", 0, false
		}
	case value[0] >= '1' && value[0] <= '9':
		i := 1
		for i < n && isASCIIDigit(value[i]) {
			i++
		}
		intEnd = i
		if intEnd > 12 {
			return "", 0, false
		}
	default:
		return "", 0, false
	}

	fracDigits := ""
	if intEnd < n {
		if value[intEnd] != '.' {
			return "", 0, false
		}
		fracStart := intEnd + 1
		j := fracStart
		for j < n && isASCIIDigit(value[j]) {
			j++
		}
		if j != n {
			return "", 0, false
		}
		count := j - fracStart
		if count < 1 || count > 2 {
			return "", 0, false
		}
		fracDigits = value[fracStart:j]
	}

	for i := 0; i < intEnd; i++ {
		cents = cents*10 + uint64(value[i]-'0')
	}
	cents *= 100
	switch len(fracDigits) {
	case 1:
		cents += uint64(fracDigits[0]-'0') * 10
	case 2:
		cents += uint64(fracDigits[0]-'0')*10 + uint64(fracDigits[1]-'0')
	}
	if cents > maxCompensationCents {
		return "", 0, false
	}

	normalizedFrac := fracDigits
	switch len(normalizedFrac) {
	case 0:
		normalizedFrac = "00"
	case 1:
		normalizedFrac += "0"
	}
	return value[:intEnd] + "." + normalizedFrac, cents, true
}

// isASCIIDigit reports whether b is an ASCII decimal digit.
func isASCIIDigit(b byte) bool {
	return b >= '0' && b <= '9'
}

// stringPtr returns a freshly allocated pointer to value.
func stringPtr(value string) *string {
	v := value
	return &v
}
