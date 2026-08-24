// Unit tests for the tri-state Optional[T] value object.
//
// The Optional[T] distinguishes three JSON presence states for nullable
// PATCH fields (location, salary_min, salary_max):
//
//   - Absent   : key missing from the body   → Set=false,    Valid=false
//   - Null     : key present as JSON `null`  → Set=true,     Valid=false
//   - Value    : key present with a value    → Set=true,     Valid=true,  Value populated
//
// The handler uses Optional[T] so a PATCH body can express "clear this
// column to NULL" without resorting to a sentinel string or a separate
// flags map. The contract tested here is the only public surface the
// rest of the slice depends on.
package valueobjects

import (
	"encoding/json"
	"errors"
	"testing"
)

// optionalStringWrap mirrors the way the DTO embeds Optional[string] on
// the wire: a single-field struct with a JSON tag. Without the tag, the
// receiver field name (`Location`) would never match the JSON key
// `location`, and the codec would never run.
type optionalStringWrap struct {
	Location Optional[string] `json:"location"`
}

type optionalIntWrap struct {
	SalaryMin Optional[int] `json:"salary_min"`
}

// --- Optional[string] ----------------------------------------------------

// TestOptional_String_AbsentKey asserts that a body with the key missing
// leaves the receiver in the "absent" state: Set=false. This is the
// default (zero) value and is achieved when `encoding/json` never
// touches the field, which means the field MUST NOT be present on the
// wire.
func TestOptional_String_AbsentKey(t *testing.T) {
	var got optionalStringWrap
	if err := json.Unmarshal([]byte(`{}`), &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if got.Location.Set {
		t.Errorf("absent key: Set must be false, got true")
	}
	if got.Location.Valid {
		t.Errorf("absent key: Valid must be false, got true")
	}
	if got.Location.Value != "" {
		t.Errorf("absent key: Value must be empty string, got %q", got.Location.Value)
	}
}

// TestOptional_String_ExplicitNull asserts that a body containing
// `"location": null` decodes to Set=true, Valid=false, Value="". This
// is the "clear to null" semantics the spec requires.
func TestOptional_String_ExplicitNull(t *testing.T) {
	var got optionalStringWrap
	if err := json.Unmarshal([]byte(`{"location":null}`), &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if !got.Location.Set {
		t.Errorf("Set: want true, got false")
	}
	if got.Location.Valid {
		t.Errorf("Valid: want false (explicit null), got true")
	}
	if got.Location.Value != "" {
		t.Errorf("Value: want \"\" (explicit null), got %q", got.Location.Value)
	}
}

// TestOptional_String_Value asserts that a body with a real string
// value decodes to Set=true, Valid=true, Value populated.
func TestOptional_String_Value(t *testing.T) {
	var got optionalStringWrap
	if err := json.Unmarshal([]byte(`{"location":"CDMX"}`), &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if !got.Location.Set {
		t.Errorf("Set: want true, got false")
	}
	if !got.Location.Valid {
		t.Errorf("Valid: want true, got false")
	}
	if got.Location.Value != "CDMX" {
		t.Errorf("Value: want %q, got %q", "CDMX", got.Location.Value)
	}
}

// TestOptional_String_WrongType returns an error. The "wrong type"
// case must surface as a JSON decode error so the handler returns 400
// rather than silently zeroing.
func TestOptional_String_WrongType(t *testing.T) {
	var got optionalStringWrap
	err := json.Unmarshal([]byte(`{"location":42}`), &got)
	if err == nil {
		t.Fatal("Unmarshal: want error on wrong type, got nil")
	}
	// Accept any non-nil error; the exact wording shifts across Go
	// versions, so we don't pin the message.
	var te *json.UnmarshalTypeError
	if !errors.As(err, &te) {
		t.Logf("UnmarshalTypeError not detected (encoding/json wording may have changed): %v", err)
	}
}

// TestOptional_String_EmptyStringIsValue asserts that the empty string
// is NOT the same as JSON null: `""` is a VALUE, just an empty one.
// The handler will treat it like any other present string (and the use
// case will reject empty-after-trim with ErrEmptyTitle/ErrEmptyDescription
// for the title/description fields; location has no such rule).
func TestOptional_String_EmptyStringIsValue(t *testing.T) {
	var got optionalStringWrap
	if err := json.Unmarshal([]byte(`{"location":""}`), &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if !got.Location.Set || !got.Location.Valid {
		t.Errorf("empty string: want Set=true,Valid=true, got Set=%v Valid=%v", got.Location.Set, got.Location.Valid)
	}
	if got.Location.Value != "" {
		t.Errorf("Value: want \"\", got %q", got.Location.Value)
	}
}

// --- Optional[int] -------------------------------------------------------

// TestOptional_Int_ExplicitNull mirrors the string null case for the
// nullable salary_min / salary_max: `null` means "clear", absent means
// "leave unchanged".
func TestOptional_Int_ExplicitNull(t *testing.T) {
	var got optionalIntWrap
	if err := json.Unmarshal([]byte(`{"salary_min":null}`), &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if !got.SalaryMin.Set {
		t.Errorf("Set: want true, got false")
	}
	if got.SalaryMin.Valid {
		t.Errorf("Valid: want false (explicit null), got true")
	}
}

// TestOptional_Int_Value decodes a real int.
func TestOptional_Int_Value(t *testing.T) {
	var got optionalIntWrap
	if err := json.Unmarshal([]byte(`{"salary_min":50000}`), &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if !got.SalaryMin.Set || !got.SalaryMin.Valid {
		t.Errorf("Set/Valid: want both true, got Set=%v Valid=%v", got.SalaryMin.Set, got.SalaryMin.Valid)
	}
	if got.SalaryMin.Value != 50000 {
		t.Errorf("Value: want 50000, got %d", got.SalaryMin.Value)
	}
}

// TestOptional_Int_NegativeValue passes through unchanged — the use
// case applies the salary range rule, not the codec. A negative value
// must survive the wire round-trip so the use case can reject it
// with the right sentinel.
func TestOptional_Int_NegativeValue(t *testing.T) {
	var got optionalIntWrap
	if err := json.Unmarshal([]byte(`{"salary_min":-1}`), &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if got.SalaryMin.Value != -1 {
		t.Errorf("Value: want -1, got %d", got.SalaryMin.Value)
	}
}

// TestOptional_Int_WrongType errors (a string in an int field is not
// valid JSON).
func TestOptional_Int_WrongType(t *testing.T) {
	var got optionalIntWrap
	err := json.Unmarshal([]byte(`{"salary_min":"abc"}`), &got)
	if err == nil {
		t.Fatal("Unmarshal: want error on wrong type, got nil")
	}
}

// --- absent vs null round trip through a wrapper with both fields -------

// TestOptional_BothFields_AbsentVsNull discriminates two parallel
// fields in one body: one absent, one null, one valued. The use case
// relies on this discrimination to apply partial-update semantics.
func TestOptional_BothFields_AbsentVsNull(t *testing.T) {
	type wrap struct {
		Location    Optional[string] `json:"location"`
		SalaryMin   Optional[int]    `json:"salary_min"`
		SalaryMax   Optional[int]    `json:"salary_max"`
		Description Optional[string] `json:"description"`
	}
	var got wrap
	bodyJSON := `{"location":"CDMX","salary_min":null,"salary_max":80000}`
	if err := json.Unmarshal([]byte(bodyJSON), &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	// location=CDMX → Set=true, Valid=true, Value="CDMX"
	if !got.Location.Set || !got.Location.Valid || got.Location.Value != "CDMX" {
		t.Errorf("Location: want {Set:true,Valid:true,Value:CDMX}, got %+v", got.Location)
	}
	// salary_min=null → Set=true, Valid=false
	if !got.SalaryMin.Set || got.SalaryMin.Valid {
		t.Errorf("SalaryMin: want {Set:true,Valid:false}, got %+v", got.SalaryMin)
	}
	// salary_max=80000 → Set=true, Valid=true, Value=80000
	if !got.SalaryMax.Set || !got.SalaryMax.Valid || got.SalaryMax.Value != 80000 {
		t.Errorf("SalaryMax: want {Set:true,Valid:true,Value:80000}, got %+v", got.SalaryMax)
	}
	// description absent → Set=false
	if got.Description.Set {
		t.Errorf("Description: want {Set:false}, got %+v", got.Description)
	}
}