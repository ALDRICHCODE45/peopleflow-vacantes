package config

import (
	"errors"
	"net/url"
	"strings"
)

const EnvIdentityUserInfoEndpoint = "IDENTITY_USERINFO_ENDPOINT"

type IdentityConfig struct{ UserInfoEndpoint string }

// LoadIdentityConfig leaves onboarding disabled when the setting is absent.
// An invalid endpoint is a startup configuration error, never echoed in logs.
func LoadIdentityConfig(getenv func(string) string) (IdentityConfig, error) {
	if getenv == nil {
		return IdentityConfig{}, errors.New("identity configuration lookup required")
	}
	raw := strings.TrimSpace(getenv(EnvIdentityUserInfoEndpoint))
	if raw == "" {
		return IdentityConfig{}, nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Opaque != "" || u.Path != "/oauth2/userInfo" || u.RawPath != "" || u.ForceQuery || u.RawQuery != "" || u.Fragment != "" || u.RawFragment != "" {
		return IdentityConfig{}, errors.New("IDENTITY_USERINFO_ENDPOINT must be an HTTPS UserInfo endpoint without credentials, query or fragment")
	}
	return IdentityConfig{UserInfoEndpoint: raw}, nil
}
