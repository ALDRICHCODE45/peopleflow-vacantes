package valueobjects

import "testing"

func TestE164Phone(t *testing.T) {
	for _, tt := range []struct {
		name  string
		input string
		valid bool
	}{
		{"Mexico ten national digits", "+525512345678", true},
		{"Mexico nine national digits", "+52551234567", false},
		{"Mexico eleven national digits", "+5255123456789", false},
		{"international minimum", "+12345678", true},
		{"international below minimum", "+1234567", false},
		{"international maximum", "+123456789012345", true},
		{"international above maximum", "+1234567890123456", false},
		{"empty", "", false},
		{"missing plus", "525512345678", false},
		{"zero country prefix", "+02345678", false},
		{"spaces", "+52 5512345678", false},
		{"leading whitespace", " +525512345678", false},
		{"trailing whitespace", "+525512345678 ", false},
		{"punctuation", "+52-5512345678", false},
		{"extension", "+525512345678x1", false},
		{"non ASCII digits", "+５２５５１２３４５６７８", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			phone, err := NewPhone(tt.input)
			if (err == nil) != tt.valid {
				t.Fatalf("valid = %v, want %v", err == nil, tt.valid)
			}
			if tt.valid && phone.String() != tt.input {
				t.Fatal("valid E.164 phone must be preserved exactly")
			}
		})
	}
}
