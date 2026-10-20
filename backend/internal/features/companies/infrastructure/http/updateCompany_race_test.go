package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Pause PATCH A after its repository write committed, before the service can
// render its response. PATCH B then commits using A's actual written token.
// This models the post-commit window without a database or scheduler sleeps.
type interleavedCompanyPatchRepository struct {
	repositories.CompanyRepository
	mu             sync.Mutex
	row            *entities.Company
	writes         int
	firstCommitted chan struct{}
	resumeFirst    chan struct{}
}

func (r *interleavedCompanyPatchRepository) GetCompanyForUpdate(context.Context, uuid.UUID) (*entities.Company, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	row := *r.row
	if row.Location != nil {
		location := *row.Location
		row.Location = &location
	}
	return &row, nil
}
func (r *interleavedCompanyPatchRepository) UpdateCompany(ctx context.Context, id uuid.UUID, patch repositories.UpdateCompanyPatch, cas time.Time, event audit.AuditEvent) error {
	_, err := r.UpdateCompanyReturning(ctx, id, patch, cas, event)
	return err
}
func (r *interleavedCompanyPatchRepository) UpdateCompanyReturning(ctx context.Context, _ uuid.UUID, patch repositories.UpdateCompanyPatch, cas time.Time, _ audit.AuditEvent) (*entities.Company, error) {
	r.mu.Lock()
	if !r.row.UpdatedAt.Equal(cas) {
		r.mu.Unlock()
		return nil, entities.ErrCompanyNotFound
	}
	row := *r.row
	if patch.Location.Set {
		row.Location = nil
		if patch.Location.Valid {
			value := patch.Location.Value
			row.Location = &value
		}
	}
	row.UpdatedAt = cas.Add(time.Microsecond)
	r.row = &row
	r.writes++
	first := r.writes == 1
	r.mu.Unlock()
	if first {
		close(r.firstCommitted)
		select {
		case <-r.resumeFirst:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	// Return this call's captured row, not the current row after resuming.
	return &row, nil
}

func TestCompanyPatchResponseKeepsWrittenLocationAndToken(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	company, err := entities.NewCompany("Acme SA de CV", "AAA010101AAA", "tech", entities.CompanyProfile{Location: &domain.Value{Country: "US"}})
	if err != nil {
		t.Fatal(err)
	}
	company.UpdatedAt = time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	actor := uuid.New()
	repo := &interleavedCompanyPatchRepository{row: company, firstCommitted: make(chan struct{}), resumeFirst: make(chan struct{})}
	var release sync.Once
	resume := func() { release.Do(func() { close(repo.resumeFirst) }) }
	defer resume()
	handler := NewCompanyHandler(usecases.NewCompanyService(repo, companyCatalog{}))
	router := chi.NewRouter()
	router.Patch("/me/company", handler.updateCompany)
	patch := func(body string, token time.Time) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPatch, "/me/company", strings.NewReader(body))
		req.Header.Set("If-Unmodified-Since", token.Format(time.RFC3339Nano))
		req = req.WithContext(security.ContextWithCompanyContext(ctx, security.CompanyContext{CompanyID: company.ID, UserID: actor}))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		done <- patch(`{"location":{"country":"MX","state":"14","municipality":"14039"}}`, company.UpdatedAt)
	}()
	select {
	case <-repo.firstCommitted:
	case <-ctx.Done():
		t.Fatal("first PATCH did not commit", ctx.Err())
	}
	firstWritten, err := repo.GetCompanyForUpdate(ctx, company.ID)
	if err != nil {
		t.Fatal(err)
	}
	second := patch(`{"location":{"country":"US"}}`, firstWritten.UpdatedAt)
	if second.Code != http.StatusOK {
		t.Fatalf("second PATCH: %d %s", second.Code, second.Body.String())
	}
	secondWritten, err := repo.GetCompanyForUpdate(ctx, company.ID)
	if err != nil {
		t.Fatal(err)
	}
	resume()
	var first *httptest.ResponseRecorder
	select {
	case first = <-done:
	case <-ctx.Done():
		t.Fatal("first PATCH did not resume", ctx.Err())
	}
	if first.Code != http.StatusOK {
		t.Fatalf("first PATCH: %d %s", first.Code, first.Body.String())
	}
	read := func(rec *httptest.ResponseRecorder) (time.Time, string) {
		t.Helper()
		var body struct {
			UpdatedAt time.Time `json:"updated_at"`
			Location  struct {
				Country struct {
					ID string `json:"id"`
				} `json:"country"`
			} `json:"location"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body.UpdatedAt, body.Location.Country.ID
	}
	secondToken, secondCountry := read(second)
	if !secondToken.Equal(secondWritten.UpdatedAt) || secondCountry != secondWritten.Location.Country {
		t.Errorf("second PATCH mixed row states: %s", second.Body.String())
	}
	firstToken, firstCountry := read(first)
	if !firstToken.Equal(firstWritten.UpdatedAt) || firstCountry != firstWritten.Location.Country {
		t.Errorf("first PATCH mixed its location with the second PATCH token: got=%s want country=%s updated_at=%s", first.Body.String(), firstWritten.Location.Country, firstWritten.UpdatedAt.Format(time.RFC3339Nano))
	}
	retry := patch(`{}`, firstToken)
	if retry.Code != http.StatusConflict {
		t.Errorf("first response token must be stale after second PATCH: got %d %s", retry.Code, retry.Body.String())
	}
	repo.mu.Lock()
	writes := repo.writes
	repo.mu.Unlock()
	if writes != 2 {
		t.Errorf("stale retry wrote company: writes=%d", writes)
	}
}
