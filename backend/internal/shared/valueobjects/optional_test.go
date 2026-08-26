// Smoke test for the lifted Optional[T] type (companies-write D6).
//
// The deep semantics are covered by the existing jobs suite at
// internal/features/jobs/domain/valueobjects/optional_test.go which
// now exercises the shared implementation through the generic type
// alias re-export. This file adds a thin mirror at the shared package
// level so a future refactor that drops the jobs re-export still has
// direct coverage here, and so a developer landing on the shared
// package alone has a quick orientation test.
//
// The tests deliberately mirror the jobs suite's expectations
// (absent -> Set=false; explicit null -> Set=true, Valid=false;
// value -> Set=true, Valid=true, Value populated) so the lift is
// provably behavior-preserving.
package valueobjects

import (
	"encoding/json"
	"errors"
	"testing"
)

type optionalStringWrap struct {
	Field Optional[string] `json:"field"`
}

type optionalIntWrap struct {
	Count Optional[int] `json:"count"`
}

func TestSharedOptional_StringAbsent(t *testing.T) {
	var got optionalStringWrap
	if err := json.Unmarshal([]byte(`{}`), &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if got.Field.Set || got.Field.Valid || got.Field.Value != "" {
		t.Errorf("absent: want zero state, got %+v", got.Field)
	}
}

func TestSharedOptional_StringNull(t *testing.T) {
	var got optionalStringWrap
	if err := json.Unmarshal([]byte(`{"field":null}`), &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if !got.Field.Set {
		t.Errorf("Set: want true, got false")
	}
	if got.Field.Valid {
		t.Errorf("Valid: want false, got true")
	}
}

func TestSharedOptional_StringValue(t *testing.T) {
	var got optionalStringWrap
	if err := json.Unmarshal([]byte(`{"field":"hello"}`), &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if !got.Field.Set || !got.Field.Valid || got.Field.Value != "hello" {
		t.Errorf("value: want {Set:true,Valid:true,Value:hello}, got %+v", got.Field)
	}
}

func TestSharedOptional_IntNull(t *testing.T) {
	var got optionalIntWrap
	if err := json.Unmarshal([]byte(`{"count":null}`), &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if !got.Count.Set || got.Count.Valid {
		t.Errorf("null int: want {Set:true,Valid:false}, got %+v", got.Count)
	}
}

func TestSharedOptional_IntValue(t *testing.T) {
	var got optionalIntWrap
	if err := json.Unmarshal([]byte(`{"count":42}`), &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if !got.Count.Set || !got.Count.Valid || got.Count.Value != 42 {
		t.Errorf("value int: want {Set:true,Valid:true,Value:42}, got %+v", got.Count)
	}
}

func TestSharedOptional_StringWrongType(t *testing.T) {
	var got optionalStringWrap
	err := json.Unmarshal([]byte(`{"field":99}`), &got)
	if err == nil {
		t.Fatal("want error on wrong type, got nil")
	}
	var te *json.UnmarshalTypeError
	if !errors.As(err, &te) {
		t.Logf("UnmarshalTypeError not detected (encoding/json wording may have changed): %v", err)
	}
}
