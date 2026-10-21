package languages

// CodeField is the catalog identifier key, not an HTTP error-catalog code.
const CodeField = "code"

// Proficiency is the common wire representation of a catalog language and level.
type Proficiency struct {
	Code  string `json:"code"`
	Level string `json:"level"`
}
