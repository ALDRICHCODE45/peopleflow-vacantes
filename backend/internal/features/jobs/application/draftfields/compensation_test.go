package draftfields

import (
	"errors"
	"fmt"
	"reflect"
	"testing"
)

// The expectations in this file were authored before ValidateCompensation was
// implemented. They describe the B7 compensation contract: an exact object with
// all eight keys, concrete nullable *string fields plus a bool, an exact ASCII
// money grammar normalized to two decimals, cross-field mode/amount shape rules
// and a separate fresh-mutability default factory.

// compensationKeys lists the eight wire keys of the compensation group in
// contract order.
var compensationKeys = []string{
	"mode",
	"amount",
	"min",
	"max",
	"currency",
	"pay_period",
	"basis",
	"public_visible",
}

// nullableCompensationKeys lists the keys that accept JSON null.
var nullableCompensationKeys = []string{
	"mode",
	"amount",
	"min",
	"max",
	"currency",
	"pay_period",
	"basis",
}

// validCompensationMap returns a fresh, valid compensation map: fixed mode with
// a concrete amount, every other nullable key null and public_visible true.
func validCompensationMap() map[string]any {
	return map[string]any{
		"mode":           "fixed",
		"amount":         "10.00",
		"min":            nil,
		"max":            nil,
		"currency":       "MXN",
		"pay_period":     "monthly",
		"basis":          "gross",
		"public_visible": true,
	}
}

// compensationFieldFor returns the nullable string field addressed by key.
func compensationFieldFor(t *testing.T, c Compensation, key string) *string {
	t.Helper()
	switch key {
	case "mode":
		return c.Mode
	case "amount":
		return c.Amount
	case "min":
		return c.Min
	case "max":
		return c.Max
	case "currency":
		return c.Currency
	case "pay_period":
		return c.PayPeriod
	case "basis":
		return c.Basis
	default:
		t.Fatalf("no nullable string field for %q", key)
		return nil
	}
}

// requireZeroCompensation asserts that a rejected input produced a zero result.
func requireZeroCompensation(t *testing.T, got Compensation) {
	t.Helper()
	if got != (Compensation{}) {
		t.Errorf("want zero Compensation on error, got %+v", got)
	}
}

func TestValidateCompensation_NilRootRejected(t *testing.T) {
	got, err := ValidateCompensation(nil)
	if !errors.Is(err, ErrCompensationNilRoot) {
		t.Fatalf("err = %v, want ErrCompensationNilRoot", err)
	}
	requireZeroCompensation(t, got)
}

func TestValidateCompensation_TypedNilMapRejected(t *testing.T) {
	var typedNil map[string]any
	got, err := ValidateCompensation(typedNil)
	if !errors.Is(err, ErrCompensationNilRoot) {
		t.Fatalf("err = %v, want ErrCompensationNilRoot", err)
	}
	requireZeroCompensation(t, got)
}

func TestValidateCompensation_NonObjectRejected(t *testing.T) {
	values := map[string]any{
		"string": "x",
		"int":    42,
		"float":  1.5,
		"bool":   true,
		"slice":  []any{},
		"array":  [2]int{1, 2},
		"struct": struct{}{},
	}
	for name, value := range values {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateCompensation(value)
			if !errors.Is(err, ErrCompensationNotObject) {
				t.Fatalf("err = %v, want ErrCompensationNotObject", err)
			}
			requireZeroCompensation(t, got)
		})
	}
}

func TestValidateCompensation_MissingKeysRejected(t *testing.T) {
	for _, key := range compensationKeys {
		t.Run(key, func(t *testing.T) {
			input := validCompensationMap()
			delete(input, key)
			got, err := ValidateCompensation(input)
			if !errors.Is(err, ErrCompensationMissingKey) {
				t.Fatalf("err = %v, want ErrCompensationMissingKey", err)
			}
			requireZeroCompensation(t, got)
		})
	}
}

func TestValidateCompensation_UnknownKeysRejected(t *testing.T) {
	unknownKeys := []string{
		"salary",
		"salary_min",
		"salary_max",
		"description",
		"MODE",
		"Mode",
		"payperiod",
		"public",
		"",
	}
	for _, key := range unknownKeys {
		t.Run(key, func(t *testing.T) {
			input := validCompensationMap()
			input[key] = "x"
			got, err := ValidateCompensation(input)
			if !errors.Is(err, ErrCompensationUnknownKey) {
				t.Fatalf("err = %v, want ErrCompensationUnknownKey", err)
			}
			requireZeroCompensation(t, got)
		})
	}
}

func TestValidateCompensation_WrongTypesRejected(t *testing.T) {
	badValues := map[string]any{
		"int64":   int64(1),
		"float64": float64(1),
		"bool":    true,
		"slice":   []any{"x"},
		"object":  map[string]any{"x": "y"},
	}
	for _, key := range nullableCompensationKeys {
		for name, value := range badValues {
			t.Run(key+"/"+name, func(t *testing.T) {
				input := validCompensationMap()
				input[key] = value
				got, err := ValidateCompensation(input)
				if !errors.Is(err, ErrCompensationWrongType) {
					t.Fatalf("err = %v, want ErrCompensationWrongType", err)
				}
				requireZeroCompensation(t, got)
			})
		}
	}

	publicVisibleValues := map[string]any{
		"null":    nil,
		"string":  "true",
		"int64":   int64(0),
		"float64": float64(0),
		"slice":   []any{},
		"object":  map[string]any{},
	}
	for name, value := range publicVisibleValues {
		t.Run("public_visible/"+name, func(t *testing.T) {
			input := validCompensationMap()
			input["public_visible"] = value
			got, err := ValidateCompensation(input)
			if !errors.Is(err, ErrCompensationWrongType) {
				t.Fatalf("err = %v, want ErrCompensationWrongType", err)
			}
			requireZeroCompensation(t, got)
		})
	}
}

func TestValidateCompensation_NullableFieldsAcceptNull(t *testing.T) {
	t.Run("mode", func(t *testing.T) {
		input := validCompensationMap()
		input["mode"] = nil
		input["amount"] = nil
		got, err := ValidateCompensation(input)
		if err != nil {
			t.Fatalf("ValidateCompensation: %v", err)
		}
		if got.Mode != nil {
			t.Errorf("Mode = %q, want nil", *got.Mode)
		}
	})

	for _, key := range nullableCompensationKeys {
		if key == "mode" {
			continue
		}
		t.Run(key, func(t *testing.T) {
			input := validCompensationMap()
			input[key] = nil
			got, err := ValidateCompensation(input)
			if err != nil {
				t.Fatalf("ValidateCompensation: %v", err)
			}
			if field := compensationFieldFor(t, got, key); field != nil {
				t.Errorf("%s = %q, want nil", key, *field)
			}
		})
	}
}

func TestValidateCompensation_EnumsAcceptExactLiterals(t *testing.T) {
	cases := []struct {
		key      string
		literals []string
	}{
		{key: "mode", literals: []string{"fixed", "range"}},
		{key: "currency", literals: []string{"MXN", "USD"}},
		{key: "pay_period", literals: []string{"hourly", "weekly", "semimonthly", "monthly", "yearly"}},
		{key: "basis", literals: []string{"gross", "net"}},
	}
	for _, tc := range cases {
		for _, literal := range tc.literals {
			t.Run(tc.key+"/"+literal, func(t *testing.T) {
				input := validCompensationMap()
				input[tc.key] = literal
				if tc.key == "mode" && literal == "range" {
					input["amount"] = nil
				}
				got, err := ValidateCompensation(input)
				if err != nil {
					t.Fatalf("ValidateCompensation: %v", err)
				}
				if field := compensationFieldFor(t, got, tc.key); field == nil || *field != literal {
					t.Errorf("%s = %v, want %q", tc.key, field, literal)
				}
			})
		}
	}
}

func TestValidateCompensation_EnumsRejectInexactLiterals(t *testing.T) {
	cases := []struct {
		key    string
		values []string
	}{
		{key: "mode", values: []string{"", "FIXED", "Fixed", " fixed", "fixed ", "range ", "daily", "FIXED_MODE", "fixed\xff"}},
		{key: "currency", values: []string{"", "mxn", "usd", "Mxn", " MXN", "MXN ", "EUR", "MX", "MXN\xff"}},
		{key: "pay_period", values: []string{"", "quincenal", "biweekly", "Hourly", "hourly ", " monthly", "yearly_", "month"}},
		{key: "basis", values: []string{"", "GROSS", "Net", "gross ", " net", "salary", "gross\xff"}},
	}
	for _, tc := range cases {
		for _, value := range tc.values {
			t.Run(tc.key+"/"+value, func(t *testing.T) {
				input := validCompensationMap()
				input[tc.key] = value
				got, err := ValidateCompensation(input)
				if !errors.Is(err, ErrCompensationInvalidEnum) {
					t.Fatalf("err = %v, want ErrCompensationInvalidEnum", err)
				}
				requireZeroCompensation(t, got)
			})
		}
	}
}

func TestValidateCompensation_MoneyNormalization(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{in: "0", want: "0.00"},
		{in: "0.0", want: "0.00"},
		{in: "0.00", want: "0.00"},
		{in: "0.5", want: "0.50"},
		{in: "0.05", want: "0.05"},
		{in: "1", want: "1.00"},
		{in: "1.2", want: "1.20"},
		{in: "1.23", want: "1.23"},
		{in: "10", want: "10.00"},
		{in: "100.5", want: "100.50"},
		{in: "12345.67", want: "12345.67"},
		{in: "999999999999", want: "999999999999.00"},
		{in: "999999999999.9", want: "999999999999.90"},
		{in: "999999999999.99", want: "999999999999.99"},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			input := validCompensationMap()
			input["amount"] = tc.in
			got, err := ValidateCompensation(input)
			if err != nil {
				t.Fatalf("ValidateCompensation(%q): %v", tc.in, err)
			}
			if got.Amount == nil || *got.Amount != tc.want {
				t.Errorf("Amount = %v, want %q", got.Amount, tc.want)
			}
		})
	}
}

func TestValidateCompensation_MoneyRejectsInvalidTokens(t *testing.T) {
	tokens := []string{
		"",
		" ",
		" 1",
		"1 ",
		"\t1",
		"1\t",
		"1\n",
		"1\r",
		"1\r\n",
		"1\u00a0",
		"\u00a01",
		"1\u2028",
		"1\u3000",
		"\u30001",
		"1\uFEFF",
		"\uFEFF1",
		"\x00",
		"1\x00",
		"\x0b1",
		"1\x0b",
		".1",
		"1.",
		"1.234",
		"1.2.3",
		"00",
		"007",
		"01",
		"0.",
		"0000000000001",
		"1000000000000",
		"9999999999999",
		"+1",
		"-1",
		"1e2",
		"1E2",
		"1,2",
		"1_0",
		"0x1",
		"abc",
		"NaN",
		"Infinity",
		"1.2e0",
		"１２３",
		"1\uFFFD",
		string([]byte{0xff}),
		"1" + string([]byte{0xff}),
		string([]byte{0x31, 0xc3}),
	}
	for _, token := range tokens {
		t.Run(fmt.Sprintf("%q", token), func(t *testing.T) {
			for _, key := range []string{"amount", "min", "max"} {
				input := validCompensationMap()
				switch key {
				case "amount":
					input["amount"] = token
				case "min":
					input["mode"] = "range"
					input["amount"] = nil
					input["min"] = token
				case "max":
					input["mode"] = "range"
					input["amount"] = nil
					input["max"] = token
				}
				got, err := ValidateCompensation(input)
				if !errors.Is(err, ErrCompensationInvalidAmount) {
					t.Fatalf("%s=%q: err = %v, want ErrCompensationInvalidAmount", key, token, err)
				}
				requireZeroCompensation(t, got)
			}
		})
	}
}

func TestValidateCompensation_MoneyBounds(t *testing.T) {
	t.Run("twelve integer digits accepted", func(t *testing.T) {
		got, err := ValidateCompensation(withAmount(t, "999999999999.99"))
		if err != nil {
			t.Fatalf("ValidateCompensation: %v", err)
		}
		if got.Amount == nil || *got.Amount != "999999999999.99" {
			t.Errorf("Amount = %v, want 999999999999.99", got.Amount)
		}
	})

	t.Run("thirteen integer digits rejected", func(t *testing.T) {
		got, err := ValidateCompensation(withAmount(t, "1000000000000"))
		if !errors.Is(err, ErrCompensationInvalidAmount) {
			t.Fatalf("err = %v, want ErrCompensationInvalidAmount", err)
		}
		requireZeroCompensation(t, got)
	})
}

// withAmount returns a valid fixed-mode map carrying the given amount token.
func withAmount(t *testing.T, amount string) map[string]any {
	t.Helper()
	input := validCompensationMap()
	input["amount"] = amount
	return input
}

func TestValidateCompensation_Shape(t *testing.T) {
	tests := []struct {
		name    string
		mode    any
		amount  any
		min     any
		max     any
		wantErr error
	}{
		{name: "null mode all money null", mode: nil, amount: nil, min: nil, max: nil},
		{name: "null mode amount present", mode: nil, amount: "1.00", min: nil, max: nil, wantErr: ErrCompensationShape},
		{name: "null mode min present", mode: nil, amount: nil, min: "1.00", max: nil, wantErr: ErrCompensationShape},
		{name: "null mode max present", mode: nil, amount: nil, min: nil, max: "1.00", wantErr: ErrCompensationShape},
		{name: "fixed all money null", mode: "fixed", amount: nil, min: nil, max: nil},
		{name: "fixed amount present", mode: "fixed", amount: "1.00", min: nil, max: nil},
		{name: "fixed min present", mode: "fixed", amount: nil, min: "1.00", max: nil, wantErr: ErrCompensationShape},
		{name: "fixed max present", mode: "fixed", amount: nil, min: nil, max: "1.00", wantErr: ErrCompensationShape},
		{name: "fixed amount and min present", mode: "fixed", amount: "1.00", min: "1.00", max: nil, wantErr: ErrCompensationShape},
		{name: "range all null", mode: "range", amount: nil, min: nil, max: nil},
		{name: "range min only", mode: "range", amount: nil, min: "1.00", max: nil},
		{name: "range max only", mode: "range", amount: nil, min: nil, max: "1.00"},
		{name: "range both ordered", mode: "range", amount: nil, min: "1.00", max: "2.00"},
		{name: "range amount present", mode: "range", amount: "1.00", min: nil, max: nil, wantErr: ErrCompensationShape},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			input := validCompensationMap()
			input["mode"] = tc.mode
			input["amount"] = tc.amount
			input["min"] = tc.min
			input["max"] = tc.max
			got, err := ValidateCompensation(input)
			if tc.wantErr == nil {
				if err != nil {
					t.Fatalf("ValidateCompensation: %v", err)
				}
				if tc.mode == nil {
					if got.Mode != nil {
						t.Errorf("Mode = %q, want nil", *got.Mode)
					}
				} else if got.Mode == nil || *got.Mode != tc.mode.(string) {
					t.Errorf("Mode = %v, want %q", got.Mode, tc.mode)
				}
				return
			}
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			requireZeroCompensation(t, got)
		})
	}
}

func TestValidateCompensation_MinMaxComparison(t *testing.T) {
	tests := []struct {
		name    string
		min     string
		max     string
		wantErr error
	}{
		{name: "min less than max", min: "1.00", max: "2.00"},
		{name: "min equals max", min: "2.00", max: "2.00"},
		{name: "min equals max after normalization", min: "2", max: "2.0"},
		{name: "min cents boundary", min: "10.99", max: "11.00"},
		{name: "min greater than max", min: "2.01", max: "2.00", wantErr: ErrCompensationMinExceedsMax},
		{name: "min greater than max by one cent", min: "2.00", max: "1.99", wantErr: ErrCompensationMinExceedsMax},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			input := validCompensationMap()
			input["mode"] = "range"
			input["amount"] = nil
			input["min"] = tc.min
			input["max"] = tc.max
			got, err := ValidateCompensation(input)
			if tc.wantErr == nil {
				if err != nil {
					t.Fatalf("ValidateCompensation: %v", err)
				}
				return
			}
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			requireZeroCompensation(t, got)
		})
	}
}

func TestValidateCompensation_DoesNotInsertDefaults(t *testing.T) {
	input := map[string]any{
		"mode":           nil,
		"amount":         nil,
		"min":            nil,
		"max":            nil,
		"currency":       nil,
		"pay_period":     nil,
		"basis":          nil,
		"public_visible": false,
	}
	got, err := ValidateCompensation(input)
	if err != nil {
		t.Fatalf("ValidateCompensation: %v", err)
	}
	if got != (Compensation{}) {
		t.Errorf("want no defaults on nullable input, got %+v", got)
	}
}

func TestValidateCompensation_DoesNotMutateInput(t *testing.T) {
	tests := []struct {
		name  string
		input map[string]any
	}{
		{name: "valid", input: validCompensationMap()},
		{
			name: "null mode",
			input: map[string]any{
				"mode":           nil,
				"amount":         nil,
				"min":            nil,
				"max":            nil,
				"currency":       nil,
				"pay_period":     nil,
				"basis":          nil,
				"public_visible": false,
			},
		},
		{
			name: "wrong type",
			input: func() map[string]any {
				m := validCompensationMap()
				m["amount"] = int64(3)
				return m
			}(),
		},
		{
			name: "unknown key",
			input: func() map[string]any {
				m := validCompensationMap()
				m["salary"] = "x"
				return m
			}(),
		},
		{
			name: "invalid amount",
			input: func() map[string]any {
				m := validCompensationMap()
				m["amount"] = "1.234"
				return m
			}(),
		},
		{
			name: "shape error",
			input: func() map[string]any {
				m := validCompensationMap()
				m["mode"] = "range"
				return m
			}(),
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			before := make(map[string]any, len(tc.input))
			for key, value := range tc.input {
				before[key] = value
			}
			_, _ = ValidateCompensation(tc.input)
			if !reflect.DeepEqual(tc.input, before) {
				t.Errorf("input mutated: got %v, want %v", tc.input, before)
			}
		})
	}
}

func TestValidateCompensation_OutputDoesNotAliasInput(t *testing.T) {
	// Direction 1: mutating the input map must not change the output.
	input := validCompensationMap()
	got, err := ValidateCompensation(input)
	if err != nil {
		t.Fatalf("ValidateCompensation: %v", err)
	}
	if got.Currency == nil || got.Amount == nil {
		t.Fatalf("expected currency and amount, got %+v", got)
	}
	input["currency"] = "USD"
	input["amount"] = "123.45"
	if *got.Currency != "MXN" {
		t.Errorf("output currency changed with input: %q", *got.Currency)
	}
	if *got.Amount != "10.00" {
		t.Errorf("output amount changed with input: %q", *got.Amount)
	}

	// Direction 2: mutating the output pointers must not change the input.
	fresh := validCompensationMap()
	mutable, err := ValidateCompensation(fresh)
	if err != nil {
		t.Fatalf("ValidateCompensation: %v", err)
	}
	*mutable.Currency = "USD"
	*mutable.Amount = "999.99"
	if fresh["currency"] != "MXN" {
		t.Errorf("input currency mutated through output: %v", fresh["currency"])
	}
	if fresh["amount"] != "10.00" {
		t.Errorf("input amount mutated through output: %v", fresh["amount"])
	}
}

func TestDefaultCompensation_Values(t *testing.T) {
	got := DefaultCompensation()
	if got.Mode != nil || got.Amount != nil || got.Min != nil || got.Max != nil || got.Basis != nil {
		t.Errorf("want nil mode/amount/min/max/basis, got %+v", got)
	}
	if got.Currency == nil || *got.Currency != "MXN" {
		t.Errorf("Currency = %v, want MXN", got.Currency)
	}
	if got.PayPeriod == nil || *got.PayPeriod != "monthly" {
		t.Errorf("PayPeriod = %v, want monthly", got.PayPeriod)
	}
	if got.PublicVisible {
		t.Errorf("PublicVisible = true, want false")
	}
}

func TestDefaultCompensation_FreshIndependentResults(t *testing.T) {
	a := DefaultCompensation()
	b := DefaultCompensation()
	if a.Currency == b.Currency {
		t.Error("Currency pointer aliased across factory calls")
	}
	if a.PayPeriod == b.PayPeriod {
		t.Error("PayPeriod pointer aliased across factory calls")
	}
	if a.Currency == nil || b.Currency == nil || a.PayPeriod == nil || b.PayPeriod == nil {
		t.Fatalf("factory returned nil defaults: a=%+v b=%+v", a, b)
	}
	*a.Currency = "USD"
	*a.PayPeriod = "hourly"
	if *b.Currency != "MXN" || *b.PayPeriod != "monthly" {
		t.Errorf("mutating one result changed another: %+v", b)
	}
}

func TestDefaultCompensation_AcceptedByValidator(t *testing.T) {
	input := map[string]any{
		"mode":           nil,
		"amount":         nil,
		"min":            nil,
		"max":            nil,
		"currency":       "MXN",
		"pay_period":     "monthly",
		"basis":          nil,
		"public_visible": false,
	}
	got, err := ValidateCompensation(input)
	if err != nil {
		t.Fatalf("ValidateCompensation(defaults): %v", err)
	}
	want := DefaultCompensation()
	if got.Mode != nil || got.Amount != nil || got.Min != nil || got.Max != nil || got.Basis != nil {
		t.Errorf("defaults-shaped input produced non-nil nullable fields: %+v", got)
	}
	if got.Currency == nil || *got.Currency != *want.Currency {
		t.Errorf("Currency = %v, want %v", got.Currency, *want.Currency)
	}
	if got.PayPeriod == nil || *got.PayPeriod != *want.PayPeriod {
		t.Errorf("PayPeriod = %v, want %v", got.PayPeriod, *want.PayPeriod)
	}
	if got.PublicVisible != want.PublicVisible {
		t.Errorf("PublicVisible = %v, want %v", got.PublicVisible, want.PublicVisible)
	}
}
