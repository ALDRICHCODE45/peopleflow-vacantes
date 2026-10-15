package http

import (
	"net/http"
	"net/url"
	"strconv"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftlist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

// draftListTimestampLayout matches the draft read envelope timestamps.
const draftListTimestampLayout = "2006-01-02T15:04:05.000000Z"

// DraftListHandler serves GET /v2/me/company/job-drafts. Identity comes only
// from the session company context; the store re-checks it transactionally
// and applies the owner-or-principal visibility rule.
type DraftListHandler struct {
	lister draftlist.Lister
}

// NewDraftListHandler builds the handler. Construction performs no IO.
func NewDraftListHandler(lister draftlist.Lister) *DraftListHandler {
	return &DraftListHandler{lister: lister}
}

type draftListRequester struct {
	Kind string  `json:"kind"`
	ID   *string `json:"id"`
	Name *string `json:"name"`
}

type draftListPrincipal struct {
	ID   string  `json:"id"`
	Name *string `json:"name"`
}

type draftListItem struct {
	ID                 string              `json:"id"`
	Title              *string             `json:"title"`
	Requester          *draftListRequester `json:"requester"`
	PrincipalRecruiter draftListPrincipal  `json:"principal_recruiter"`
	Version            string              `json:"version"`
	CreatedAt          string              `json:"created_at"`
	UpdatedAt          string              `json:"updated_at"`
}

type draftListPage struct {
	Items      []draftListItem `json:"items"`
	NextCursor *string         `json:"next_cursor"`
}

// ListDrafts serves GET /v2/me/company/job-drafts?limit=&cursor=. Each
// parameter appears at most once; unknown parameters are ignored.
func (h *DraftListHandler) ListDrafts(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	req, err := parseDraftListRequest(r.URL.Query(), draftlist.Scope{CompanyID: cc.CompanyID, ActorID: cc.UserID})
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	page, err := h.lister.ListV2(r.Context(), cc.CompanyID, cc.UserID, req)
	if err != nil {
		writeDraftError(w, err)
		return
	}
	out := draftListPage{Items: make([]draftListItem, 0, len(page.Items))}
	for _, item := range page.Items {
		out.Items = append(out.Items, toDraftListItem(item))
	}
	if page.NextCursor != "" {
		next := page.NextCursor
		out.NextCursor = &next
	}
	httpjson.WriteJSON(w, http.StatusOK, out)
}

func toDraftListItem(item draftlist.Item) draftListItem {
	out := draftListItem{
		ID:                 item.ID.String(),
		Title:              item.Title,
		PrincipalRecruiter: draftListPrincipal{ID: item.Principal.ID.String(), Name: item.Principal.Name},
		Version:            strconv.FormatInt(item.Version, 10),
		CreatedAt:          item.CreatedAt.UTC().Format(draftListTimestampLayout),
		UpdatedAt:          item.UpdatedAt.UTC().Format(draftListTimestampLayout),
	}
	if item.Requester != nil {
		out.Requester = &draftListRequester{Kind: item.Requester.Kind, ID: item.Requester.ID, Name: item.Requester.Name}
	}
	return out
}

// parseDraftListRequest validates limit and cursor against the session scope.
func parseDraftListRequest(values url.Values, scope draftlist.Scope) (draftlist.Request, error) {
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
		return draftlist.Request{}, err
	}
	limit, err := draftlist.ParseLimit(rawLimit)
	if err != nil {
		return draftlist.Request{}, err
	}
	req := draftlist.Request{Limit: limit}

	token, present, err := single("cursor")
	if err != nil {
		return draftlist.Request{}, err
	}
	if present {
		cursor, err := draftlist.DecodeCursor(token, scope)
		if err != nil {
			return draftlist.Request{}, err
		}
		req.After = &cursor
	}
	return req, nil
}
