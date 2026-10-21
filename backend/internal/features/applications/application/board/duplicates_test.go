package board

import (
	"errors"
	"reflect"
	"testing"
)

func TestDuplicateRequestShapeAndValidation(t *testing.T) {
	for _, body := range []string{`null`, `[]`, `{}`, `{"email":null}`, `{"email":null,"phone":null,"x":1}`, `{"email":null,"email":null,"phone":null}`, `{"email":1,"phone":null}`, `{"email":null,"phone":{}}`, `{"email":null,"phone":null} {}`} {
		t.Run(body, func(t *testing.T) {
			if _, err := ParseDuplicateRequest([]byte(body)); !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("got %v", err)
			}
		})
	}
	for _, tc := range []struct {
		body   string
		fields []ManualFieldError
	}{
		{`{"email":null,"phone":null}`, []ManualFieldError{{"contact", "required"}}},
		{`{"email":"bad","phone":"123"}`, []ManualFieldError{{"email", "invalid"}, {"phone", "invalid"}}},
		{`{"email":"","phone":null}`, []ManualFieldError{{"email", "invalid"}}},
		{`{"email":null,"phone":"+521234567890"}`, nil},
		{`{"email":" A@Example.com ","phone":null}`, nil},
	} {
		t.Run(tc.body, func(t *testing.T) {
			r, err := ParseDuplicateRequest([]byte(tc.body))
			if err != nil {
				t.Fatal(err)
			}
			if got := r.Validate(); !reflect.DeepEqual(got, tc.fields) {
				t.Fatalf("%+v", got)
			}
			if r.Email != nil && tc.fields == nil && *r.Email != "a@example.com" {
				t.Fatal(*r.Email)
			}
		})
	}
}

func TestDuplicateContactMasks(t *testing.T) {
	if MaskEmail(nil) != nil || MaskPhone(nil) != nil {
		t.Fatal("absent contact")
	}
	for _, tc := range []struct{ input, want string }{{"ana@example.com", "a***@example.com"}, {"Éva@example.com", "é***@example.com"}} {
		got := MaskEmail(&tc.input)
		if got == nil || *got != tc.want {
			t.Fatal(got)
		}
	}
	for _, tc := range []struct{ input, want string }{{"+521234561234", "+52 •••• ••12 34"}, {"+14155551234", "+1 •••• ••12 34"}, {"+442079461234", "+44 •••• ••12 34"}, {"+971501231234", "+971 •••• ••12 34"}} {
		got := MaskPhone(&tc.input)
		if got == nil || *got != tc.want {
			t.Fatal(got)
		}
	}
}
