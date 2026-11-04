package talentbase

import (
	"net/http"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/talentbase"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

// Gate answers 403 talent_base_restricted to a member without access to the
// talent base, before the wrapped handler looks anything up. It runs after the
// company role gate, which supplies the CompanyContext.
func Gate(access app.Access) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cc, ok := companyContext(w, r)
			if !ok {
				return
			}
			allowed, err := access.CanView(r.Context(), cc.CompanyID, cc.UserID, cc.Role.String())
			if err != nil {
				internalError(w)
				return
			}
			if !allowed {
				httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeTalentBaseRestricted))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
