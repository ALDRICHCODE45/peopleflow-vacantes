package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/lestrrat-go/jwx/v2/jwa"
	"github.com/lestrrat-go/jwx/v2/jwk"
)

const (
	maxJWKSResponseBytes = 256 << 10
	maxJWKSKeys          = 16
)

var (
	errJWKSVerifyNotImplemented = errors.New("jwks verifier: verification is not implemented")
	errJWKSClosed               = errors.New("jwks verifier: closed")
)

type jwksRefresh struct {
	done chan struct{}
	err  error
}

type JWKSVerifier struct {
	cfg       JWKSVerifierConfig
	client    *http.Client
	now       func() time.Time
	onJoin    func()
	mu        sync.Mutex
	snapshot  jwk.Set
	expiresAt time.Time
	inflight  *jwksRefresh
	closed    bool
	lifecycle context.Context
	cancel    context.CancelFunc
	wg        sync.WaitGroup
}

func NewJWKSVerifier(cfg JWKSVerifierConfig) (security.Verifier, error) {
	u, err := url.Parse(cfg.JWKSURL)
	if err != nil || cfg.JWKSURL == "" || u.Scheme != "https" || u.Hostname() == "" {
		return nil, errors.New("jwks verifier: JWKSURL must be a valid HTTPS URL")
	}
	if cfg.FetchTimeout <= 0 {
		return nil, errors.New("jwks verifier: fetch timeout must be positive")
	}
	cfg.CacheTTL = min(max(cfg.CacheTTL, minJWKSCacheTTL), maxJWKSCacheTTL)
	ctx, cancel := context.WithCancel(context.Background())
	return &JWKSVerifier{cfg: cfg, client: &http.Client{Timeout: cfg.FetchTimeout}, now: time.Now, lifecycle: ctx, cancel: cancel}, nil
}

func (v *JWKSVerifier) Verify(ctx context.Context, token string) (security.Claims, error) {
	_, _ = ctx, token
	return security.Claims{}, errJWKSVerifyNotImplemented
}

func (v *JWKSVerifier) Close() { v.mu.Lock(); v.closed = true; v.mu.Unlock(); v.cancel(); v.wg.Wait() }

func (v *JWKSVerifier) cachedSet() (jwk.Set, bool) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.snapshot == nil || !v.now().Before(v.expiresAt) {
		return nil, false
	}
	clone, err := cloneJWKSet(v.snapshot)
	return clone, err == nil
}

func (v *JWKSVerifier) refresh(waiter context.Context) error {
	v.mu.Lock()
	if v.closed {
		v.mu.Unlock()
		return errJWKSClosed
	}
	r := v.inflight
	if r == nil {
		r = &jwksRefresh{done: make(chan struct{})}
		v.inflight = r
		v.wg.Add(1)
		go v.runRefresh(r)
	}
	if v.onJoin != nil {
		v.onJoin()
	}
	v.mu.Unlock()
	select {
	case <-r.done:
		return r.err
	case <-waiter.Done():
		return waiter.Err()
	}
}

func (v *JWKSVerifier) runRefresh(r *jwksRefresh) {
	defer v.wg.Done()
	set, err := v.fetch(v.lifecycle)
	v.mu.Lock()
	defer v.mu.Unlock()
	if err == nil {
		if clone, cloneErr := cloneJWKSet(set); cloneErr == nil {
			v.snapshot, v.expiresAt = clone, v.now().Add(v.cfg.CacheTTL)
		} else {
			err = fmt.Errorf("jwks refresh: clone: %w", cloneErr)
		}
	}
	r.err, v.inflight = err, nil
	close(r.done)
}

func (v *JWKSVerifier) fetch(parent context.Context) (jwk.Set, error) {
	ctx, cancel := context.WithTimeout(parent, v.cfg.FetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.cfg.JWKSURL, nil)
	if err != nil {
		return nil, fmt.Errorf("jwks fetch: %w", err)
	}
	resp, err := v.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("jwks fetch: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("jwks fetch: unexpected status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxJWKSResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("jwks fetch: %w", err)
	}
	if len(body) > maxJWKSResponseBytes {
		return nil, errors.New("jwks fetch: response byte limit exceeded")
	}
	set, err := jwk.Parse(body)
	if err != nil {
		return nil, fmt.Errorf("jwks fetch: parse: %w", err)
	}
	if set.Len() > maxJWKSKeys {
		return nil, fmt.Errorf("jwks fetch: key count %d exceeds limit", set.Len())
	}
	for i := 0; i < set.Len(); i++ {
		key, _ := set.Key(i)
		if key.KeyID() == "" {
			return nil, errors.New("jwks fetch: key without kid")
		}
		if _, ok := key.(jwk.RSAPublicKey); !ok {
			return nil, errors.New("jwks fetch: key is not RSA")
		}
		if alg := key.Algorithm().String(); alg != "" && alg != jwa.RS256.String() {
			return nil, fmt.Errorf("jwks fetch: key alg %q is not RS256", alg)
		}
	}
	return set, nil
}

func cloneJWKSet(set jwk.Set) (jwk.Set, error) {
	body, err := json.Marshal(set)
	if err != nil {
		return nil, err
	}
	return jwk.Parse(body)
}
