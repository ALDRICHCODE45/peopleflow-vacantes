package http

import (
	"net/http"
	"net/url"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

// Overview is GET /v2/me/company/job-drafts/{id}/document-overview?participation_id= (read gate: owner, recruiter, stakeholder;
// the store re-checks). The documents and links of the vacancy and of every participation of it as one table, plus the vacancy
// header and the participations; it reads only the database, so like the lists it never raises document_storage_unavailable.
// `participation_id`, when present, must be one canonical uuid (400 invalid_request otherwise, before anything is read) and a
// participation of the vacancy (404 not_found otherwise, after the vacancy gates). Unknown parameters are ignored.
func (h *Handler) Overview(w http.ResponseWriter, r *http.Request) {
	cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
	if !ok || h == nil || h.reader == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	t, ok := target(w, r)
	if !ok {
		return
	}
	filter, ok := overviewFilter(w, r)
	if !ok {
		return
	}
	overview, err := h.reader.Overview(r.Context(), cc.CompanyID, cc.UserID, t.DraftID, filter)
	if err != nil {
		writeError(w, err)
		return
	}
	// Every array is always present, never null.
	if overview.Items == nil {
		overview.Items = []documents.OverviewItem{}
	}
	if overview.Links == nil {
		overview.Links = []documents.OverviewLink{}
	}
	if overview.Participations == nil {
		overview.Participations = []documents.OverviewParticipation{}
	}
	httpjson.WriteJSON(w, http.StatusOK, overview)
}

// overviewFilter reads the optional `participation_id`: absent is no filter; present means exactly one value that is a
// canonical (36 characters, dashed) uuid. A query string that does not parse is as malformed as a bad value.
func overviewFilter(w http.ResponseWriter, r *http.Request) (*uuid.UUID, bool) {
	invalid := func() (*uuid.UUID, bool) {
		httpjson.WriteCatalogError(w, httpjson.SafeMessage(httpjson.Resolve(httpjson.CodeInvalidRequest), "invalid participation id"))
		return nil, false
	}
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return invalid()
	}
	raw, present := values["participation_id"]
	if !present {
		return nil, true
	}
	if len(raw) != 1 || len(raw[0]) != 36 {
		return invalid()
	}
	id, err := uuid.Parse(raw[0])
	if err != nil {
		return invalid()
	}
	return &id, true
}
