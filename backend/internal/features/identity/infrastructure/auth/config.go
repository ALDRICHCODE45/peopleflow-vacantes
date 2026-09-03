package auth

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/lestrrat-go/jwx/v2/jwk"
)

const (
	envAppEnv           = "APP_ENV"
	envMode             = "IDENTITY_JWT_MODE"
	envIssuer           = "IDENTITY_JWT_ISSUER"
	envAudience         = "IDENTITY_JWT_AUDIENCE"
	envTokenUse         = "IDENTITY_JWT_TOKEN_USE"
	envPublicKeyPEM     = "IDENTITY_JWT_PUBLIC_KEY_PEM"
	envCacheTTL         = "IDENTITY_JWT_CACHE_TTL"
	envFetchTimeout     = "IDENTITY_JWT_FETCH_TIMEOUT"
	ModeJWKS            = "jwks"
	ModePEM             = "pem"
	minJWKSCacheTTL     = time.Minute
	maxJWKSCacheTTL     = 24 * time.Hour
	minJWKSFetchTimeout = time.Second
	maxJWKSFetchTimeout = time.Minute
	jwksDiscoveryPath   = "/.well-known/jwks.json"
)

type JWKSVerifierConfig struct {
	Issuer       string
	JWKSURL      string
	Audience     string
	TokenUse     string
	CacheTTL     time.Duration
	FetchTimeout time.Duration
}

type JWKSVerifierConstructor func(JWKSVerifierConfig) (security.Verifier, error)

// NewVerifierConfigFromEnv constructs exactly the explicitly selected verifier.
func NewVerifierConfigFromEnv(getenv func(string) string, newJWKS JWKSVerifierConstructor) (security.Verifier, error) {
	if getenv == nil {
		return nil, errors.New("environment lookup function is required")
	}
	env := strings.ToLower(strings.TrimSpace(getenv(envAppEnv)))
	if env != "production" && env != "local" && env != "test" {
		return nil, errors.New("APP_ENV is required and must be exactly production, local, or test")
	}
	switch strings.ToLower(strings.TrimSpace(getenv(envMode))) {
	case ModeJWKS:
		return newJWKSVerifierFromEnv(getenv, newJWKS)
	case ModePEM:
		return newPEMVerifierFromEnv(getenv, env)
	default:
		return nil, errors.New("IDENTITY_JWT_MODE is required and must be exactly jwks or pem")
	}
}

func newJWKSVerifierFromEnv(getenv func(string) string, constructor JWKSVerifierConstructor) (security.Verifier, error) {
	if constructor == nil {
		return nil, errors.New("jwks verifier constructor is required")
	}
	issuer := strings.TrimSpace(getenv(envIssuer))
	u, err := url.Parse(issuer)
	if err != nil || issuer == "" || u.Scheme != "https" || u.Hostname() == "" || u.User != nil ||
		u.Opaque != "" || u.ForceQuery || u.RawQuery != "" || u.Fragment != "" || u.RawFragment != "" {
		return nil, errors.New("IDENTITY_JWT_ISSUER must be a valid HTTPS URL in jwks mode")
	}
	audience := strings.TrimSpace(getenv(envAudience))
	if audience == "" {
		return nil, errors.New("IDENTITY_JWT_AUDIENCE is required in jwks mode")
	}
	tokenUse := strings.TrimSpace(getenv(envTokenUse))
	if tokenUse == "" {
		return nil, errors.New("IDENTITY_JWT_TOKEN_USE is required in jwks mode")
	}
	cacheTTL, err := boundedDuration(getenv(envCacheTTL), minJWKSCacheTTL, maxJWKSCacheTTL, envCacheTTL)
	if err != nil {
		return nil, err
	}
	fetchTimeout, err := boundedDuration(getenv(envFetchTimeout), minJWKSFetchTimeout, maxJWKSFetchTimeout, envFetchTimeout)
	if err != nil {
		return nil, err
	}
	discovery := *u
	discovery.Path = strings.TrimRight(u.Path, "/") + jwksDiscoveryPath
	v, err := constructor(JWKSVerifierConfig{
		Issuer: issuer, JWKSURL: discovery.String(), Audience: audience, TokenUse: tokenUse,
		CacheTTL: cacheTTL, FetchTimeout: fetchTimeout,
	})
	if err != nil || v == nil {
		return nil, errors.New("jwks verifier construction failed")
	}
	return v, nil
}

func newPEMVerifierFromEnv(getenv func(string) string, env string) (security.Verifier, error) {
	if env == "production" {
		return nil, errors.New("IDENTITY_JWT_MODE=pem is not allowed in production")
	}
	publicPEM := getenv(envPublicKeyPEM)
	if strings.TrimSpace(publicPEM) == "" {
		return nil, errors.New("IDENTITY_JWT_PUBLIC_KEY_PEM is required in pem mode")
	}
	issuer := strings.TrimSpace(getenv(envIssuer))
	if issuer == "" {
		return nil, errors.New("IDENTITY_JWT_ISSUER is required in pem mode")
	}
	parsedIssuer, err := url.Parse(issuer)
	if err != nil || !parsedIssuer.IsAbs() {
		return nil, errors.New("IDENTITY_JWT_ISSUER must be a valid absolute URL in pem mode")
	}
	audience := strings.TrimSpace(getenv(envAudience))
	if audience == "" {
		return nil, errors.New("IDENTITY_JWT_AUDIENCE is required in pem mode")
	}
	key, err := jwk.ParseKey([]byte(publicPEM), jwk.WithPEM(true))
	if err != nil {
		return nil, errors.New("IDENTITY_JWT_PUBLIC_KEY_PEM is not a valid public PEM")
	}
	if _, private := key.(jwk.RSAPrivateKey); private {
		return nil, errors.New("IDENTITY_JWT_PUBLIC_KEY_PEM must be a public key, not a private key")
	}
	if _, ok := key.(jwk.RSAPublicKey); !ok {
		return nil, errors.New("IDENTITY_JWT_PUBLIC_KEY_PEM is not a valid RSA public PEM")
	}
	return NewRSAVerifier(key, issuer, audience)
}

func boundedDuration(raw string, min, max time.Duration, name string) (time.Duration, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, fmt.Errorf("%s is required", name)
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("%s must be a valid duration", name)
	}
	if d < min || d > max {
		return 0, fmt.Errorf("%s must be between %s and %s", name, min, max)
	}
	return d, nil
}
