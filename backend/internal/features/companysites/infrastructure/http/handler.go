package http

import (
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

const maxBodyBytes int64 = 1 << 20

var etagPattern = regexp.MustCompile(`^"([1-9][0-9]*)"$`)

type Handler struct {
	publicReader  app.PublicReader
	publicCompany app.ReadPublicCompany
	mediaStore    app.MediaStore
	storage       app.Storage
	store         app.Store
	decode        app.Decode
	validator     *app.Validator
}

func New(store app.Store, decode app.Decode, validator *app.Validator) *Handler {
	return &Handler{store: store, decode: decode, validator: validator}
}
func company(w http.ResponseWriter, r *http.Request) (security.CompanyContext, bool) {
	cc, ok := security.CompanyContextFromContext(r.Context())
	if !ok || cc.CompanyID == uuid.Nil || cc.UserID == uuid.Nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return cc, false
	}
	return cc, true
}
func etag(version int64) string { return `"` + strconv.FormatInt(version, 10) + `"` }
func writeCurrent(w http.ResponseWriter, c app.Current) {
	w.Header().Set("ETag", etag(c.DraftVersion))
	httpjson.WriteJSON(w, http.StatusOK, c)
}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	cc, ok := company(w, r)
	if !ok {
		return
	}
	c, err := h.store.Get(r.Context(), cc.CompanyID, cc.UserID)
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	writeCurrent(w, c)
}
func validation(w http.ResponseWriter, fields []app.Field) {
	out := make([]httpjson.ValidationField, 0, len(fields))
	for _, f := range fields {
		out = append(out, httpjson.ValidationField{Field: f.Field, Code: f.Code})
	}
	httpjson.WriteValidationError(w, out)
}
func (h *Handler) Put(w http.ResponseWriter, r *http.Request) {
	cc, ok := company(w, r)
	if !ok {
		return
	}
	header := r.Header.Get("If-Match")
	if strings.TrimSpace(header) == "" {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodePreconditionRequired))
		return
	}
	match := etagPattern.FindStringSubmatch(header)
	if match == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	version, err := strconv.ParseInt(match[1], 10, 64)
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodePayloadTooLarge))
		} else {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		}
		return
	}
	value, err := h.decode(body)
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	doc, fields := h.validator.ValidateDocument(value)
	if len(fields) > 0 {
		validation(w, fields)
		return
	}
	if slug, ok := doc.Value["slug"].(string); ok && app.SlugReason(slug) == "reserved" {
		httpjson.WriteSiteSlugError(w, httpjson.CodeSlugReserved)
		return
	}
	current, err := h.store.Save(r.Context(), cc.CompanyID, cc.UserID, version, doc)
	var invalid *app.InvalidFields
	switch {
	case errors.Is(err, app.ErrVersionConflict):
		w.Header().Set("ETag", etag(current.DraftVersion))
		httpjson.WriteSiteVersionConflict(w, current)
	case errors.Is(err, app.ErrSlugTaken):
		httpjson.WriteSiteSlugError(w, httpjson.CodeSlugTaken)
	case errors.As(err, &invalid):
		validation(w, invalid.Fields)
	case err != nil:
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
	default:
		writeCurrent(w, current)
	}
}
func (h *Handler) Publish(w http.ResponseWriter, r *http.Request) {
	cc, ok := company(w, r)
	if !ok {
		return
	}
	header := r.Header.Get("If-Match")
	if strings.TrimSpace(header) == "" {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodePreconditionRequired))
		return
	}
	match := etagPattern.FindStringSubmatch(header)
	if match == nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	version, err := strconv.ParseInt(match[1], 10, 64)
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	current, err := h.store.Publish(r.Context(), cc.CompanyID, cc.UserID, version)
	var blocked *app.PublishBlocked
	switch {
	case errors.Is(err, app.ErrVersionConflict):
		w.Header().Set("ETag", etag(current.DraftVersion))
		httpjson.WriteSiteVersionConflict(w, current)
	case errors.As(err, &blocked):
		httpjson.WriteSitePublishBlocked(w, blocked.Issues)
	case errors.Is(err, app.ErrSlugTaken):
		httpjson.WriteSiteSlugError(w, httpjson.CodeSlugTaken)
	case err != nil:
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
	default:
		writeCurrent(w, current)
	}
}
func (h *Handler) Unpublish(w http.ResponseWriter, r *http.Request) {
	cc, ok := company(w, r)
	if !ok {
		return
	}
	current, err := h.store.Unpublish(r.Context(), cc.CompanyID, cc.UserID)
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
		return
	}
	writeCurrent(w, current)
}

func (h *Handler) SlugAvailability(w http.ResponseWriter, r *http.Request) {
	cc, ok := company(w, r)
	if !ok {
		return
	}
	slug := strings.TrimSpace(r.URL.Query().Get("slug"))
	reason := app.SlugReason(slug)
	available := false
	if reason == "" {
		var err error
		available, err = h.store.SlugAvailable(r.Context(), cc.CompanyID, slug)
		if err != nil {
			httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
			return
		}
		if !available {
			reason = "taken"
		}
	}
	var reasonValue *string
	if reason != "" {
		reasonValue = &reason
	}
	httpjson.WriteJSON(w, http.StatusOK, struct {
		Slug      string  `json:"slug"`
		Available bool    `json:"available"`
		Reason    *string `json:"reason"`
	}{slug, available, reasonValue})
}
