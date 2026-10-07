package draftjson

import (
	"errors"
	"math"
)

// Errors returned by ParseExactInt64. They are stable sentinels: callers match
// them with errors.Is and must not depend on any wrapping detail. ParseExactInt64
// never includes the offending token in an error, so a rejected token of any
// length is reported without allocating a message proportional to it.
var (
	// ErrNumberSyntax rejects a token that is not a complete RFC 8259 JSON
	// number: empty input, ASCII whitespace, a leading plus sign, leading
	// zeros, a bare fraction or trailing decimal point, an empty or malformed
	// exponent, a non-ASCII digit, or any trailing junk.
	ErrNumberSyntax = errors.New("draftjson: token is not a JSON number")
	// ErrNumberNotInteger rejects a syntactically valid JSON number whose exact
	// mathematical value is not an integer, including any nonzero fractional
	// part that cannot be cancelled by the exponent.
	ErrNumberNotInteger = errors.New("draftjson: number is not an exact integer")
	// ErrNumberOverflow rejects an exact integer whose magnitude does not fit in
	// an int64.
	ErrNumberOverflow = errors.New("draftjson: number overflows int64")
)

// maxSignificandDigits is the largest number of significant decimal digits a
// magnitude can have and still fit in an int64. Ten to the nineteen already
// exceeds math.MaxInt64, so twenty or more significant digits always overflow.
const maxSignificandDigits = 19

// ParseExactInt64 classifies one complete JSON number token as an exact int64.
//
// It accepts only the RFC 8259 number grammar, ASCII bytes, with no surrounding
// whitespace and no leading plus sign:
//
//	number = [ "-" ] int [ frac ] [ exp ]
//	int    = "0" / ( digit1-9 *DIGIT )
//	frac   = "." 1*DIGIT
//	exp    = ( "e" / "E" ) [ "+" / "-" ] 1*DIGIT
//
// The token is interpreted as its exact mathematical value, never as a float.
// A value is accepted when it is an integer that fits in an int64; any integral
// spelling is accepted, so "1", "1.0", "1e0" and "100e-2" all return 1. A
// nonzero fractional part is rejected with ErrNumberNotInteger, and an integral
// magnitude outside int64 is rejected with ErrNumberOverflow.
//
// Trailing zeros carry no value, so they are stripped before the magnitude is
// interpreted. That cancellation is exact and unbounded: "1" followed by any
// number of zeros and the matching "-N" exponent still returns 1. A token whose
// mantissa is entirely zero is mathematically zero and returns 0 for any valid
// signed exponent, however large.
//
// Cost is O(len(token)) time and O(1) allocation. The magnitude is accumulated
// with a fixed-width bounded accumulator and the exponent is saturated at
// math.MaxInt64, so no work or memory is ever sized by the exponent's value and
// the token body has no artificial length cap.
func ParseExactInt64(token string) (int64, error) {
	// The lexical pass validates every byte of the token, including the sign,
	// both ends and the full exponent, before any value shortcut is applied.
	i := 0
	negative := false
	if i < len(token) && token[i] == '-' {
		negative = true
		i++
	}

	intStart := i
	switch {
	case i < len(token) && token[i] == '0':
		i++
	case i < len(token) && token[i] >= '1' && token[i] <= '9':
		i++
		for i < len(token) && isASCIIDigit(token[i]) {
			i++
		}
	default:
		return 0, ErrNumberSyntax
	}
	intEnd := i

	fracStart := i
	fracEnd := i
	if i < len(token) && token[i] == '.' {
		i++
		fracStart = i
		for i < len(token) && isASCIIDigit(token[i]) {
			i++
		}
		fracEnd = i
		if fracStart == fracEnd {
			return 0, ErrNumberSyntax
		}
	}

	var expMagnitude uint64
	expNegative := false
	expOverflow := false
	if i < len(token) && (token[i] == 'e' || token[i] == 'E') {
		i++
		if i < len(token) && (token[i] == '+' || token[i] == '-') {
			expNegative = token[i] == '-'
			i++
		}
		expStart := i
		for i < len(token) && isASCIIDigit(token[i]) {
			digit := uint64(token[i] - '0')
			if !expOverflow {
				if expMagnitude > (uint64(math.MaxInt64)-digit)/10 {
					expOverflow = true
				} else {
					expMagnitude = expMagnitude*10 + digit
				}
			}
			i++
		}
		if i == expStart {
			return 0, ErrNumberSyntax
		}
	}

	if i != len(token) {
		return 0, ErrNumberSyntax
	}

	// The mantissa is the integer digits followed by the fraction digits. Only
	// the span between the first and last nonzero digit can affect the value;
	// digits after the last nonzero digit are trailing zeros that shift the
	// exponent instead of the magnitude.
	intLen := intEnd - intStart
	fracLen := fracEnd - fracStart
	totalDigits := intLen + fracLen

	firstNonZero := -1
	for idx := 0; idx < totalDigits; idx++ {
		if mantissaDigit(token, intStart, intLen, fracStart, idx) != '0' {
			firstNonZero = idx
			break
		}
	}
	if firstNonZero == -1 {
		// A mantissa of only zeros is mathematically zero for any exponent.
		return 0, nil
	}

	lastNonZero := firstNonZero
	for idx := totalDigits - 1; idx > firstNonZero; idx-- {
		if mantissaDigit(token, intStart, intLen, fracStart, idx) != '0' {
			lastNonZero = idx
			break
		}
	}

	trailingZeros := totalDigits - 1 - lastNonZero
	significantDigits := lastNonZero - firstNonZero + 1

	// The exact value is significand * 10^exponentShift, where
	// exponentShift = signedExp - target and target = fracLen - trailingZeros.
	// The exponent is signed only when it did not saturate.
	var signedExp int64
	if !expOverflow {
		signedExp = int64(expMagnitude)
		if expNegative {
			signedExp = -signedExp
		}
	}
	target := int64(fracLen) - int64(trailingZeros)

	if expOverflow {
		// The exponent magnitude exceeds math.MaxInt64, which is larger than
		// any possible fracLen or trailingZeros count, so it cannot cancel.
		if expNegative {
			return 0, ErrNumberNotInteger
		}
		return 0, ErrNumberOverflow
	}
	if signedExp < target {
		return 0, ErrNumberNotInteger
	}
	if significantDigits > maxSignificandDigits {
		return 0, ErrNumberOverflow
	}

	magnitude := uint64(0)
	for idx := firstNonZero; idx <= lastNonZero; idx++ {
		magnitude = magnitude*10 + uint64(mantissaDigit(token, intStart, intLen, fracStart, idx)-'0')
	}

	maxMagnitude := uint64(math.MaxInt64)
	if negative {
		maxMagnitude = uint64(math.MaxInt64) + 1
	}

	if signedExp == target {
		if magnitude > maxMagnitude {
			return 0, ErrNumberOverflow
		}
		return fromMagnitude(magnitude, negative), nil
	}

	// signedExp > target: the value is magnitude times a positive power of ten.
	power, ok := smallPositivePowerOfTen(signedExp, target)
	if !ok {
		return 0, ErrNumberOverflow
	}
	for step := int64(0); step < power; step++ {
		if magnitude > maxMagnitude/10 {
			return 0, ErrNumberOverflow
		}
		magnitude *= 10
	}
	return fromMagnitude(magnitude, negative), nil
}

// isASCIIDigit reports whether c is an ASCII decimal digit. Bytes outside
// '0'-'9', including every non-ASCII byte and every Unicode digit, are rejected.
func isASCIIDigit(c byte) bool {
	return c >= '0' && c <= '9'
}

// mantissaDigit returns the digit at combined index idx, where the mantissa is
// the integer digits token[intStart:intStart+intLen] followed by the fraction
// digits token[fracStart:...]. It indexes bytes directly and never allocates.
func mantissaDigit(token string, intStart, intLen, fracStart, idx int) byte {
	if idx < intLen {
		return token[intStart+idx]
	}
	return token[fracStart+idx-intLen]
}

// smallPositivePowerOfTen returns signedExp-target when that value is at most
// 18, so multiplying a significand by 10^value cannot overflow a bounded loop
// accumulator prematurely. It reports false when the shift is 19 or more, which
// always overflows an int64 for a nonzero significand. It assumes
// signedExp > target and never overflows int64 while comparing them.
func smallPositivePowerOfTen(signedExp, target int64) (int64, bool) {
	if target > math.MaxInt64-18 {
		// target+18 would overflow, so signedExp-target is at most 18.
		return signedExp - target, true
	}
	if signedExp > target+18 {
		return 0, false
	}
	return signedExp - target, true
}

// fromMagnitude converts a non-negative magnitude in [0, 2^63] to its signed
// int64 value. The caller guarantees magnitude <= maxMagnitude.
func fromMagnitude(magnitude uint64, negative bool) int64 {
	if !negative {
		return int64(magnitude)
	}
	if magnitude == uint64(math.MaxInt64)+1 {
		return math.MinInt64
	}
	return -int64(magnitude)
}
