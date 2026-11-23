package http

import (
	"errors"
	"net/http"
	"net/url"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftlist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/stakeholdervacancies"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

// StakeholderVacanciesHandler serves GET /v2/me/company/stakeholder/vacancies (docs/contracts/placement-vacancy-documents-v1.md,
// P7c). The route sits behind the owner + stakeholder gate; identity comes only from the session company context and the store
// re-checks it transactionally. The page parameters, the cursor and the error answers are the job-drafts list's.
type StakeholderVacanciesHandler struct {
	lister stakeholdervacancies.Lister
}

// NewStakeholderVacanciesHandler builds the handler. Construction performs no IO.
func NewStakeholderVacanciesHandler(lister stakeholdervacancies.Lister) *StakeholderVacanciesHandler {
	return &StakeholderVacanciesHandler{lister: lister}
}

// stakeholderVacancyRow is the wire row. Every key is always present; the lifecycle fields, the coverage and the close reason are null
// where the vacancy has none.
type stakeholderVacancyRow struct {
	ID             string             `json:"id"`
	Title          *string            `json:"title"`
	Publication    *string            `json:"publication"`
	Process        *string            `json:"process"`
	Kind           string             `json:"kind"`
	Visibility     *string            `json:"visibility"`
	CloseReason    *string            `json:"close_reason"`
	Coverage       *draftListCoverage `json:"coverage"`
	DocumentsCount int64              `json:"documents_count"`
}

type stakeholderVacancyPage struct {
	Items      []stakeholderVacancyRow `json:"items"`
	NextCursor *string                 `json:"next_cursor"`
}

// List serves GET /v2/me/company/stakeholder/vacancies?limit=&cursor=. Each parameter appears at most once and unknown parameters
// (there are no filters in v1) are ignored, but a query string that does not parse is rejected. A cursor issued for a
// root_process_id filter of the job-drafts list answers invalid_cursor; every other bad input invalid_request.
func (h *StakeholderVacanciesHandler) List(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	req, err := parseStakeholderVacanciesRequest(values, draftlist.Scope{CompanyID: cc.CompanyID, ActorID: cc.UserID})
	if errors.Is(err, draftlist.ErrCursorFilter) {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidCursor))
		return
	}
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	page, err := h.lister.ListStakeholderVacancies(r.Context(), cc.CompanyID, cc.UserID, req)
	if err != nil {
		writeDraftError(w, err)
		return
	}
	out := stakeholderVacancyPage{Items: make([]stakeholderVacancyRow, 0, len(page.Items))}
	for _, row := range page.Items {
		wire := stakeholderVacancyRow{
			ID: row.ID.String(), Title: row.Title, Publication: row.Publication, Process: row.Process, Kind: row.Kind,
			Visibility: row.Visibility, CloseReason: row.CloseReason, DocumentsCount: row.DocumentsCount,
		}
		if row.Coverage != nil {
			wire.Coverage = &draftListCoverage{Covered: row.Coverage.Covered, Required: row.Coverage.Required}
		}
		out.Items = append(out.Items, wire)
	}
	if page.NextCursor != "" {
		next := page.NextCursor
		out.NextCursor = &next
	}
	httpjson.WriteJSON(w, http.StatusOK, out)
}

// parseStakeholderVacanciesRequest validates limit and cursor against the session scope; the cursor is checked last. There is no
// root_process_id: a cursor that carries one was issued for a filtered job-drafts list and is refused as another filter's.
func parseStakeholderVacanciesRequest(values url.Values, scope draftlist.Scope) (stakeholdervacancies.Request, error) {
	single := func(key string) (string, bool, error) {
		v, present := values[key]
		if !present {
			return "", false, nil
		}
		if len(v) != 1 {
			return "", true, draftlist.ErrInvalidRequest
		}
		return v[0], true, nil
	}
	rawLimit, _, err := single("limit")
	if err != nil {
		return stakeholdervacancies.Request{}, err
	}
	limit, err := draftlist.ParseLimit(rawLimit)
	if err != nil {
		return stakeholdervacancies.Request{}, err
	}
	req := stakeholdervacancies.Request{Limit: limit}
	token, present, err := single("cursor")
	if err != nil {
		return stakeholdervacancies.Request{}, err
	}
	if present {
		cursor, err := draftlist.DecodeCursor(token, scope)
		if err != nil {
			return stakeholdervacancies.Request{}, err
		}
		req.After = &cursor
	}
	return req, nil
}
