// Package domain contains catalog values shared by geo application ports.
package domain

// Item is a code and its localized display name; codes keep leading zeros.
type Item struct{ Code, Name string }
type PostalMatch struct{ State, Municipality Item }

type Value struct{ Country, State, Municipality, PostalCode string }

type Rules struct {
	FieldPrefix         string
	Required            bool
	RequireState        bool
	RequireMunicipality bool
	AllowPostalCode     bool
}

type Violation struct{ Field, Reason string }
