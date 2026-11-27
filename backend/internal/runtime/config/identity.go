package config

import (
	"errors"
	"net"
	"net/url"
	"regexp"
	"strings"
)

const (
	EnvIdentityUserInfoEndpoint = "IDENTITY_USERINFO_ENDPOINT"
	EnvIdentityProvider         = "IDENTITY_PROVIDER"
	EnvIdentityCognitoRegion    = "IDENTITY_COGNITO_REGION"
	EnvIdentityCognitoEndpoint  = "IDENTITY_COGNITO_ENDPOINT"

	// Read with the verifier's normalization (auth/config.go) for D8/D14.
	envIdentityAppEnv    = "APP_ENV"
	envIdentityJWTMode   = "IDENTITY_JWT_MODE"
	envIdentityJWTIssuer = "IDENTITY_JWT_ISSUER"
)

// IdentityProvider selects the onboarding identity source (embedded-auth-v1 D8).
type IdentityProvider string

const (
	// IdentityProviderNone: no provider; onboarding answers 503 identity_unavailable.
	IdentityProviderNone           IdentityProvider = ""
	IdentityProviderUserInfo       IdentityProvider = "userinfo"
	IdentityProviderCognitoGetUser IdentityProvider = "cognito_getuser"
)

type IdentityConfig struct {
	Provider         IdentityProvider
	UserInfoEndpoint string
	CognitoRegion    string
	// CognitoEndpoint is the GetUser URL actually called: the regional
	// https://cognito-idp.<region>.amazonaws.com/ or the loopback override.
	CognitoEndpoint string
}

var (
	cognitoRegionPattern = regexp.MustCompile(`^[a-z]{2}(-[a-z]+)+-[0-9]+$`)
	cognitoIssuerHost    = regexp.MustCompile(`^cognito-idp\.([a-z0-9-]+)\.amazonaws\.com$`)
)

// LoadIdentityConfig resolves the onboarding identity provider. Unset
// IDENTITY_PROVIDER keeps the legacy behavior (UserInfo when its endpoint is
// set, else none). Mixed or partial configuration is a startup error; errors
// are static strings naming the key, never its value.
func LoadIdentityConfig(getenv func(string) string) (IdentityConfig, error) {
	if getenv == nil {
		return IdentityConfig{}, errors.New("identity configuration lookup required")
	}
	provider := strings.TrimSpace(getenv(EnvIdentityProvider))
	userInfo := strings.TrimSpace(getenv(EnvIdentityUserInfoEndpoint))
	region := strings.TrimSpace(getenv(EnvIdentityCognitoRegion))
	endpoint := strings.TrimSpace(getenv(EnvIdentityCognitoEndpoint))

	switch IdentityProvider(provider) {
	case IdentityProviderNone:
		if region != "" {
			return IdentityConfig{}, errors.New("IDENTITY_COGNITO_REGION requires IDENTITY_PROVIDER=cognito_getuser")
		}
		if endpoint != "" {
			return IdentityConfig{}, errors.New("IDENTITY_COGNITO_ENDPOINT requires IDENTITY_PROVIDER=cognito_getuser")
		}
		if userInfo == "" {
			return IdentityConfig{}, nil
		}
		return loadUserInfo(userInfo)
	case IdentityProviderUserInfo:
		if region != "" {
			return IdentityConfig{}, errors.New("IDENTITY_COGNITO_REGION must be unset when IDENTITY_PROVIDER=userinfo")
		}
		if endpoint != "" {
			return IdentityConfig{}, errors.New("IDENTITY_COGNITO_ENDPOINT must be unset when IDENTITY_PROVIDER=userinfo")
		}
		if userInfo == "" {
			return IdentityConfig{}, errors.New("IDENTITY_USERINFO_ENDPOINT is required when IDENTITY_PROVIDER=userinfo")
		}
		return loadUserInfo(userInfo)
	case IdentityProviderCognitoGetUser:
		return loadCognitoGetUser(getenv, userInfo, region, endpoint)
	default:
		return IdentityConfig{}, errors.New("IDENTITY_PROVIDER must be exactly userinfo or cognito_getuser when set")
	}
}

func loadUserInfo(raw string) (IdentityConfig, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Opaque != "" || u.Path != "/oauth2/userInfo" || u.RawPath != "" || u.ForceQuery || u.RawQuery != "" || u.Fragment != "" || u.RawFragment != "" {
		return IdentityConfig{}, errors.New("IDENTITY_USERINFO_ENDPOINT must be an HTTPS UserInfo endpoint without credentials, query or fragment")
	}
	return IdentityConfig{Provider: IdentityProviderUserInfo, UserInfoEndpoint: raw}, nil
}

func loadCognitoGetUser(getenv func(string) string, userInfo, region, endpoint string) (IdentityConfig, error) {
	if userInfo != "" {
		return IdentityConfig{}, errors.New("IDENTITY_USERINFO_ENDPOINT must be unset when IDENTITY_PROVIDER=cognito_getuser")
	}
	if region == "" {
		return IdentityConfig{}, errors.New("IDENTITY_COGNITO_REGION is required when IDENTITY_PROVIDER=cognito_getuser")
	}
	if !cognitoRegionPattern.MatchString(region) {
		return IdentityConfig{}, errors.New("IDENTITY_COGNITO_REGION must be a lowercase AWS region name")
	}
	appEnv := strings.ToLower(strings.TrimSpace(getenv(envIdentityAppEnv)))
	// D14: a token can only be read by its own pool's region.
	if appEnv == "production" && strings.ToLower(strings.TrimSpace(getenv(envIdentityJWTMode))) == "jwks" {
		if issuer, err := url.Parse(strings.TrimSpace(getenv(envIdentityJWTIssuer))); err == nil {
			if m := cognitoIssuerHost.FindStringSubmatch(strings.ToLower(issuer.Hostname())); m != nil && m[1] != region {
				return IdentityConfig{}, errors.New("IDENTITY_COGNITO_REGION must match the region of the Cognito IDENTITY_JWT_ISSUER in production")
			}
		}
	}
	resolved := "https://cognito-idp." + region + ".amazonaws.com/"
	if endpoint != "" {
		if appEnv != "local" && appEnv != "test" {
			return IdentityConfig{}, errors.New("IDENTITY_COGNITO_ENDPOINT is only allowed when APP_ENV is local or test")
		}
		override, ok := loopbackEndpoint(endpoint)
		if !ok {
			return IdentityConfig{}, errors.New("IDENTITY_COGNITO_ENDPOINT must be an http(s) loopback URL with an optional port and no path, credentials, query or fragment")
		}
		resolved = override
	}
	return IdentityConfig{Provider: IdentityProviderCognitoGetUser, CognitoRegion: region, CognitoEndpoint: resolved}, nil
}

// loopbackEndpoint accepts http(s)://{localhost|127.0.0.0/8|[::1]}[:port][/]
// and returns it normalized with the path "/".
func loopbackEndpoint(raw string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Opaque != "" || u.User != nil ||
		(u.Path != "" && u.Path != "/") || u.RawPath != "" || u.ForceQuery || u.RawQuery != "" || u.Fragment != "" || u.RawFragment != "" {
		return "", false
	}
	host := u.Hostname()
	if host != "localhost" {
		ip := net.ParseIP(host)
		if ip == nil || !ip.IsLoopback() {
			return "", false
		}
	}
	u.Path = "/"
	return u.String(), true
}
