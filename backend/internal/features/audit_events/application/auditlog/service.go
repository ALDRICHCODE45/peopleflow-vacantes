package auditlog

import (
	"context"
	"fmt"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
)

// Service is the audit screen's use cases: list, catalogs and export.
type Service struct {
	reader      Reader
	exportLimit int
	now         func() time.Time
}

func NewService(reader Reader) *Service {
	return &Service{reader: reader, exportLimit: ExportRowLimit, now: time.Now}
}

// WithExportLimit replaces the 50,000-row cap; tests use it so they do not
// insert 50,000 rows.
func (s *Service) WithExportLimit(n int) *Service { s.exportLimit = n; return s }

func (s *Service) WithClock(now func() time.Time) *Service { s.now = now; return s }

func (s *Service) List(ctx context.Context, company uuid.UUID, raw string) (Page, error) {
	q, err := ParseQuery(company, raw)
	if err != nil {
		return Page{}, err
	}
	page, err := s.reader.List(ctx, company, q)
	if err != nil {
		return Page{}, err
	}
	if page.Items == nil {
		page.Items = []Item{}
	}
	if len(page.Items) > q.Limit {
		page.Items = page.Items[:q.Limit]
		last := page.Items[q.Limit-1]
		token, err := encodeCursor(company, q.Filters, Position{At: last.OccurredAt.Time, ID: last.ID})
		if err != nil {
			return Page{}, err
		}
		page.NextCursor = &token
	}
	return page, nil
}

// Types is the closed, ordered catalog behind the «Acción» filter.
func (s *Service) Types() TypesResponse {
	out := TypesResponse{Items: []TypeItem{}}
	for _, spec := range entities.Catalog() {
		out.Items = append(out.Items, TypeItem{EventType: spec.Type, Category: string(spec.Category)})
	}
	return out
}

func (s *Service) Actors(ctx context.Context, company uuid.UUID) (ActorsResponse, error) {
	items, err := s.reader.Actors(ctx, company)
	if items == nil {
		items = []ActorOption{}
	}
	return ActorsResponse{Items: items}, err
}

func (s *Service) Vacancies(ctx context.Context, company uuid.UUID) (VacanciesResponse, error) {
	items, err := s.reader.Vacancies(ctx, company)
	if items == nil {
		items = []VacancyOption{}
	}
	return VacanciesResponse{Items: items}, err
}

// Export is an accepted export: the file name and the rows to stream. The
// AuditLogExported record is already committed when Export returns.
type Export struct {
	Filename string
	Stream   ExportStream
}

// Export validates the body, counts, refuses above the limit (*TooLarge), then
// records AuditLogExported and returns the stream. Nothing is written for a
// rejected request.
func (s *Service) Export(ctx context.Context, company, actor uuid.UUID, body []byte) (Export, error) {
	filters, err := ParseExport(body)
	if err != nil {
		return Export{}, err
	}
	loc, err := time.LoadLocation(TimeZone)
	if err != nil {
		return Export{}, err
	}
	stream, err := s.reader.Export(ctx, ExportRequest{
		Company: company,
		Filters: filters,
		Limit:   s.exportLimit,
		Audit: func(rowCount int) entities.AuditEvent {
			return entities.AuditEvent{
				ID:                 uuid.Must(uuid.NewV7()),
				ActorType:          entities.ActorTypeUser,
				ActorID:            &actor,
				EventType:          entities.EventAuditLogExported,
				EntityType:         entities.EntityCompany,
				EntityID:           company,
				CompanyID:          &company,
				StructuredMetadata: map[string]any{"filters": filters.AuditMetadata(), "row_count": rowCount},
			}
		},
	})
	if err != nil {
		return Export{}, err
	}
	return Export{Filename: fmt.Sprintf("auditoria-%s.csv", s.now().In(loc).Format(dateLayout)), Stream: stream}, nil
}
