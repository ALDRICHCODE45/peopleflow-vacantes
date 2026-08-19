// Package application holds the identity application-level workflows:
// PostConfirmation (the Cognito trigger handler) and the use cases that
// the future HTTP handlers will consume.
package application

import (
	"context"
	"log/slog"
	"os"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
)

// PostConfirmationEvent is the minimal slice of the Cognito PostConfirmation
// trigger payload the handler needs. The real Lambda event adds fields
// like version, region, userPoolId, etc., but the handler intentionally
// keeps its surface narrow so the same code can run in tests and prod.
type PostConfirmationEvent struct {
	UserAttributes map[string]string
}

// PostConfirmationHandler is the application-layer entry point for the
// Cognito PostConfirmation trigger. It maps the first recognized Cognito
// group to an internal UserType and forwards the result to CreateUser.
//
// Env flag: IDENTITY_POSTCONFIRMATION_ENABLED. Read at call time (not
// package init) so tests can use t.Setenv to flip it per subtest.
type PostConfirmationHandler struct {
	users    repositories.UserRepository
	log      *slog.Logger
}

// NewPostConfirmationHandler builds the handler around the user
// repository port. The logger is optional; nil falls back to slog.Default.
func NewPostConfirmationHandler(users repositories.UserRepository) *PostConfirmationHandler {
	return &PostConfirmationHandler{
		users: users,
		log:   slog.Default(),
	}
}

// Handle is the Lambda-side entry point. It returns nil on success AND on
// the "no matching group, skip" path so the trigger can be re-delivered
// safely.
//
// Mapping table:
//   - "candidates"        -> UserCandidate
//   - "recruiters"        -> UserRecruiter
//   - "company_admins"    -> UserRecruiter (alias)
//
// First match wins; subsequent groups are ignored. No match -> skip + log.
func (h *PostConfirmationHandler) Handle(ctx context.Context, event PostConfirmationEvent) error {
	if !postConfirmationEnabled() {
		return nil
	}

	sub := strings.TrimSpace(event.UserAttributes["sub"])
	email := strings.TrimSpace(event.UserAttributes["email"])
	name := strings.TrimSpace(event.UserAttributes["name"])
	groupsRaw := strings.TrimSpace(event.UserAttributes["cognito:groups"])

	userType, ok := mapFirstMatch(splitGroups(groupsRaw))
	if !ok {
		h.log.Info("post_confirmation: no matching group; skipping",
			"sub", sub,
			"groups", groupsRaw,
		)
		return nil
	}

	if sub == "" {
		return entities.ErrEmptyCognitoSub
	}

	emailVO, err := valueobjects.NewEmail(email)
	if err != nil {
		return err
	}
	fullNameVO, err := valueobjects.NewFullName(name)
	if err != nil {
		return err
	}

	user, err := entities.NewUser(sub, emailVO, fullNameVO, userType)
	if err != nil {
		return err
	}

	_, err = h.users.Create(ctx, user)
	if err != nil {
		// Idempotency: if the user already exists (re-delivery or upstream
		// race), treat as success. ErrUserExists is the doctrine's
		// "already there" sentinel.
		if entities.IsErrUserExists(err) {
			h.log.Info("post_confirmation: user already exists", "sub", sub)
			return nil
		}
		return err
	}

	return nil
}

// postConfirmationEnabled reads the env flag at call time. The bool
// coercion is permissive: any value other than "true" (case-insensitive)
// disables the path. Tests rely on this with t.Setenv.
func postConfirmationEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("IDENTITY_POSTCONFIRMATION_ENABLED")))
	return v == "true"
}

// splitGroups normalizes the cognito:groups wire format. Cognito delivers
// it as either a JSON array string (e.g. `["candidates","recruiters"]`)
// or a comma-separated list. We strip the brackets and split on commas.
func splitGroups(raw string) []string {
	if raw == "" {
		return nil
	}
	// Strip JSON array brackets if present.
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "[")
	raw = strings.TrimSuffix(raw, "]")
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		// Strip quotes from JSON-style strings.
		p = strings.Trim(p, `"`)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// mapFirstMatch walks the groups slice and returns the first UserType
// whose name matches. Returns false when no group matches.
func mapFirstMatch(groups []string) (valueobjects.UserType, bool) {
	for _, g := range groups {
		switch g {
		case "candidates":
			return valueobjects.UserCandidate, true
		case "recruiters", "company_admins":
			return valueobjects.UserRecruiter, true
		}
	}
	return valueobjects.UnknownUserType, false
}
