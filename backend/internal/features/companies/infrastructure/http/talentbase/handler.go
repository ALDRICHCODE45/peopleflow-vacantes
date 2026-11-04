// Package talentbase exposes the talent base visibility setting over HTTP.
package talentbase

import (
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/talentbase"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

const maxBodyBytes int64 = 1 << 20

var etagPattern = regexp.MustCompile(`^"([1-9][0-9]*)"$`)

type Handler struct{ service *app.Service }

func NewHandler(service *app.Service) *Handler { return &Handler{service: service} }

func etag(version int64) string { return `"` + strconv.FormatInt(version, 10) + `"` }

func companyContext(w http.ResponseWriter, r *http.Request) (security.CompanyContext, bool) {
	cc, ok := security.CompanyContextFromContext(r.Context())
	if !ok || cc.CompanyID == uuid.Nil || cc.UserID == uuid.Nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeUnauthenticated))
		return cc, false
	}
	return cc, true
}

// internalError writes the catalog 500; the request-completion record already
// carries its code class, so nothing else is logged here.
func internalError(w http.ResponseWriter) {
	httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))
}

// Get serves any company member, so a recruiter can see why they lack access.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
	if !ok {
		return
	}
	doc, err := h.service.Get(r.Context(), cc.CompanyID)
	if err != nil {
		internalError(w)
		return
	}
	w.Header().Set("ETag", etag(doc.Version))
	httpjson.WriteJSON(w, http.StatusOK, doc)
}

// Put replaces the setting; the owner gate runs in the router.
func (h *Handler) Put(w http.ResponseWriter, r *http.Request) {
	cc, ok := companyContext(w, r)
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
	doc, err := h.service.Replace(r.Context(), cc.CompanyID, cc.UserID, version, body)
	var invalid *app.InvalidFields
	var rule *app.RuleError
	switch {
	case err == nil:
		w.Header().Set("ETag", etag(doc.Version))
		httpjson.WriteJSON(w, http.StatusOK, doc)
	case errors.Is(err, app.ErrInvalidRequest):
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
	case errors.As(err, &invalid):
		fields := make([]httpjson.ValidationField, 0, len(invalid.Fields))
		for _, f := range invalid.Fields {
			fields = append(fields, httpjson.ValidationField{Field: f.Field, Code: f.Code})
		}
		httpjson.WriteValidationError(w, fields)
	case errors.Is(err, app.ErrVersionConflict):
		w.Header().Set("ETag", etag(doc.Version))
		httpjson.WriteTalentBaseVersionConflict(w, doc)
	case errors.As(err, &rule):
		code, fieldCode := ruleCodes(rule.Rule)
		httpjson.WriteTalentBaseRuleError(w, code, httpjson.ValidationField{Field: rule.Field, Code: fieldCode})
	default:
		internalError(w)
	}
}

func ruleCodes(rule app.Rule) (httpjson.Code, string) {
	switch rule {
	case app.RuleUsersNotApplicable:
		return httpjson.CodeTalentBaseUsersNotApplicable, app.FieldNotApplicable
	case app.RuleViewerNotMember:
		return httpjson.CodeTalentBaseViewerNotMember, app.FieldNotMember
	case app.RuleViewerIsOwner:
		return httpjson.CodeTalentBaseViewerIsOwner, app.FieldIsOwner
	}
	return httpjson.CodeInternalError, ""
}
