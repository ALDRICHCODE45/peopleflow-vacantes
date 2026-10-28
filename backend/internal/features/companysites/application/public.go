package application

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	geo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/application"
	"github.com/google/uuid"
)

var ErrSiteNotFound = errors.New("site not found")

// PublicCompany is an explicit allowlist, never the private company aggregate.
// Location uses the same read DTO as GET /companies/{id}.
type PublicCompany struct {
	ID           uuid.UUID         `json:"id"`
	Name         string            `json:"name"`
	LogoURL      *string           `json:"logo_url"`
	Description  *string           `json:"description"`
	Website      *string           `json:"website"`
	LinkedInURL  *string           `json:"linkedin_url"`
	InstagramURL *string           `json:"instagram_url"`
	FacebookURL  *string           `json:"facebook_url"`
	TwitterURL   *string           `json:"twitter_url"`
	Location     *geo.ReadLocation `json:"location"`
}

type PublicSnapshot struct {
	CompanyID   uuid.UUID       `json:"-"`
	Company     PublicCompany   `json:"company"`
	Site        json.RawMessage `json:"site"`
	Slug        string          `json:"slug"`
	PublishedAt time.Time       `json:"published_at"`
	Media       []Media         `json:"media"`
}

type PublicReader interface {
	Public(context.Context, string) (PublicSnapshot, error)
}

// ReadPublicCompany is injected at the composition root to reuse the companies
// read service and its geography serializer without crossing slice boundaries.
type ReadPublicCompany func(context.Context, uuid.UUID) (PublicCompany, error)

// VisibleDocument never mutates the stored snapshot and derives media references
// using the document grammar, not a recursive search through arbitrary JSON.
func (v *Validator) VisibleDocument(value any) (*Document, error) {
	// Validate exactly once: validation canonicalizes rich bodies in place, so a
	// second pass would hand the rich validator an already-encoded body. Hidden
	// blocks are dropped from the decoded value first (hero and jobs are never
	// hidden, so the visible document keeps its structural minimums).
	m, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("invalid published site")
	}
	if blocks, ok := m["blocks"].([]any); ok {
		visible := []any{}
		for _, raw := range blocks {
			if block, ok := raw.(map[string]any); !ok || block["hidden"] != true {
				visible = append(visible, raw)
			}
		}
		m["blocks"] = visible
	}
	doc, fields := v.ValidateStoredDocument(m)
	if len(fields) != 0 {
		return nil, errors.New("invalid published site")
	}
	delete(doc.Value, "slug")
	var err error
	doc.Canonical, err = json.Marshal(doc.Value)
	return doc, err
}
