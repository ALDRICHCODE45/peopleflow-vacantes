// Package http exposes anonymous reference lookups; no postal bulk route exists.
package http

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
)

func RegisterRoutes(r chi.Router, reader application.Reader) {
	h := &handler{reader: reader}
	r.Get("/v2/geo/countries", h.countries)
	r.Get("/v2/geo/countries/{country}/states", h.states)
	r.Get("/v2/geo/countries/{country}/states/{state}/municipalities", h.municipalities)
	r.Get("/v2/geo/countries/{country}/postal-codes/{cp}", h.postal)
}

type handler struct{ reader application.Reader }

func rejectQuery(w http.ResponseWriter, r *http.Request) bool {
	// There are no supported parameters, including empty or malformed ones.
	if r.URL.RawQuery != "" {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return true
	}
	return false
}
func (h *handler) country(w http.ResponseWriter, r *http.Request) bool {
	if chi.URLParam(r, "country") != "MX" {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeCountryNotFound))
		return false
	}
	exists, err := h.reader.CountryExists(r.Context(), "MX")
	if err != nil {
		unexpected(w, r)
		return false
	}
	if !exists {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeCountryNotFound))
		return false
	}
	return true
}
func (h *handler) countries(w http.ResponseWriter, r *http.Request) {
	if rejectQuery(w, r) {
		return
	}
	values, err := h.reader.Countries(r.Context())
	if err != nil {
		unexpected(w, r)
		return
	}
	h.respond(w, r, items(values))
}
func (h *handler) states(w http.ResponseWriter, r *http.Request) {
	if rejectQuery(w, r) || !h.country(w, r) {
		return
	}
	values, err := h.reader.States(r.Context(), "MX")
	if err != nil {
		unexpected(w, r)
		return
	}
	h.respond(w, r, items(values))
}
func (h *handler) municipalities(w http.ResponseWriter, r *http.Request) {
	if rejectQuery(w, r) || !h.country(w, r) {
		return
	}
	state := chi.URLParam(r, "state")
	exists, err := h.reader.StateExists(r.Context(), "MX", state)
	if err != nil {
		unexpected(w, r)
		return
	}
	if !exists {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeStateNotFound))
		return
	}
	values, err := h.reader.Municipalities(r.Context(), "MX", state)
	if err != nil {
		unexpected(w, r)
		return
	}
	h.respond(w, r, items(values))
}
func (h *handler) postal(w http.ResponseWriter, r *http.Request) {
	if rejectQuery(w, r) || !h.country(w, r) {
		return
	}
	cp := chi.URLParam(r, "cp")
	if !application.ValidPostalCode(cp) {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidPostalCode))
		return
	}
	matches, err := h.reader.PostalMatches(r.Context(), "MX", cp)
	if err != nil {
		unexpected(w, r)
		return
	}
	if len(matches) == 0 {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodePostalCodeNotFound))
		return
	}
	out := postalResponse{PostalCode: cp, Matches: make([]postalMatchResponse, 0, len(matches))}
	for _, match := range matches {
		out.Matches = append(out.Matches, postalMatchResponse{State: item(match.State), Municipality: item(match.Municipality)})
	}
	h.respond(w, r, out)
}
func (h *handler) respond(w http.ResponseWriter, r *http.Request, body any) {
	version, err := h.reader.Version(r.Context())
	if err != nil {
		unexpected(w, r)
		return
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		unexpected(w, r)
		return
	}
	// Include the representation as well as the import generation: concurrent
	// manual imports cannot attach the same strong validator to different bytes.
	hash := sha256.Sum256(append([]byte(version+"\x00"+r.URL.Path+"\x00"), encoded...))
	tag := `"` + hex.EncodeToString(hash[:]) + `"`
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("ETag", tag)
	for _, header := range r.Header.Values("If-None-Match") {
		for _, candidate := range strings.Split(header, ",") {
			candidate = strings.TrimSpace(candidate)
			if candidate == "*" || strings.TrimPrefix(candidate, "W/") == tag {
				w.WriteHeader(http.StatusNotModified)
				return
			}
		}
	}
	httpjson.WriteJSON(w, http.StatusOK, body)
}
func unexpected(w http.ResponseWriter, r *http.Request) {
	attrs := []any{"code_class", httpjson.CodeInternalError}
	if id := chimw.GetReqID(r.Context()); id != "" {
		attrs = append(attrs, "request_id", id)
	}
	slog.Error("geo catalog lookup failed", attrs...)
	httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
}
