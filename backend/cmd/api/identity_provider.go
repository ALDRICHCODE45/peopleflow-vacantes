package main

import (
	"log/slog"
	"time"

	identityusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/cognitogetuser"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/userinfo"
	runtimeconfig "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/config"
)

// identityProviderTimeout is the onboarding provider deadline (embedded-auth-v1 D11).
const identityProviderTimeout = 5 * time.Second

// newIdentityProvider builds the onboarding identity provider selected by
// configuration (embedded-auth-v1 D8). One instance serves both the candidate
// and the employer onboarding; nil means none (onboarding answers 503).
func newIdentityProvider(cfg runtimeconfig.IdentityConfig, logger *slog.Logger) identityusecases.UserInfoProvider {
	switch cfg.Provider {
	case runtimeconfig.IdentityProviderUserInfo:
		return userinfo.NewClient(cfg.UserInfoEndpoint, identityProviderTimeout)
	case runtimeconfig.IdentityProviderCognitoGetUser:
		return cognitogetuser.NewClient(cfg.CognitoEndpoint, identityProviderTimeout, logger)
	default:
		return nil
	}
}
