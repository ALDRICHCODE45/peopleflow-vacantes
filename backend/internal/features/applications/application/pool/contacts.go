package pool

import (
	"context"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/google/uuid"
)

const MaxContacts = 100

type Identity struct {
	Kind string    `json:"kind"`
	ID   uuid.UUID `json:"id"`
}
type ContactItem struct {
	Identity
	Email *string `json:"email"`
	Phone *string `json:"phone"`
}
type ContactsPage struct {
	Items []ContactItem `json:"items"`
}

// DecodeContacts shares the strict JSON decoder used by board POST requests.
// Rejected values never enter public validation metadata.
func DecodeContacts(body []byte, decode board.JSONDecoder) ([]Identity, error) {
	value, err := decode(body)
	if err != nil {
		return nil, board.ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok || root == nil {
		return nil, board.ErrInvalidRequest
	}
	for key := range root {
		if key != "candidates" {
			return nil, board.ErrInvalidRequest
		}
	}
	entries, ok := root["candidates"].([]any)
	if !ok && root["candidates"] != nil {
		return nil, board.ErrInvalidRequest
	}
	fail := func(field, code string) ([]Identity, error) {
		return nil, &board.ManualValidationError{Fields: []board.ManualFieldError{{Field: field, Code: code}}}
	}
	if len(entries) == 0 {
		return fail("candidates", "required")
	}
	if len(entries) > MaxContacts {
		return fail("candidates", "too_many")
	}
	out := make([]Identity, 0, len(entries))
	seen := map[Identity]bool{}
	fields := []board.ManualFieldError{}
	duplicate := false
	for i, entry := range entries {
		obj, ok := entry.(map[string]any)
		if !ok || obj == nil {
			return nil, board.ErrInvalidRequest
		}
		for key := range obj {
			if key != "kind" && key != "id" {
				return nil, board.ErrInvalidRequest
			}
		}
		kind, _ := obj["kind"].(string)
		rawID, _ := obj["id"].(string)
		id, err := uuid.Parse(rawID)
		validKind := kind == "manual" || kind == "organic"
		validID := err == nil && id != uuid.Nil
		if !validKind {
			fields = append(fields, board.ManualFieldError{Field: fmt.Sprintf("candidates[%d].kind", i), Code: "invalid"})
		}
		if !validID {
			fields = append(fields, board.ManualFieldError{Field: fmt.Sprintf("candidates[%d].id", i), Code: "invalid"})
		}
		identity := Identity{Kind: kind, ID: id}
		if validKind && validID {
			duplicate = duplicate || seen[identity]
			seen[identity] = true
			out = append(out, identity)
		}
	}
	if len(fields) > 0 {
		return nil, &board.ManualValidationError{Fields: fields}
	}
	if duplicate {
		return fail("candidates", "duplicate")
	}
	return out, nil
}

func (s *Service) Contacts(ctx context.Context, company uuid.UUID, candidates []Identity) (ContactsPage, error) {
	items, err := s.reader.Contacts(ctx, company, candidates)
	if err != nil {
		return ContactsPage{}, err
	}
	if items == nil {
		items = []ContactItem{}
	}
	return ContactsPage{Items: items}, nil
}
