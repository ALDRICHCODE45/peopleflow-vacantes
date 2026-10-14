package valueobjects

import (
	"errors"
	"strings"
	"testing"
)

// Length limits count characters (Unicode code points), not UTF-8 bytes: a
// valid Mexican company RFC may contain Ñ, and Spanish names and descriptions
// routinely contain accented letters.

func TestCompanyRfc_CountsCharactersNotBytes(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		want    string
		wantErr bool
	}{
		{name: "ascii 12", in: "ABC010101AB1", want: "ABC010101AB1"},
		{name: "ampersand 12", in: "A&B010101AB1", want: "A&B010101AB1"},
		{name: "enye 12 characters 13 bytes", in: "AÑB010101AB1", want: "AÑB010101AB1"},
		{name: "lowercase enye is uppercased", in: " añb010101ab1 ", want: "AÑB010101AB1"},
		{name: "ascii 11", in: "ABC010101AB", wantErr: true},
		{name: "ascii 13", in: "ABCD010101AB1", wantErr: true},
		{name: "enye 11 characters 12 bytes", in: "AÑB01010AB1", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rfc, err := NewCompanyRfc(tt.in)
			if tt.wantErr {
				if !errors.Is(err, ErrCompanyRfcInvalidLength) {
					t.Fatalf("NewCompanyRfc(%q) error = %v, want ErrCompanyRfcInvalidLength", tt.in, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("NewCompanyRfc(%q) error = %v, want nil", tt.in, err)
			}
			if rfc.Value() != tt.want {
				t.Errorf("NewCompanyRfc(%q) = %q, want %q", tt.in, rfc.Value(), tt.want)
			}
		})
	}
}

func TestCompanyName_CountsCharactersNotBytes(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		wantErr bool
	}{
		{name: "ascii 4", in: "Acme"},
		{name: "ascii 3", in: "Abc", wantErr: true},
		{name: "accented 4", in: "Ñaño"},
		{name: "accented 3 characters 6 bytes", in: "Ñañ", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewCompanyName(tt.in)
			if tt.wantErr != errors.Is(err, ErrCompanyNameTooShort) {
				t.Fatalf("NewCompanyName(%q) error = %v, wantErr %v", tt.in, err, tt.wantErr)
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("NewCompanyName(%q) unexpected error = %v", tt.in, err)
			}
		})
	}
}

func TestCompanyDescription_CountsCharactersNotBytes(t *testing.T) {
	at3000 := strings.Repeat("ñ", 3000)
	if _, err := NewCompanyDescription(at3000); err != nil {
		t.Fatalf("3000 multibyte characters: error = %v, want nil", err)
	}
	over := strings.Repeat("ñ", 3001)
	if _, err := NewCompanyDescription(over); !errors.Is(err, ErrCompanyDescriptionTooLong) {
		t.Fatalf("3001 multibyte characters: error = %v, want ErrCompanyDescriptionTooLong", err)
	}
}
