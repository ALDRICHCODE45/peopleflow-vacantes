package http

import (
	"errors"
	"io"
	"net/http"
	"net/url"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/requesters"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

// maxRequesterBodyBytes bounds the POST body. A 160-codepoint name is at most
// 640 bytes raw, or about 2 KiB fully \u-escaped, so 8 KiB never rejects a
// valid request.
const maxRequesterBodyBytes = 8192

// RequesterHandler is the requester catalog transport (contract §7). Identity
// comes only from the session company context; the store re-checks it
// transactionally.
type RequesterHandler struct {
	store requesters.Store
}

// RequesterHandlers exposes the handler functions for router wiring.
type RequesterHandlers struct {
	ListRequesters  http.HandlerFunc
	CreateRequester http.HandlerFunc
}

// NewRequesterHandler builds the handler. Construction performs no IO.
func NewRequesterHandler(store requesters.Store) *RequesterHandler {
	return &RequesterHandler{store: store}
}

// RequesterHandlers returns the list/create handler functions.
func (h *RequesterHandler) RequesterHandlers() RequesterHandlers {
	return RequesterHandlers{ListRequesters: h.list, CreateRequester: h.create}
}

type requesterItem struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	Name string `json:"name"`
}

type requesterPage struct {
	Items      []requesterItem `json:"items"`
	NextCursor *string         `json:"next_cursor"`
}

func toRequesterItem(e requesters.Entry) requesterItem {
	return requesterItem{ID: e.ID.String(), Kind: e.Kind, Name: e.Name}
}

// list serves GET /me/company/requesters?kind=&q=&limit=&cursor=. Every
// parameter appears at most once; kind is required.
func (h *RequesterHandler) list(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	// url.ParseQuery, unlike r.URL.Query, reports malformed escapes instead of
	// silently dropping the pair (which would turn ?cursor=%zz into page one).
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	req, err := parseListRequest(values, cc.CompanyID)
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	page, err := h.store.ListRequesters(r.Context(), cc.CompanyID, cc.UserID, req)
	if err != nil {
		writeRequesterError(w, err)
		return
	}
	out := requesterPage{Items: make([]requesterItem, 0, len(page.Items))}
	for _, e := range page.Items {
		out.Items = append(out.Items, toRequesterItem(e))
	}
	if page.NextCursor != "" {
		next := page.NextCursor
		out.NextCursor = &next
	}
	httpjson.WriteJSON(w, http.StatusOK, out)
}

// parseListRequest validates the query string against the session scope.
func parseListRequest(values url.Values, companyID uuid.UUID) (requesters.ListRequest, error) {
	single := func(key string) (string, bool, error) {
		v, present := values[key]
		if !present {
			return "", false, nil
		}
		if len(v) != 1 {
			return "", true, requesters.ErrInvalidRequest
		}
		return v[0], true, nil
	}

	rawKind, _, err := single("kind")
	if err != nil {
		return requesters.ListRequest{}, err
	}
	kind, err := requesters.ParseKind(rawKind)
	if err != nil {
		return requesters.ListRequest{}, err
	}
	rawQ, _, err := single("q")
	if err != nil {
		return requesters.ListRequest{}, err
	}
	query, err := requesters.NormalizeQuery(rawQ)
	if err != nil {
		return requesters.ListRequest{}, err
	}
	rawLimit, _, err := single("limit")
	if err != nil {
		return requesters.ListRequest{}, err
	}
	limit, err := requesters.ParseLimit(rawLimit)
	if err != nil {
		return requesters.ListRequest{}, err
	}
	req := requesters.ListRequest{Kind: kind, Query: query, Limit: limit}

	token, present, err := single("cursor")
	if err != nil {
		return requesters.ListRequest{}, err
	}
	if present {
		cursor, err := requesters.DecodeCursor(token, requesters.Scope{CompanyID: companyID, Kind: kind, QNormalized: query.Normalized})
		if err != nil {
			return requesters.ListRequest{}, err
		}
		req.After = &cursor
	}
	return req, nil
}

// create serves POST /me/company/requesters with body exactly {kind, name}.
func (h *RequesterHandler) create(w http.ResponseWriter, r *http.Request) {
	cc, ok := requireCompanyContext(w, r)
	if !ok {
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequesterBodyBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodePayloadTooLarge))
			return
		}
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	kind, rawName, ok := decodeCreateRequester(body)
	if !ok {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	name, err := valueobjects.NewRequesterName(rawName)
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeValidationError))
		return
	}
	entry, err := h.store.CreateRequester(r.Context(), cc.CompanyID, cc.UserID, kind, name)
	if err != nil {
		writeRequesterError(w, err)
		return
	}
	httpjson.WriteJSON(w, http.StatusCreated, toRequesterItem(entry))
}

// decodeCreateRequester accepts exactly one JSON object with string "kind"
// and "name" and nothing else. The strict decoder rejects duplicate keys,
// invalid UTF-8 and trailing data that encoding/json would tolerate.
func decodeCreateRequester(body []byte) (kind, name string, ok bool) {
	doc, err := draftjson.Decode(body)
	if err != nil {
		return "", "", false
	}
	object, isObject := doc.(map[string]any)
	if !isObject || len(object) != 2 {
		return "", "", false
	}
	rawKind, kindOK := object["kind"].(string)
	name, nameOK := object["name"].(string)
	if !kindOK || !nameOK {
		return "", "", false
	}
	kind, err = requesters.ParseKind(rawKind)
	if err != nil {
		return "", "", false
	}
	return kind, name, true
}

// writeRequesterError projects store errors: the typed duplicate, then the
// shared draft gate sentinels (fail-closed 500 for anything else).
func writeRequesterError(w http.ResponseWriter, err error) {
	var dup *requesters.AlreadyExistsError
	if errors.As(err, &dup) {
		httpjson.WriteRequesterAlreadyExists(w, httpjson.RequesterRef{
			ID:   dup.Existing.ID.String(),
			Kind: dup.Existing.Kind,
			Name: dup.Existing.Name,
		})
		return
	}
	writeDraftError(w, err)
}
