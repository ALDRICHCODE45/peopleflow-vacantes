package draftjson

import (
	"errors"
	"math/big"
	"strconv"
	"strings"
	"testing"
)

// The expected values below are literals authored before ParseExactInt64 was
// implemented. They describe the exact mathematical integer value of each JSON
// number token, not a float64 approximation.

func TestParseExactInt64_AcceptsIntegralEquivalents(t *testing.T) {
	tests := []struct {
		name  string
		token string
		want  int64
	}{
		{name: "zero", token: "0", want: 0},
		{name: "negative zero", token: "-0", want: 0},
		{name: "one", token: "1", want: 1},
		{name: "negative one", token: "-1", want: -1},
		{name: "decimal one", token: "1.0", want: 1},
		{name: "decimal one with two zeros", token: "1.00", want: 1},
		{name: "zero exponent", token: "1e0", want: 1},
		{name: "uppercase exponent", token: "1E0", want: 1},
		{name: "explicit positive zero exponent", token: "1e+0", want: 1},
		{name: "negative zero exponent", token: "1e-0", want: 1},
		{name: "hundred e minus two", token: "100e-2", want: 1},
		{name: "tenth scaled by exponent", token: "0.1e1", want: 1},
		{name: "hundredth scaled by exponent", token: "0.01e2", want: 1},
		{name: "ten e minus one", token: "10e-1", want: 1},
		{name: "thousand e minus three", token: "1000e-3", want: 1},
		{name: "decimal scaled up", token: "1.000e3", want: 1000},
		{name: "thousand scaled down", token: "123000e-3", want: 123},
		{name: "five e one", token: "5e1", want: 50},
		{name: "negative five e one", token: "-5e1", want: -50},
		{name: "two e two", token: "2e2", want: 200},
		{name: "negative zero decimal", token: "-0.0", want: 0},
		{name: "negative zero point zero e negative exponent", token: "-0.000e-7", want: 0},
		{name: "one e eighteen", token: "1e18", want: 1000000000000000000},
		{name: "negative one e eighteen", token: "-1e18", want: -1000000000000000000},
		{name: "nine e eighteen", token: "9e18", want: 9000000000000000000},
		{name: "ninety two e seventeen", token: "92e17", want: 9200000000000000000},
		{name: "tiny fraction cancelled", token: "0.000000000000000000001e21", want: 1},
		{name: "leading zero integer part scaled", token: "0.1e1", want: 1},
		{name: "trailing zeros then cancel", token: "-0.0001e4", want: -1},
		{
			name:  "nineteen significant digits with trailing zeros cancelled",
			token: "1234567890123456789" + strings.Repeat("0", 100) + "e-100",
			want:  1234567890123456789,
		},
		{
			name:  "six significant digits with trailing zeros cancelled",
			token: "123456" + strings.Repeat("0", 500) + "e-500",
			want:  123456,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseExactInt64(tt.token)
			if err != nil {
				t.Fatalf("ParseExactInt64(%q) returned error %v, want nil", tt.token, err)
			}
			if got != tt.want {
				t.Fatalf("ParseExactInt64(%q) = %d, want %d", tt.token, got, tt.want)
			}
		})
	}
}

func TestParseExactInt64_Int64Boundaries(t *testing.T) {
	tests := []struct {
		name  string
		token string
		want  int64
	}{
		{name: "max int64", token: "9223372036854775807", want: 9223372036854775807},
		{name: "max int64 minus one", token: "9223372036854775806", want: 9223372036854775806},
		{name: "min int64", token: "-9223372036854775808", want: -9223372036854775808},
		{name: "min int64 plus one", token: "-9223372036854775807", want: -9223372036854775807},
		{name: "max int64 fractional zero", token: "9223372036854775807.0", want: 9223372036854775807},
		{name: "min int64 fractional zero", token: "-9223372036854775808.0", want: -9223372036854775808},
		{name: "max int64 e zero", token: "9223372036854775807e0", want: 9223372036854775807},
		{name: "min int64 e zero", token: "-9223372036854775808e0", want: -9223372036854775808},
		{name: "max int64 one trailing zero cancelled", token: "92233720368547758070e-1", want: 9223372036854775807},
		{name: "min int64 one trailing zero cancelled", token: "-92233720368547758080e-1", want: -9223372036854775808},
		{name: "max int64 two trailing zeros cancelled", token: "922337203685477580700e-2", want: 9223372036854775807},
		{name: "min int64 two trailing zeros cancelled", token: "-922337203685477580800e-2", want: -9223372036854775808},
		{name: "max int64 three trailing zeros cancelled", token: "9223372036854775807000e-3", want: 9223372036854775807},
		{name: "min int64 three trailing zeros cancelled", token: "-9223372036854775808000e-3", want: -9223372036854775808},
		{name: "max int64 decimal scaled up", token: "922337203685477580.7e1", want: 9223372036854775807},
		{name: "max int64 decimal zeros cancelled", token: "9223372036854775807.00e0", want: 9223372036854775807},
		{name: "min int64 decimal zeros cancelled", token: "-9223372036854775808.00e0", want: -9223372036854775808},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseExactInt64(tt.token)
			if err != nil {
				t.Fatalf("ParseExactInt64(%q) returned error %v, want nil", tt.token, err)
			}
			if got != tt.want {
				t.Fatalf("ParseExactInt64(%q) = %d, want %d", tt.token, got, tt.want)
			}
		})
	}
}

func TestParseExactInt64_RejectsNonInteger(t *testing.T) {
	tests := []struct {
		name  string
		token string
	}{
		{name: "one point five", token: "1.5"},
		{name: "negative one point five", token: "-1.5"},
		{name: "zero point one", token: "0.1"},
		{name: "one e minus one", token: "1e-1"},
		{name: "fifteen e minus one", token: "15e-1"},
		{name: "one point zero five", token: "1.05"},
		{name: "zero point five", token: "0.5"},
		{name: "two point five e zero", token: "2.5e0"},
		{name: "one hundred twenty three point four five six", token: "123.456"},
		{name: "hundred e minus three", token: "100e-3"},
		{name: "one point two e zero", token: "1.2e0"},
		{name: "one hundred twenty e minus two", token: "120e-2"},
		{name: "tiny nonzero fraction", token: "0.0000000000000000000001"},
		{name: "one point zero zero zero zero zero zero one", token: "1.0000001"},
		{name: "pi", token: "3.14159"},
		{name: "max int64 plus fraction", token: "9223372036854775807.5"},
		{name: "min int64 minus fraction", token: "-9223372036854775808.5"},
		{name: "min int64 scaled by negative exponent", token: "-9223372036854775808e-1"},
		{name: "long nonzero fraction", token: "0.12345678901234567890"},
		{name: "huge negative exponent", token: "1e-99999999999999999999"},
		{name: "huge negative exponent with many digits", token: "1e-100000000000000000000000"},
		{name: "negative number huge negative exponent", token: "-1e-99999999999999999999"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseExactInt64(tt.token)
			if !errors.Is(err, ErrNumberNotInteger) {
				t.Fatalf("ParseExactInt64(%q) error = %v, want ErrNumberNotInteger", tt.token, err)
			}
			if got != 0 {
				t.Fatalf("ParseExactInt64(%q) = %d, want 0 on error", tt.token, got)
			}
		})
	}
}

func TestParseExactInt64_RejectsOverflow(t *testing.T) {
	tests := []struct {
		name  string
		token string
	}{
		{name: "max int64 plus one", token: "9223372036854775808"},
		{name: "min int64 minus one", token: "-9223372036854775809"},
		{name: "max int64 plus one scaled by exponent", token: "92233720368547758080e-1"},
		{name: "min int64 minus one scaled by exponent", token: "-92233720368547758090e-1"},
		{name: "ten to the nineteen", token: "1e19"},
		{name: "negative ten to the nineteen", token: "-1e19"},
		{name: "ten to the one hundred", token: "1e100"},
		{name: "huge positive exponent", token: "1e99999999999999999999"},
		{name: "huge positive exponent many digits", token: "1e100000000000000000000000"},
		{name: "negative number huge positive exponent", token: "-1e99999999999999999999"},
		{name: "twenty digit integer", token: "99999999999999999999"},
		{name: "two to the sixty four", token: "18446744073709551616"},
		{name: "max int64 times ten", token: "92233720368547758070"},
		{name: "max int64 significand scaled up", token: "1234567890123456789e1"},
		{name: "max int64 with e plus one", token: "9223372036854775807e+1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseExactInt64(tt.token)
			if !errors.Is(err, ErrNumberOverflow) {
				t.Fatalf("ParseExactInt64(%q) error = %v, want ErrNumberOverflow", tt.token, err)
			}
			if got != 0 {
				t.Fatalf("ParseExactInt64(%q) = %d, want 0 on error", tt.token, got)
			}
		})
	}
}

func TestParseExactInt64_AcceptsZeroForAnyExponent(t *testing.T) {
	tests := []struct {
		name  string
		token string
	}{
		{name: "zero", token: "0"},
		{name: "negative zero", token: "-0"},
		{name: "zero e zero", token: "0e0"},
		{name: "zero e plus zero", token: "0E+0"},
		{name: "zero e minus zero", token: "0e-0"},
		{name: "zero decimal e zero", token: "0.0e0"},
		{name: "zero with huge positive exponent", token: "0e99999999999999999999"},
		{name: "negative zero with huge negative exponent", token: "-0e-99999999999999999999"},
		{name: "zero decimal with huge positive exponent", token: "0.0e999999999999999999998888888888"},
		{name: "zero long fraction with huge negative exponent", token: "0.000000000000e-99999999999999999999999"},
		{name: "zero e huge negative exponent", token: "0e-100000000000000000000000"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseExactInt64(tt.token)
			if err != nil {
				t.Fatalf("ParseExactInt64(%q) returned error %v, want nil", tt.token, err)
			}
			if got != 0 {
				t.Fatalf("ParseExactInt64(%q) = %d, want 0", tt.token, got)
			}
		})
	}
}

func TestParseExactInt64_RejectsMalformed(t *testing.T) {
	tests := []struct {
		name  string
		token string
	}{
		{name: "empty", token: ""},
		{name: "space only", token: " "},
		{name: "leading space", token: " 1"},
		{name: "trailing space", token: "1 "},
		{name: "internal space", token: "1 1"},
		{name: "leading tab", token: "\t1"},
		{name: "trailing newline", token: "1\n"},
		{name: "leading plus", token: "+1"},
		{name: "plus zero", token: "+0"},
		{name: "sign only", token: "-"},
		{name: "double minus", token: "--1"},
		{name: "leading zero integer", token: "01"},
		{name: "double zero integer", token: "00"},
		{name: "negative leading zero", token: "-01"},
		{name: "leading zero with exponent", token: "01e0"},
		{name: "bare fraction", token: ".1"},
		{name: "negative bare fraction", token: "-.1"},
		{name: "trailing decimal point", token: "1."},
		{name: "negative trailing decimal point", token: "-1."},
		{name: "decimal point only", token: "."},
		{name: "exponent only", token: "e1"},
		{name: "missing exponent digits", token: "1e"},
		{name: "exponent plus only", token: "1e+"},
		{name: "exponent minus only", token: "1e-"},
		{name: "uppercase exponent missing digits", token: "1E"},
		{name: "double exponent sign", token: "1e--1"},
		{name: "exponent then decimal", token: "1e1.0"},
		{name: "fraction then exponent then fraction", token: "1.2.3"},
		{name: "empty fraction then exponent", token: "1.e1"},
		{name: "empty fraction then exponent only", token: "1.e"},
		{name: "double exponent marker", token: "1e0e0"},
		{name: "exponent marker doubled", token: "1ee0"},
		{name: "trailing minus", token: "1-"},
		{name: "plus separator", token: "0+1"},
		{name: "minus separator", token: "0-1"},
		{name: "duplicate exponent sign", token: "1e+1+1"},
		{name: "underscore separator", token: "1_000"},
		{name: "comma separator", token: "1,000"},
		{name: "hexadecimal", token: "0x1"},
		{name: "binary", token: "0b1"},
		{name: "octal", token: "0o7"},
		{name: "NaN", token: "NaN"},
		{name: "nan lowercase", token: "nan"},
		{name: "Infinity", token: "Infinity"},
		{name: "Inf", token: "Inf"},
		{name: "negative Inf", token: "-Inf"},
		{name: "arabic indic digits", token: "\u0661\u0662\u0663"},
		{name: "mixed ascii and non ascii digits", token: "1\u0662"},
		{name: "arabic indic exponent digits", token: "1e\u0661"},
		{name: "non breaking space prefix", token: "\u00a01"},
		{name: "vertical tab suffix", token: "1\v"},
		{name: "nul suffix", token: "1\x00"},
		{name: "unicode minus", token: "\u22121"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseExactInt64(tt.token)
			if !errors.Is(err, ErrNumberSyntax) {
				t.Fatalf("ParseExactInt64(%q) error = %v, want ErrNumberSyntax", tt.token, err)
			}
			if got != 0 {
				t.Fatalf("ParseExactInt64(%q) = %d, want 0 on error", tt.token, got)
			}
		})
	}
}

func TestParseExactInt64_RejectsMalformedSuffixAfterZero(t *testing.T) {
	tests := []struct {
		name  string
		token string
	}{
		{name: "zero then x", token: "0x"},
		{name: "zero then x digit", token: "0x0"},
		{name: "zero then b", token: "0b0"},
		{name: "zero then underscore", token: "0_0"},
		{name: "zero then second zero", token: "00"},
		{name: "zero then one", token: "01"},
		{name: "zero then space", token: "0 0"},
		{name: "zero decimal then dot", token: "0.0.0"},
		{name: "zero decimal point only", token: "0."},
		{name: "zero exponent missing digits", token: "0e"},
		{name: "zero exponent plus only", token: "0e+"},
		{name: "zero exponent minus only", token: "0e-"},
		{name: "zero exponent then junk", token: "0e1x"},
		{name: "zero negative exponent then junk", token: "0e-1x"},
		{name: "zero plus one", token: "0+1"},
		{name: "zero minus one", token: "0-1"},
		{name: "negative zero then x", token: "-0x"},
		{name: "negative zero then one", token: "-01"},
		{name: "zero trailing space", token: "0 "},
		{name: "zero huge exponent then junk", token: "0e99999999999999999999x"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseExactInt64(tt.token)
			if !errors.Is(err, ErrNumberSyntax) {
				t.Fatalf("ParseExactInt64(%q) error = %v, want ErrNumberSyntax", tt.token, err)
			}
			if got != 0 {
				t.Fatalf("ParseExactInt64(%q) = %d, want 0 on error", tt.token, got)
			}
		})
	}
}

func TestParseExactInt64_HugeTokensStayProportional(t *testing.T) {
	const zeros = 300000

	cancelled := "1" + strings.Repeat("0", zeros) + "e-" + strconv.Itoa(zeros)
	got, err := ParseExactInt64(cancelled)
	if err != nil {
		t.Fatalf("ParseExactInt64(cancelled) returned error %v, want nil", err)
	}
	if got != 1 {
		t.Fatalf("ParseExactInt64(cancelled) = %d, want 1", got)
	}

	zeroToken := "0." + strings.Repeat("0", zeros) + "e-" + strings.Repeat("9", 100)
	got, err = ParseExactInt64(zeroToken)
	if err != nil {
		t.Fatalf("ParseExactInt64(zeroToken) returned error %v, want nil", err)
	}
	if got != 0 {
		t.Fatalf("ParseExactInt64(zeroToken) = %d, want 0", got)
	}

	hugePositive := "1e" + strings.Repeat("9", 400)
	if _, err := ParseExactInt64(hugePositive); !errors.Is(err, ErrNumberOverflow) {
		t.Fatalf("ParseExactInt64(hugePositive) error = %v, want ErrNumberOverflow", err)
	}

	hugeNegative := "1e-" + strings.Repeat("9", 400)
	if _, err := ParseExactInt64(hugeNegative); !errors.Is(err, ErrNumberNotInteger) {
		t.Fatalf("ParseExactInt64(hugeNegative) error = %v, want ErrNumberNotInteger", err)
	}

	allocs := testing.AllocsPerRun(20, func() {
		_, _ = ParseExactInt64(cancelled)
	})
	if allocs != 0 {
		t.Fatalf("ParseExactInt64 allocated %.1f times per run on a long token, want 0", allocs)
	}
}

func TestParseExactInt64_MatchesBigRatOracle(t *testing.T) {
	tokens := []string{
		"0",
		"1",
		"-1",
		"1.0",
		"1.00",
		"1e0",
		"1e+0",
		"1e-0",
		"100e-2",
		"0.1e1",
		"0.01e2",
		"10e-1",
		"1000e-3",
		"123000e-3",
		"5e1",
		"-5e1",
		"2e2",
		"1e18",
		"-1e18",
		"9e18",
		"92e17",
		"0.000000000000000000001e21",
		"9223372036854775807",
		"-9223372036854775808",
		"9223372036854775807.0",
		"-9223372036854775808.0",
		"92233720368547758070e-1",
		"-92233720368547758080e-1",
		"1234567890123456789" + strings.Repeat("0", 40) + "e-40",
	}

	for _, token := range tokens {
		t.Run(token, func(t *testing.T) {
			got, err := ParseExactInt64(token)
			if err != nil {
				t.Fatalf("ParseExactInt64(%q) returned error %v, want nil", token, err)
			}

			rat, ok := new(big.Rat).SetString(token)
			if !ok {
				t.Fatalf("oracle could not parse %q", token)
			}
			if !rat.IsInt() {
				t.Fatalf("oracle says %q is not an integer", token)
			}
			if !rat.Num().IsInt64() {
				t.Fatalf("oracle says %q overflows int64", token)
			}
			if want := rat.Num().Int64(); got != want {
				t.Fatalf("ParseExactInt64(%q) = %d, oracle says %d", token, got, want)
			}
		})
	}
}
