package valueobjects

import "errors"

var ErrInvalidPhone = errors.New("invalid E.164 phone")

// Phone is an exact E.164 contact identifier. Formatting is not normalized so
// duplicate checks can compare validated values without guessing country codes.
type Phone struct{ value string }

// NewPhone accepts 8–15 ASCII digits after '+', with a nonzero country prefix.
// Mexico's +52 prefix requires exactly ten national digits. This validates the
// intake wire format, not whether a subscriber number or calling code is assigned.
func NewPhone(value string) (Phone, error) {
	if len(value) < 9 || len(value) > 16 || value[0] != '+' || value[1] < '1' || value[1] > '9' {
		return Phone{}, ErrInvalidPhone
	}
	for i := 2; i < len(value); i++ {
		if value[i] < '0' || value[i] > '9' {
			return Phone{}, ErrInvalidPhone
		}
	}
	if value[1:3] == "52" && len(value) != 13 {
		return Phone{}, ErrInvalidPhone
	}
	return Phone{value: value}, nil
}

func (p Phone) String() string { return p.value }
