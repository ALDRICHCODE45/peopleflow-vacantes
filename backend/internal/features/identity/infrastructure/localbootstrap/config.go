// Package localbootstrap implements the temporary TMP-IDENTITY-001 local
// users-only identity bootstrap process. It is disabled by default, only runs
// with APP_ENV=local, binds a literal loopback listener, requires an explicit
// private-terminal approval, and performs exactly one users-only creation
// attempt before exiting. It never loads dotenv files, never logs secrets, and
// never exposes identity/profile data over HTTP.
package localbootstrap

import (
	"errors"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
)

// Environment variable names pinned by the TMP-IDENTITY-001 contract (L4 §2).
const (
	EnvAppEnv        = "APP_ENV"
	EnvEnabled       = "IDENTITY_LOCAL_BOOTSTRAP_ENABLED"
	EnvAddr          = "IDENTITY_LOCAL_BOOTSTRAP_ADDR"
	EnvKey           = "IDENTITY_LOCAL_BOOTSTRAP_KEY"
	EnvUserType      = "IDENTITY_LOCAL_BOOTSTRAP_USER_TYPE"
	EnvCognitoDomain = "IDENTITY_LOCAL_BOOTSTRAP_COGNITO_DOMAIN"
	EnvDatabaseURL   = "DATABASE_URL"
	EnvJWTMode       = "IDENTITY_JWT_MODE"
	EnvJWTIssuer     = "IDENTITY_JWT_ISSUER"
	EnvJWTClientID   = "IDENTITY_JWT_CLIENT_ID"
	EnvJWTTokenUse   = "IDENTITY_JWT_TOKEN_USE"
)

// Fixed contract constants.
const (
	// DefaultAddr is the only default loopback listener address (L4 §1).
	DefaultAddr = "127.0.0.1:8081"
	// OperationTTL is the total lifetime printed as expires_in:60 (L8).
	OperationTTL = 60 * time.Second
	// MinKeyBytes is the minimum bridge-key length in bytes (L4 §2).
	MinKeyBytes = 32
	// UserInfoPath is the fixed Cognito UserInfo path (L4 §4).
	UserInfoPath = "/oauth2/userInfo"
	// MaxUserInfoBytes is the UserInfo response cap (16 KiB, L4 §4).
	MaxUserInfoBytes = 16 << 10
	// RequiredUserType is the only accepted bootstrap user type (L4 §1).
	RequiredUserType = "recruiter"
	// JWTModeJWKS is the only accepted verifier mode for this process.
	JWTModeJWKS = "jwks"
	// JWSTokenUse is the only accepted token purpose for this process.
	JWSTokenUse = "access"
)

// Config is the validated bootstrap configuration. A disabled Config carries
// no other usable values; callers must branch on Enabled first.
type Config struct {
	Enabled       bool
	AppEnv        string
	Addr          string
	Key           []byte
	UserType      valueobjects.UserType
	CognitoDomain string
	UserInfoURL   string
	DatabaseURL   string
	Issuer        string
}

// LoadConfig validates the bootstrap environment before any dependency is
// constructed. Errors are static literals and never include an environment
// value.
//
// An absent or explicit-false IDENTITY_LOCAL_BOOTSTRAP_ENABLED is a safe
// no-op. Any other value is rejected so a typo cannot silently disable or
// enable the process. When enabled, APP_ENV must be exactly local and every
// remaining option is validated before the caller builds a verifier, listener
// or database connection.
func LoadConfig(getenv func(string) string) (Config, error) {
	if getenv == nil {
		return Config{}, errors.New("local bootstrap: environment lookup function is required")
	}

	enabledRaw := strings.ToLower(strings.TrimSpace(getenv(EnvEnabled)))
	switch enabledRaw {
	case "", "false":
		return Config{Enabled: false}, nil
	case "true":
	default:
		return Config{}, errors.New("local bootstrap: IDENTITY_LOCAL_BOOTSTRAP_ENABLED must be exactly true or false")
	}

	appEnv := strings.ToLower(strings.TrimSpace(getenv(EnvAppEnv)))
	if appEnv != "local" {
		return Config{}, errors.New("local bootstrap: APP_ENV must be exactly local")
	}

	addr, err := validateAddr(getenv(EnvAddr))
	if err != nil {
		return Config{}, err
	}

	key, err := validateKey(getenv(EnvKey))
	if err != nil {
		return Config{}, err
	}

	userType, err := valueobjects.NewUserType(getenv(EnvUserType))
	if err != nil || userType != valueobjects.UserRecruiter {
		return Config{}, errors.New("local bootstrap: IDENTITY_LOCAL_BOOTSTRAP_USER_TYPE must be exactly recruiter")
	}

	domain, err := validateCognitoDomain(strings.TrimSpace(getenv(EnvCognitoDomain)))
	if err != nil {
		return Config{}, err
	}

	databaseURL := getenv(EnvDatabaseURL)
	if strings.TrimSpace(databaseURL) == "" {
		return Config{}, errors.New("local bootstrap: DATABASE_URL is required")
	}

	if mode := strings.ToLower(strings.TrimSpace(getenv(EnvJWTMode))); mode != JWTModeJWKS {
		return Config{}, errors.New("local bootstrap: IDENTITY_JWT_MODE must be exactly jwks")
	}
	issuer := strings.TrimSpace(getenv(EnvJWTIssuer))
	if issuer == "" {
		return Config{}, errors.New("local bootstrap: IDENTITY_JWT_ISSUER is required")
	}
	if strings.TrimSpace(getenv(EnvJWTClientID)) == "" {
		return Config{}, errors.New("local bootstrap: IDENTITY_JWT_CLIENT_ID is required")
	}
	if use := strings.TrimSpace(getenv(EnvJWTTokenUse)); use != JWSTokenUse {
		return Config{}, errors.New("local bootstrap: IDENTITY_JWT_TOKEN_USE must be exactly access")
	}

	return Config{
		Enabled:       true,
		AppEnv:        appEnv,
		Addr:          addr,
		Key:           key,
		UserType:      userType,
		CognitoDomain: domain,
		UserInfoURL:   domain + UserInfoPath,
		DatabaseURL:   databaseURL,
		Issuer:        issuer,
	}, nil
}

// validateAddr accepts only a literal loopback IP plus a real port. Hostnames
// such as "localhost", wildcard addresses and port 0 are rejected.
func validateAddr(raw string) (string, error) {
	addr := strings.TrimSpace(raw)
	if addr == "" {
		addr = DefaultAddr
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "", errors.New("local bootstrap: IDENTITY_LOCAL_BOOTSTRAP_ADDR must be a literal loopback IP and port")
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return "", errors.New("local bootstrap: IDENTITY_LOCAL_BOOTSTRAP_ADDR must be a literal loopback IP address")
	}
	p, err := strconv.Atoi(port)
	if err != nil || p < 1 || p > 65535 {
		return "", errors.New("local bootstrap: IDENTITY_LOCAL_BOOTSTRAP_ADDR must declare a port between 1 and 65535")
	}
	return net.JoinHostPort(host, port), nil
}

// validateKey enforces at least 32 bytes with no whitespace or control
// characters. The raw value is never trimmed: a surrounding space is a
// rejection, not a silent normalization.
func validateKey(raw string) ([]byte, error) {
	if raw == "" {
		return nil, errors.New("local bootstrap: IDENTITY_LOCAL_BOOTSTRAP_KEY is required")
	}
	if len(raw) < MinKeyBytes {
		return nil, errors.New("local bootstrap: IDENTITY_LOCAL_BOOTSTRAP_KEY must be at least 32 bytes")
	}
	for _, r := range raw {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			return nil, errors.New("local bootstrap: IDENTITY_LOCAL_BOOTSTRAP_KEY must not contain whitespace or control characters")
		}
	}
	return []byte(raw), nil
}

// validateCognitoDomain accepts only a bare HTTPS origin: no credentials,
// path, query or fragment.
func validateCognitoDomain(raw string) (string, error) {
	if raw == "" {
		return "", errors.New("local bootstrap: IDENTITY_LOCAL_BOOTSTRAP_COGNITO_DOMAIN is required")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.Hostname() == "" {
		return "", errors.New("local bootstrap: IDENTITY_LOCAL_BOOTSTRAP_COGNITO_DOMAIN must be a bare HTTPS origin")
	}
	if u.User != nil || u.Opaque != "" || u.Path != "" || u.RawPath != "" || u.ForceQuery || u.RawQuery != "" || u.Fragment != "" || u.RawFragment != "" {
		return "", errors.New("local bootstrap: IDENTITY_LOCAL_BOOTSTRAP_COGNITO_DOMAIN must not include credentials, path, query or fragment")
	}
	return "https://" + u.Host, nil
}
