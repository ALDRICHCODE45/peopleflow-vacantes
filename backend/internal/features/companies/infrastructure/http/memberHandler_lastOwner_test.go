package http

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

// Actor identity is deliberately irrelevant to the last-owner check: both self
// and other targets must surface the repository's atomic decision unchanged.
func TestMemberLastOwnerHTTP(t *testing.T) {
	for _, method := range []string{http.MethodPatch, http.MethodDelete} {
		for _, self := range []bool{true, false} {
			t.Run(fmt.Sprintf("%s/self=%t", method, self), func(t *testing.T) {
				memberID, userID := uuid.New(), uuid.New()
				targetID := memberID
				if !self {
					targetID = uuid.New()
				}
				members := &stubMemberRepositoryForHandler{updateErr: fmt.Errorf("guard: %w", entities.ErrLastOwner), removeErr: entities.ErrLastOwner}
				service := newMemberHandlerService(members, &stubUserRepositoryForHandler{}, &stubMemberCompanyRepositoryForHandler{})
				router := newMemberRouter(t, service, "", identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: userID, Role: valueobjects.OwnerRole})
				response := doReq(t, router, method, "/me/company/members/"+targetID.String(), `{"role":"recruiter"}`)
				memberAssertCatalogEnvelope(t, response, http.StatusConflict, httpjson.CodeLastOwner)
				assertErrorMessage(t, response, "company must retain at least one owner")
			})
		}
	}
}
