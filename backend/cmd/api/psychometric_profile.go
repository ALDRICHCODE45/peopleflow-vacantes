package main

import (
	"errors"
	"net/http"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/draftstore"
	profilehttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/infrastructure/http"
	profilepostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Compile-time pin for the jobs-owned adapter's complete transaction port.
var _ profilepostgres.JobContext = (*draftstore.Store)(nil)
var _ profilepostgres.InvitationJobContext = (*draftstore.Store)(nil)

func newPsychometricInvitationsHandler(pool *pgxpool.Pool, jobs *draftstore.Store) *profilehttp.InvitationsHandler {
	return profilehttp.NewInvitationsHandler(profilepostgres.NewInvitationsStore(pool, jobs), writeProfileContextError)
}

// Cross-feature composition stays here, not in either feature package.
func newPsychometricProfileHandler(pool *pgxpool.Pool, jobs *draftstore.Store) *profilehttp.Handler {
	return profilehttp.NewHandler(profilepostgres.NewStore(pool, jobs), writeProfileContextError)
}
func writeProfileContextError(w http.ResponseWriter, err error) {
	var finished *lifecycle.ProcessFinished
	if errors.As(err, &finished) {
		httpjson.WriteLifecycleError(w, httpjson.Resolve(httpjson.CodeProcessFinished), finished)
		return
	}
	code := httpjson.CodeInternalError
	for _, pair := range []struct {
		err  error
		code httpjson.Code
	}{
		{drafts.ErrUnauthenticated, httpjson.CodeUnauthenticated}, {drafts.ErrForbidden, httpjson.CodeForbidden},
		{drafts.ErrCompanyInactive, httpjson.CodeCompanyInactive}, {drafts.ErrCompanyNotActive, httpjson.CodeCompanyNotActive},
		{drafts.ErrNotFound, httpjson.CodeNotFound}, {drafts.ErrPreconditionRequired, httpjson.CodePreconditionRequired},
		{drafts.ErrVersionConflict, httpjson.CodeVersionConflict}, {drafts.ErrInvalidRequest, httpjson.CodeInvalidRequest},
	} {
		if errors.Is(err, pair.err) {
			code = pair.code
			break
		}
	}
	httpjson.WriteCatalogError(w, httpjson.Resolve(code))
}
