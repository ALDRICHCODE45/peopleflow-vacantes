package unsubscribe

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
)

var (
	t0      = time.Date(2026, 11, 26, 15, 0, 0, 0, time.UTC)
	secretA = bytes.Repeat([]byte{0xA1}, 32)
	secretB = bytes.Repeat([]byte{0xB2}, 48)
)

func clock(at *time.Time) func() time.Time { return func() time.Time { return *at } }

func newTestSigner(t *testing.T, now *time.Time, keys ...Key) *Signer {
	t.Helper()
	s, err := NewSigner(keys, clock(now))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// mac is the contract formula, written independently of the implementation:
// base64url(HMAC-SHA256(key, "pf-notif-unsub:v1:" + kid + "." + payload)).
func mac(secret []byte, kid, payload string) string {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte("pf-notif-unsub:v1:" + kid + "." + payload))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

// forge signs an arbitrary payload with a real key (valid MAC), to reach the
// checks that run after the MAC comparison.
func forge(secret []byte, kid, payloadJSON string) string {
	p := base64.RawURLEncoding.EncodeToString([]byte(payloadJSON))
	return kid + "." + p + "." + mac(secret, kid, p)
}

func memberKey() domain.PreferenceKey {
	return domain.PreferenceKey{User: uuid.New(), Company: uuid.New(), Type: domain.TypeApplicationReceived}
}

func candidateKey() domain.PreferenceKey {
	return domain.PreferenceKey{User: uuid.New(), Type: domain.TypeCandidateStatusChanged}
}

func wantInvalid(t *testing.T, s *Signer, token, what string) {
	t.Helper()
	k, err := s.Verify(token)
	if !errors.Is(err, ErrInvalid) || err != ErrInvalid || k != (domain.PreferenceKey{}) {
		t.Fatalf("%s: key=%+v err=%v, want exactly ErrInvalid and a zero key", what, k, err)
	}
}

func TestSignVerifyRoundTrip(t *testing.T) {
	now := t0
	s := newTestSigner(t, &now, Key{ID: "k1", Secret: secretA})
	for name, key := range map[string]domain.PreferenceKey{"member": memberKey(), "candidate": candidateKey()} {
		t.Run(name, func(t *testing.T) {
			token, err := s.Sign(key)
			if err != nil {
				t.Fatal(err)
			}
			parts := strings.Split(token, ".")
			if len(parts) != 3 || parts[0] != "k1" || len(token) > MaxTokenLength || !tokenCharset(token) {
				t.Fatalf("token shape %q", token)
			}
			if got := mac(secretA, "k1", parts[1]); got != parts[2] {
				t.Fatalf("mac %s, contract formula gives %s", parts[2], got)
			}
			raw, err := base64.RawURLEncoding.DecodeString(parts[1])
			if err != nil {
				t.Fatal(err)
			}
			company := "null"
			if key.Company != uuid.Nil {
				company = `"` + key.Company.String() + `"`
			}
			want := `{"v":1,"u":"` + key.User.String() + `","c":` + company + `,"t":"` + string(key.Type) + `","x":` +
				jsonInt(t0.Add(365*24*time.Hour).Unix()) + `}`
			if string(raw) != want {
				t.Fatalf("payload\n got %s\nwant %s", raw, want)
			}
			got, err := s.Verify(token)
			if err != nil || got != key {
				t.Fatalf("verify %+v %v, want %+v", got, err, key)
			}
		})
	}
}

func jsonInt(v int64) string { b, _ := json.Marshal(v); return string(b) }

func tokenCharset(s string) bool {
	for _, r := range s {
		if !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_' || r == '.' || r == '-') {
			return false
		}
	}
	return true
}

func TestVerifyExpiry(t *testing.T) {
	now := t0
	s := newTestSigner(t, &now, Key{ID: "k1", Secret: secretA})
	key := memberKey()
	token, err := s.Sign(key)
	if err != nil {
		t.Fatal(err)
	}
	now = t0.Add(365*24*time.Hour - time.Second)
	if got, err := s.Verify(token); err != nil || got != key {
		t.Fatalf("one second before expiry: %+v %v", got, err)
	}
	now = t0.Add(365 * 24 * time.Hour) // x > now is required: x == now is expired
	wantInvalid(t, s, token, "at expiry")
	now = t0.Add(400 * 24 * time.Hour)
	wantInvalid(t, s, token, "after expiry")
}

func TestVerifyRejectsTampering(t *testing.T) {
	now := t0
	s := newTestSigner(t, &now, Key{ID: "k1", Secret: secretA}, Key{ID: "k2", Secret: secretB})
	token, err := s.Sign(memberKey())
	if err != nil {
		t.Fatal(err)
	}
	// Every single-character change anywhere (kid, payload, mac, separators).
	alphabet := "AZaz09_-."
	for i := range token {
		for _, c := range alphabet {
			if byte(c) == token[i] {
				continue
			}
			mutated := token[:i] + string(c) + token[i+1:]
			// Also a change in the MAC's last char that only flips its unused
			// padding bits (same decoded bytes): the text differs, so it fails.
			if _, err := s.Verify(mutated); err == nil {
				t.Fatalf("mutation at %d (%q) verified: %s", i, c, mutated)
			}
		}
	}
	parts := strings.Split(token, ".")
	// The MAC of another key under the same kid, a swapped payload, a truncated MAC.
	other := forge(secretB, "k1", mustDecode(t, parts[1]))
	wantInvalid(t, s, other, "mac of another key under k1")
	other2, _ := s.Sign(memberKey())
	wantInvalid(t, s, parts[0]+"."+strings.Split(other2, ".")[1]+"."+parts[2], "payload swapped")
	wantInvalid(t, s, parts[0]+"."+parts[1]+"."+parts[2][:len(parts[2])-2], "truncated mac")
	wantInvalid(t, s, parts[0]+"."+parts[1]+"."+parts[2]+"AA", "extended mac")
	wantInvalid(t, s, "k2."+parts[1]+"."+parts[2], "kid swapped to another configured key")
}

func mustDecode(t *testing.T, p string) string {
	t.Helper()
	raw, err := base64.RawURLEncoding.DecodeString(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestVerifyUnknownKid(t *testing.T) {
	now := t0
	s := newTestSigner(t, &now, Key{ID: "k1", Secret: secretA})
	key := memberKey()
	payload := `{"v":1,"u":"` + key.User.String() + `","c":"` + key.Company.String() + `","t":"application_received","x":` + jsonInt(t0.Add(time.Hour).Unix()) + `}`
	wantInvalid(t, s, forge(secretA, "k9", payload), "unknown kid signed with a known secret")
	wantInvalid(t, s, forge(secretB, "k9", payload), "unknown kid")
	wantInvalid(t, s, forge(secretA, "K1", payload), "kid outside [a-z0-9]")
	wantInvalid(t, s, forge(secretA, strings.Repeat("a", 17), payload), "kid too long")
	wantInvalid(t, s, forge(secretA, "", payload), "empty kid")
	if _, err := s.Verify(forge(secretA, "k1", payload)); err != nil {
		t.Fatalf("control: the same payload under k1 must verify: %v", err)
	}
}

func TestKeyRotation(t *testing.T) {
	now := t0
	old := newTestSigner(t, &now, Key{ID: "k1", Secret: secretA})
	rotated := newTestSigner(t, &now, Key{ID: "k2", Secret: secretB}, Key{ID: "k1", Secret: secretA})
	dropped := newTestSigner(t, &now, Key{ID: "k2", Secret: secretB})
	key := candidateKey()
	oldToken, err := old.Sign(key)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := rotated.Verify(oldToken); err != nil || got != key {
		t.Fatalf("old key must still verify after rotation: %+v %v", got, err)
	}
	newToken, err := rotated.Sign(key)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(newToken, "k2.") {
		t.Fatalf("the first key signs: %s", newToken)
	}
	if _, err := rotated.Verify(newToken); err != nil {
		t.Fatal(err)
	}
	wantInvalid(t, old, newToken, "new token on a signer without the new key")
	wantInvalid(t, dropped, oldToken, "old token after its key is dropped")
	if _, err := dropped.Verify(newToken); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyLengthAndCharset(t *testing.T) {
	now := t0
	s := newTestSigner(t, &now, Key{ID: "k1", Secret: secretA})
	token, _ := s.Sign(memberKey())
	cases := map[string]string{
		"empty":          "",
		"513 chars":      token + "." + strings.Repeat("A", MaxTokenLength-len(token)),
		"far too long":   strings.Repeat("A", 100000),
		"space":          token[:5] + " " + token[6:],
		"padding":        token + "=",
		"plus":           strings.Replace(token, token[4:5], "+", 1),
		"slash":          strings.Replace(token, token[4:5], "/", 1),
		"non-ascii":      token[:5] + "é" + token[6:],
		"two parts":      strings.Join(strings.Split(token, ".")[:2], "."),
		"four parts":     token + ".AAAA",
		"empty payload":  "k1.." + strings.Split(token, ".")[2],
		"leading dot":    "." + token,
		"newline suffix": token + "\n",
	}
	if len(cases["513 chars"]) != MaxTokenLength+1 {
		t.Fatalf("fixture length %d", len(cases["513 chars"]))
	}
	for name, tok := range cases {
		wantInvalid(t, s, tok, name)
	}
	// A long token within 512 chars is not refused for its length; with a
	// valid MAC it still fails on its payload (unknown field).
	long := forge(secretA, "k1", `{"v":1,"pad":"`+strings.Repeat("x", 300)+`"}`)
	if len(long) > MaxTokenLength {
		t.Fatalf("fixture too long: %d", len(long))
	}
	wantInvalid(t, s, long, "unknown payload field")
}

func TestVerifyPayloadRules(t *testing.T) {
	now := t0
	s := newTestSigner(t, &now, Key{ID: "k1", Secret: secretA})
	u, c := uuid.New().String(), uuid.New().String()
	x := jsonInt(t0.Add(time.Hour).Unix())
	valid := map[string]string{
		"member":    `{"v":1,"u":"` + u + `","c":"` + c + `","t":"psychometric_pending","x":` + x + `}`,
		"candidate": `{"v":1,"u":"` + u + `","c":null,"t":"candidate_test_pending","x":` + x + `}`,
	}
	for name, p := range valid {
		if _, err := s.Verify(forge(secretA, "k1", p)); err != nil {
			t.Fatalf("control %s: %v", name, err)
		}
	}
	invalid := map[string]string{
		"version 2":               `{"v":2,"u":"` + u + `","c":"` + c + `","t":"psychometric_pending","x":` + x + `}`,
		"version missing":         `{"u":"` + u + `","c":"` + c + `","t":"psychometric_pending","x":` + x + `}`,
		"user missing":            `{"v":1,"c":"` + c + `","t":"psychometric_pending","x":` + x + `}`,
		"company missing":         `{"v":1,"u":"` + u + `","t":"psychometric_pending","x":` + x + `}`,
		"type missing":            `{"v":1,"u":"` + u + `","c":"` + c + `","x":` + x + `}`,
		"expiry missing":          `{"v":1,"u":"` + u + `","c":"` + c + `","t":"psychometric_pending"}`,
		"unknown field":           `{"v":1,"u":"` + u + `","c":"` + c + `","t":"psychometric_pending","x":` + x + `,"z":1}`,
		"duplicate field":         `{"v":1,"u":"` + u + `","u":"` + c + `","c":"` + c + `","t":"psychometric_pending","x":` + x + `}`,
		"trailing data":           `{"v":1,"u":"` + u + `","c":"` + c + `","t":"psychometric_pending","x":` + x + `}{}`,
		"not json":                `v=1`,
		"array":                   `[1]`,
		"bad user":                `{"v":1,"u":"nope","c":"` + c + `","t":"psychometric_pending","x":` + x + `}`,
		"nil user":                `{"v":1,"u":"` + uuid.Nil.String() + `","c":"` + c + `","t":"psychometric_pending","x":` + x + `}`,
		"bad company":             `{"v":1,"u":"` + u + `","c":"nope","t":"psychometric_pending","x":` + x + `}`,
		"nil company":             `{"v":1,"u":"` + u + `","c":"` + uuid.Nil.String() + `","t":"psychometric_pending","x":` + x + `}`,
		"unknown type":            `{"v":1,"u":"` + u + `","c":"` + c + `","t":"nope","x":` + x + `}`,
		"mandatory member type":   `{"v":1,"u":"` + u + `","c":"` + c + `","t":"delivery_overdue","x":` + x + `}`,
		"mandatory assigned":      `{"v":1,"u":"` + u + `","c":"` + c + `","t":"vacancy_assigned","x":` + x + `}`,
		"member type, no company": `{"v":1,"u":"` + u + `","c":null,"t":"application_received","x":` + x + `}`,
		"candidate type, company": `{"v":1,"u":"` + u + `","c":"` + c + `","t":"candidate_status_changed","x":` + x + `}`,
		"expiry string":           `{"v":1,"u":"` + u + `","c":"` + c + `","t":"psychometric_pending","x":"` + x + `"}`,
		"expiry fraction":         `{"v":1,"u":"` + u + `","c":"` + c + `","t":"psychometric_pending","x":` + x + `.5}`,
		"expired":                 `{"v":1,"u":"` + u + `","c":"` + c + `","t":"psychometric_pending","x":` + jsonInt(t0.Unix()) + `}`,
		"version string":          `{"v":"1","u":"` + u + `","c":"` + c + `","t":"psychometric_pending","x":` + x + `}`,
	}
	for name, p := range invalid {
		wantInvalid(t, s, forge(secretA, "k1", p), name)
	}
}

func TestSignRefusesKeysWithoutAToken(t *testing.T) {
	now := t0
	s := newTestSigner(t, &now, Key{ID: "k1", Secret: secretA})
	company := uuid.New()
	for name, key := range map[string]domain.PreferenceKey{
		"mandatory":               {User: uuid.New(), Company: company, Type: domain.TypeDeliveryOverdue},
		"member type, no company": {User: uuid.New(), Type: domain.TypeApplicationReceived},
		"candidate type, company": {User: uuid.New(), Company: company, Type: domain.TypeCandidateMessageReceived},
		"nil user":                {Company: company, Type: domain.TypeApplicationReceived},
		"unknown type":            {User: uuid.New(), Company: company, Type: "nope"},
	} {
		if token, err := s.Sign(key); err == nil || token != "" {
			t.Fatalf("%s: signed %q", name, token)
		}
	}
}

func TestNewSignerValidatesKeys(t *testing.T) {
	now := t0
	for name, keys := range map[string][]Key{
		"none":          nil,
		"short secret":  {{ID: "k1", Secret: secretA[:31]}},
		"bad kid":       {{ID: "K1", Secret: secretA}},
		"long kid":      {{ID: strings.Repeat("a", 17), Secret: secretA}},
		"empty kid":     {{ID: "", Secret: secretA}},
		"duplicate kid": {{ID: "k1", Secret: secretA}, {ID: "k1", Secret: secretB}},
	} {
		if s, err := NewSigner(keys, clock(&now)); err == nil || s != nil {
			t.Fatalf("%s: accepted", name)
		} else if strings.Contains(err.Error(), string(secretA[:4])) {
			t.Fatalf("%s: secret leaked in %v", name, err)
		}
	}
	// The signer copies the secrets: mutating the caller's slice changes nothing.
	secret := append([]byte(nil), secretA...)
	s := newTestSigner(t, &now, Key{ID: "k1", Secret: secret})
	token, _ := s.Sign(memberKey())
	secret[0] ^= 0xFF
	if _, err := s.Verify(token); err != nil {
		t.Fatal("signer must not alias the caller's secret")
	}
}

// A nil signer (mailer off: no keys) verifies nothing and signs nothing.
func TestNilSigner(t *testing.T) {
	var s *Signer
	wantInvalid(t, s, "k1.AAAA.AAAA", "nil signer")
	if _, err := s.Sign(memberKey()); err == nil {
		t.Fatal("nil signer signed")
	}
}

// Neither the signer nor a key ever prints key material (fmt, slog, JSON).
func TestKeysAreNeverPrinted(t *testing.T) {
	now := t0
	key := Key{ID: "k1", Secret: secretA}
	s := newTestSigner(t, &now, key, Key{ID: "k2", Secret: secretB})
	var logged bytes.Buffer
	slog.New(slog.NewJSONHandler(&logged, nil)).Info("x", "signer", s, "key", key, "keys", []Key{key})
	slog.New(slog.NewTextHandler(&logged, nil)).Info("x", "signer", s, "key", key)
	raw, err := json.Marshal(map[string]any{"signer": s, "key": key})
	if err != nil {
		t.Fatal(err)
	}
	out := fmt.Sprintf("%v|%+v|%#v|%s|%x|%v|%+v|%#v|%d", s, s, s, s, s, key, key, key, key) + logged.String() + string(raw)
	for _, leak := range []string{"a1a1a1a1", "161 161", "0xa1", "b2b2b2b2", "178 178", "0xb2", base64.StdEncoding.EncodeToString(secretA)[:12],
		base64.RawURLEncoding.EncodeToString(secretB)[:12], string(secretA[:4])} {
		if strings.Contains(strings.ToLower(out), strings.ToLower(leak)) {
			t.Fatalf("key material %q printed:\n%s", leak, out)
		}
	}
}
