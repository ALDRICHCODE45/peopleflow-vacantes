package http

import (
	"errors"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

// RequireCandidateRole checks the live database role on every request. Token
// groups and client id are never role authority. Company gates stay unchanged.
func RequireCandidateRole(users repositories.UserRepository) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			sub := security.ClaimsFromContext(r.Context()).Subject
			if sub == "" {
				respondUnauthorized(w, "missing authenticated subject")
				return
			}
			if users == nil {
				respondServerError(w)
				return
			}
			user, err := users.GetByCognitoSub(r.Context(), sub)
			if errors.Is(err, entities.ErrUserNotFound) || (err == nil && (user == nil || user.DeletedAt != nil)) {
				httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeAccountRequired))
				return
			}
			if err != nil {
				respondServerError(w)
				return
			}
			if user.UserType != valueobjects.UserCandidate {
				httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeWrongRole))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
