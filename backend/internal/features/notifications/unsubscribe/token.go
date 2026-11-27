// Package unsubscribe implements the one-click unsubscribe of notifications-v2
// (D15–D17, §Unsubscribe): the stateless HMAC-SHA256 token issued in every
// non-mandatory email, the public GET (report, never mutates) and POST (turn
// the email preference off) on /v2/notifications/unsubscribe, and their
// per-IP limit. Every invalid token collapses into one outcome (ErrInvalid →
// 422 unsubscribe_link_invalid, identical bytes).
package unsubscribe

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
)

const (
	// TokenTTL is the token lifetime after issue (Q9).
	TokenTTL = 365 * 24 * time.Hour
	// MaxTokenLength bounds the accepted token text (§Limits).
	MaxTokenLength = 512
	// MinKeyBytes is the minimum key length (§Config keys).
	MinKeyBytes = 32

	macContext = "pf-notif-unsub:v1:"
	version    = 1
)

// ErrInvalid is the single outcome of every failed verification: callers can
// never tell which check refused the token.
var ErrInvalid = errors.New("unsubscribe link invalid")

// Key is one HMAC key: kid [a-z0-9]{1,16} and its secret (≥ 32 bytes). It
// renders as its kid only (fmt, slog, JSON).
type Key struct {
	ID     string
	Secret []byte
}

func (k Key) String() string                 { return k.ID + ":[redacted]" }
func (k Key) Format(f fmt.State, _ rune)     { _, _ = f.Write([]byte(k.String())) }
func (k Key) LogValue() slog.Value           { return slog.StringValue(k.String()) }
func (k Key) MarshalJSON() ([]byte, error)   { return json.Marshal(k.String()) }
func (s *Signer) String() string             { return "unsubscribe.Signer[redacted]" }
func (s *Signer) Format(f fmt.State, _ rune) { _, _ = f.Write([]byte(s.String())) }
func (s *Signer) LogValue() slog.Value       { return slog.StringValue(s.String()) }

var (
	kidPattern   = regexp.MustCompile(`^[a-z0-9]{1,16}$`)
	tokenPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+$`)
	b64          = base64.RawURLEncoding.Strict()
)

// Signer issues and verifies tokens `<kid>.<payload>.<mac>`: payload =
// base64url(no padding) of {"v":1,"u":…,"c":…|null,"t":…,"x":<unix expiry>},
// mac = base64url(HMAC-SHA256(key[kid], "pf-notif-unsub:v1:" + kid + "." +
// payload)). The first key signs; every key verifies (rotation). It satisfies
// email.TokenSigner. A nil *Signer signs nothing and verifies nothing.
type Signer struct {
	current string
	keys    map[string][]byte
	// decoy is a per-process random key: an unknown kid is MAC-checked against
	// it so the work matches a known kid's.
	decoy []byte
	now   func() time.Time
}

// NewSigner validates and copies the keys (order kept: keys[0] signs).
func NewSigner(keys []Key, now func() time.Time) (*Signer, error) {
	if len(keys) == 0 {
		return nil, errors.New("unsubscribe: at least one key required")
	}
	if now == nil {
		now = time.Now
	}
	s := &Signer{current: keys[0].ID, keys: make(map[string][]byte, len(keys)), decoy: make([]byte, sha256.Size), now: now}
	for _, k := range keys {
		if !kidPattern.MatchString(k.ID) {
			return nil, errors.New("unsubscribe: key id must match [a-z0-9]{1,16}")
		}
		if _, dup := s.keys[k.ID]; dup {
			return nil, errors.New("unsubscribe: duplicate key id")
		}
		if len(k.Secret) < MinKeyBytes {
			return nil, errors.New("unsubscribe: key shorter than 32 bytes")
		}
		s.keys[k.ID] = bytes.Clone(k.Secret)
	}
	if _, err := rand.Read(s.decoy); err != nil {
		return nil, errors.New("unsubscribe: random decoy key unavailable")
	}
	return s, nil
}

// payload is the token body; pointer fields make every key required.
type payload struct {
	V *int       `json:"v"`
	U *uuid.UUID `json:"u"`
	C *string    `json:"c"`
	T *string    `json:"t"`
	X *int64     `json:"x"`
}

// wirePayload fixes the issued JSON field order and the null company.
type wirePayload struct {
	V int        `json:"v"`
	U uuid.UUID  `json:"u"`
	C *uuid.UUID `json:"c"`
	T string     `json:"t"`
	X int64      `json:"x"`
}

// Sign issues the token of a non-mandatory (user, company, type) of the
// matching tree (company uuid.Nil ⇔ candidate type), expiring in TokenTTL.
func (s *Signer) Sign(k domain.PreferenceKey) (string, error) {
	if s == nil {
		return "", errors.New("unsubscribe: no signing key configured")
	}
	if k.User == uuid.Nil || !eligible(k.Type, k.Company) {
		return "", errors.New("unsubscribe: no token for this preference key")
	}
	w := wirePayload{V: version, U: k.User, T: string(k.Type), X: s.now().Add(TokenTTL).Unix()}
	if k.Company != uuid.Nil {
		c := k.Company
		w.C = &c
	}
	raw, err := json.Marshal(w)
	if err != nil {
		return "", err
	}
	p := b64.EncodeToString(raw)
	return s.current + "." + p + "." + b64.EncodeToString(sum(s.keys[s.current], s.current, p)), nil
}

// Verify returns the preference key of a valid token, else exactly
// ErrInvalid. Order (§Unsubscribe): length and charset, three parts, kid
// (unknown → decoy key, same work), constant-time MAC comparison, then the
// payload: v = 1, x > now, t a non-mandatory type of the tree implied by c.
// The live-user check belongs to the store.
func (s *Signer) Verify(token string) (domain.PreferenceKey, error) {
	if s == nil || len(token) > MaxTokenLength || !tokenPattern.MatchString(token) {
		return domain.PreferenceKey{}, ErrInvalid
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return domain.PreferenceKey{}, ErrInvalid
	}
	kid, p, mac := parts[0], parts[1], parts[2]
	key, known := s.keys[kid]
	if !known {
		key = s.decoy
	}
	// The MAC text is compared, not its decoding: a token whose text differs
	// from the issued one never verifies.
	want := b64.EncodeToString(sum(key, kid, p))
	if !hmac.Equal([]byte(want), []byte(mac)) || !known {
		return domain.PreferenceKey{}, ErrInvalid
	}
	k, ok := s.decodePayload(p)
	if !ok {
		return domain.PreferenceKey{}, ErrInvalid
	}
	return k, nil
}

func (s *Signer) decodePayload(p string) (domain.PreferenceKey, bool) {
	raw, err := b64.DecodeString(p)
	if err != nil || !strictObject(raw) {
		return domain.PreferenceKey{}, false
	}
	var body payload
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil || dec.More() {
		return domain.PreferenceKey{}, false
	}
	if body.V == nil || *body.V != version || body.U == nil || *body.U == uuid.Nil || body.T == nil || body.X == nil {
		return domain.PreferenceKey{}, false
	}
	if *body.X <= s.now().Unix() {
		return domain.PreferenceKey{}, false
	}
	k := domain.PreferenceKey{User: *body.U, Type: domain.Type(*body.T)}
	if body.C != nil {
		c, err := uuid.Parse(*body.C)
		if err != nil || c == uuid.Nil {
			return domain.PreferenceKey{}, false
		}
		k.Company = c
	} else if !hasNullCompany(raw) {
		return domain.PreferenceKey{}, false
	}
	if !eligible(k.Type, k.Company) {
		return domain.PreferenceKey{}, false
	}
	return k, true
}

// eligible: a known, non-mandatory type whose tree matches the company
// (member type ⇔ company set; candidate type ⇔ uuid.Nil).
func eligible(t domain.Type, company uuid.UUID) bool {
	spec, ok := domain.Lookup(t)
	if !ok || domain.Locked(t) {
		return false
	}
	return (spec.RecipientKind == domain.RecipientCandidate) == (company == uuid.Nil)
}

func sum(key []byte, kid, p string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(macContext + kid + "." + p))
	return h.Sum(nil)
}

// strictObject refuses anything but one JSON object with distinct keys (the
// decoder would silently keep the last of duplicated keys).
func strictObject(raw []byte) bool {
	dec := json.NewDecoder(bytes.NewReader(raw))
	tok, err := dec.Token()
	if err != nil || tok != json.Delim('{') {
		return false
	}
	seen := map[string]bool{}
	for dec.More() {
		tok, err := dec.Token()
		name, ok := tok.(string)
		if err != nil || !ok || seen[name] {
			return false
		}
		seen[name] = true
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return false
		}
	}
	return true
}

// hasNullCompany tells an explicit "c":null from a missing "c" (both decode
// to a nil pointer).
func hasNullCompany(raw []byte) bool {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return false
	}
	c, ok := fields["c"]
	return ok && string(c) == "null"
}
