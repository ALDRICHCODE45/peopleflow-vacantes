package board

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"strings"
	"time"
	"unicode/utf8"

	identity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
	"github.com/google/uuid"
)

// DuplicateStore is separate from movement so intake does not expand movement's port.
type DuplicateStore interface {
	DuplicatesCheck(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, []byte) (DuplicateMatches, error)
}

type DuplicateRequest struct{ Email, Phone *string }
type ManualValidationError struct{ Fields []ManualFieldError }

func (e *ManualValidationError) Error() string { return "manual intake validation failed" }

type DuplicateVacancy struct {
	ID    uuid.UUID `json:"id"`
	Title string    `json:"title"`
}
type DuplicateMatch struct {
	Kind          string            `json:"kind"`
	ID            uuid.UUID         `json:"id"`
	FullName      string            `json:"full_name"`
	EmailMasked   *string           `json:"email_masked"`
	PhoneMasked   *string           `json:"phone_masked"`
	LastVacancy   *DuplicateVacancy `json:"last_vacancy"`
	LastAddedAt   *time.Time        `json:"last_added_at"`
	InThisProcess bool              `json:"in_this_process"`
}
type DuplicateMatches struct {
	Matches []DuplicateMatch `json:"matches"`
}

// ParseDuplicateRequest rejects ambiguous envelopes, including repeated keys.
func ParseDuplicateRequest(body []byte) (DuplicateRequest, error) {
	var out DuplicateRequest
	d := json.NewDecoder(bytes.NewReader(body))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return out, ErrInvalidRequest
	}
	seen := map[string]bool{}
	for d.More() {
		token, err = d.Token()
		if err != nil {
			return DuplicateRequest{}, ErrInvalidRequest
		}
		key, ok := token.(string)
		if !ok || (key != "email" && key != "phone") || seen[key] {
			return DuplicateRequest{}, ErrInvalidRequest
		}
		seen[key] = true
		target := &out.Email
		if key == "phone" {
			target = &out.Phone
		}
		if d.Decode(target) != nil {
			return DuplicateRequest{}, ErrInvalidRequest
		}
	}
	if token, err = d.Token(); err != nil || token != json.Delim('}') || len(seen) != 2 {
		return DuplicateRequest{}, ErrInvalidRequest
	}
	if _, err = d.Token(); err != io.EOF {
		return DuplicateRequest{}, ErrInvalidRequest
	}
	return out, nil
}

func (r *DuplicateRequest) Validate() []ManualFieldError {
	var fields []ManualFieldError
	if r.Email == nil && r.Phone == nil {
		return []ManualFieldError{{Field: "contact", Code: "required"}}
	}
	if r.Email != nil {
		normalized := strings.ToLower(strings.TrimSpace(*r.Email))
		email, err := identity.NewEmail(normalized)
		if err != nil || email.Value() != normalized {
			fields = append(fields, ManualFieldError{Field: "email", Code: "invalid"})
		} else {
			r.Email = &normalized
		}
	}
	if r.Phone != nil {
		if _, err := valueobjects.NewPhone(*r.Phone); err != nil {
			fields = append(fields, ManualFieldError{Field: "phone", Code: "invalid"})
		}
	}
	return fields
}

func MaskEmail(email *string) *string {
	if email == nil {
		return nil
	}
	value := strings.ToLower(strings.TrimSpace(*email))
	at := strings.LastIndexByte(value, '@')
	if at < 1 {
		return nil
	} // Legacy profiles may contain invalid contacts; never expose them.
	first, _ := utf8.DecodeRuneInString(value)
	masked := string(first) + "***" + value[at:]
	return &masked
}

func MaskPhone(phone *string) *string {
	if phone == nil {
		return nil
	}
	value := *phone
	if _, err := valueobjects.NewPhone(value); err != nil {
		return nil
	}
	// E.164 calling codes are 1–3 digits. All assigned two-digit codes are
	// listed here; remaining prefixes use three digits. Invalid legacy values
	// are suppressed above rather than leaking their unmasked content.
	prefix := 3
	if value[1] == '1' || value[1] == '7' {
		prefix = 1
	} else if strings.Contains(" 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98 ", " "+value[1:3]+" ") {
		prefix = 2
	}
	last := value[len(value)-4:]
	masked := value[:prefix+1] + " •••• ••" + last[:2] + " " + last[2:]
	return &masked
}
