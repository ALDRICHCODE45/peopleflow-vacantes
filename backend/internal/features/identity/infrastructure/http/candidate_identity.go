package http

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

const maxJSONBodyBytes int64 = 1_048_576

type CandidateIdentityHandler struct{ service *usecases.CandidateIdentity }

func NewCandidateIdentityHandler(service *usecases.CandidateIdentity) *CandidateIdentityHandler {
	return &CandidateIdentityHandler{service: service}
}

type meUser struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	FullName string `json:"full_name"`
}
type meResponse struct {
	Role *string `json:"role"`
	User *meUser `json:"user"`
}

func writeMe(w http.ResponseWriter, status int, u *entities.User) {
	out := meResponse{}
	if u != nil {
		role := u.UserType.String()
		out.Role = &role
		out.User = &meUser{ID: u.ID.String(), Email: u.Email.Value(), FullName: u.FullName.Value()}
	}
	httpjson.WriteJSON(w, status, out)
}

// NoStore also wraps authentication/authorization failures at the router.
func NoStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func (h *CandidateIdentityHandler) Me(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	subject := security.ClaimsFromContext(r.Context()).Subject
	if subject == "" {
		respondUnauthorized(w, "missing authenticated subject")
		return
	}
	if h == nil || h.service == nil {
		respondServerError(w)
		return
	}
	user, err := h.service.Me(r.Context(), subject)
	if err != nil {
		respondServerError(w)
		return
	}
	writeMe(w, http.StatusOK, user)
}
func (h *CandidateIdentityHandler) CreateCandidateAccount(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	subject := security.ClaimsFromContext(r.Context()).Subject
	if subject == "" {
		respondUnauthorized(w, "missing authenticated subject")
		return
	}
	var body json.RawMessage
	if def := httpjson.DecodeJSON(w, r, &body, maxJSONBodyBytes); def != nil {
		httpjson.WriteCatalogError(w, *def)
		return
	}
	name, err := decodeCandidateName(body)
	if err != nil {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInvalidRequest))
		return
	}
	if h == nil || h.service == nil {
		respondServerError(w)
		return
	}
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	user, created, err := h.service.Onboard(r.Context(), subject, token, name)
	if err != nil {
		code := httpjson.CodeInternalError
		switch {
		case errors.Is(err, usecases.ErrInvalidCandidateName):
			code = httpjson.CodeValidationError
		case errors.Is(err, usecases.ErrAccountExists):
			code = httpjson.CodeAccountExists
		case errors.Is(err, entities.ErrEmailTaken):
			code = httpjson.CodeEmailInUse
		case errors.Is(err, usecases.ErrEmailNotVerified):
			code = httpjson.CodeEmailNotVerified
		case errors.Is(err, usecases.ErrIdentityUnavailable):
			code = httpjson.CodeIdentityUnavailable
		}
		httpjson.WriteCatalogError(w, httpjson.Resolve(code))
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeMe(w, status, user)
}

func decodeCandidateName(body []byte) (string, error) {
	invalid := errors.New("invalid request")
	dec := json.NewDecoder(bytes.NewReader(body))
	open, err := dec.Token()
	if err != nil || open != json.Delim('{') {
		return "", invalid
	}
	seen := false
	var name string
	for dec.More() {
		key, err := dec.Token()
		if err != nil || key != "full_name" || seen {
			return "", invalid
		}
		seen = true
		if err := dec.Decode(&name); err != nil {
			return "", invalid
		}
	}
	if _, err := dec.Token(); err != nil {
		return "", invalid
	}
	var trailing any
	if dec.Decode(&trailing) != io.EOF {
		return "", invalid
	}
	return name, nil
}
