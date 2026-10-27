// Package testsupport guards opt-in local S3 integration fixtures.
package testsupport

import (
	"errors"
	"net/url"
	"strings"
)

// ValidateEndpoint must run before any SDK configuration or bucket bootstrap.
// Empty is permitted outside production so callers can explicitly skip tests.
func ValidateEndpoint(appEnv, endpoint string) error {
	if strings.EqualFold(appEnv, "production") {
		return errors.New("S3 integration bootstrap is forbidden in production")
	}
	if endpoint == "" {
		return nil
	}
	u, err := url.Parse(endpoint)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || u.Opaque != "" {
		return errors.New("S3 integration endpoint must be a loopback HTTP(S) origin")
	}
	switch strings.ToLower(u.Hostname()) {
	case "127.0.0.1", "localhost", "::1":
		return nil
	default:
		return errors.New("S3 integration endpoint must be a loopback HTTP(S) origin")
	}
}
