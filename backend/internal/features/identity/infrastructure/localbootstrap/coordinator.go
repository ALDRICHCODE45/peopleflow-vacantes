package localbootstrap

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base32"
	"errors"
	"sync"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
)

// Coordinator failure sentinels. They are static and never carry identity or
// database values.
var (
	ErrStagePending     = errors.New("local bootstrap: a stage is already pending")
	ErrApprovalRequired = errors.New("local bootstrap: terminal approval required")
	ErrOperationExpired = errors.New("local bootstrap: operation expired")
	ErrCodeMismatch     = errors.New("local bootstrap: operation code mismatch")
	ErrIdentityConflict = errors.New("local bootstrap: identity conflict")
)

// Candidate is the single immutable staged candidate. It never stores the
// access token.
type Candidate struct {
	Subject       string
	Email         string
	FullName      string
	UserType      valueobjects.UserType
	Database      DatabaseTarget
	OperationCode string
	ExpiresAt     time.Time
}

// Coordinator owns the single in-memory stage/approval/consume state machine.
// One candidate may exist at a time; a compatible grant is armed from that
// immutable candidate and consumed exactly once.
type Coordinator struct {
	mu      sync.Mutex
	now     func() time.Time
	cand    *Candidate
	grant   *Candidate
	changed chan struct{}
}

// NewCoordinator builds the coordinator. A nil clock defaults to time.Now.
func NewCoordinator(now func() time.Time) *Coordinator {
	if now == nil {
		now = time.Now
	}
	return &Coordinator{now: now, changed: make(chan struct{})}
}

// NewOperationCode returns 16 cryptographic random bytes encoded as uppercase
// unpadded base32 (26 characters).
func NewOperationCode() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", errors.New("local bootstrap: could not generate an operation code")
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw[:]), nil
}

// validOperationCode reports whether code is exactly a 26-character uppercase
// unpadded base32 encoding of 16 bytes.
func validOperationCode(code string) bool {
	if len(code) != 26 {
		return false
	}
	raw, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(code)
	return err == nil && len(raw) == 16
}

// Stage installs the immutable candidate or rejects the call when a live
// candidate or armed grant already exists (ErrStagePending). An already-expired
// candidate is reported as ErrOperationExpired rather than installed.
func (c *Coordinator) Stage(cand Candidate) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.expireLocked()
	if c.cand != nil {
		return ErrStagePending
	}
	if !c.now().Before(cand.ExpiresAt) {
		return ErrOperationExpired
	}
	c.cand = &cand
	c.signalLocked()
	return nil
}

// Pending reports whether a live (unexpired) candidate or armed grant exists,
// clearing expired state first.
func (c *Coordinator) Pending() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.expireLocked()
	return c.cand != nil
}

// WaitForCandidate blocks until a candidate is staged and returns an immutable
// snapshot, or returns ctx.Err() when the context ends first.
func (c *Coordinator) WaitForCandidate(ctx context.Context) (Candidate, error) {
	for {
		c.mu.Lock()
		c.expireLocked()
		if c.cand != nil && c.grant == nil {
			snapshot := *c.cand
			c.mu.Unlock()
			return snapshot, nil
		}
		changed := c.changed
		c.mu.Unlock()

		select {
		case <-changed:
		case <-ctx.Done():
			return Candidate{}, ctx.Err()
		}
	}
}

// Approve arms exactly one grant for the current immutable candidate after a
// constant-time operation-code comparison.
func (c *Coordinator) Approve(code string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.expireLocked() {
		return ErrOperationExpired
	}
	if c.cand == nil || c.grant != nil {
		return ErrApprovalRequired
	}
	if subtle.ConstantTimeCompare([]byte(c.cand.OperationCode), []byte(code)) != 1 {
		return ErrCodeMismatch
	}
	grant := *c.cand
	c.grant = &grant
	c.signalLocked()
	return nil
}

// Reject clears every staged/armed state.
func (c *Coordinator) Reject() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cand == nil && c.grant == nil {
		return
	}
	c.cand, c.grant = nil, nil
	c.signalLocked()
}

// CheckApproval reports whether an apply with code may proceed, without
// consuming state. A live candidate that is not armed reports
// ErrApprovalRequired; a mismatch never reveals which part was wrong.
func (c *Coordinator) CheckApproval(code string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.expireLocked() {
		return ErrOperationExpired
	}
	if c.grant == nil {
		return ErrApprovalRequired
	}
	if subtle.ConstantTimeCompare([]byte(c.grant.OperationCode), []byte(code)) != 1 {
		return ErrApprovalRequired
	}
	return nil
}

// Consume atomically verifies the armed grant, matches the freshly verified
// identity against the immutable approved candidate, checks the code and TTL,
// and consumes the grant exactly once.
func (c *Coordinator) Consume(code, subject, email, fullName string, userType valueobjects.UserType) (Candidate, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.expireLocked() {
		return Candidate{}, ErrOperationExpired
	}
	if c.grant == nil {
		return Candidate{}, ErrApprovalRequired
	}
	grant := c.grant
	if subtle.ConstantTimeCompare([]byte(grant.OperationCode), []byte(code)) != 1 {
		return Candidate{}, ErrApprovalRequired
	}
	if grant.Subject != subject || grant.Email != email || grant.FullName != fullName || grant.UserType != userType {
		// The approved candidate is immutable and is retained so the correct
		// identity can still apply before expiry. Zero writes and no state
		// change happen here.
		return Candidate{}, ErrIdentityConflict
	}
	consumed := *grant
	c.cand, c.grant = nil, nil
	c.signalLocked()
	return consumed, nil
}

// expireLocked clears an expired candidate/grant and reports whether one was
// cleared. The caller must hold the mutex.
func (c *Coordinator) expireLocked() bool {
	if c.cand == nil {
		return false
	}
	if c.now().Before(c.cand.ExpiresAt) {
		return false
	}
	c.cand, c.grant = nil, nil
	c.signalLocked()
	return true
}

// signalLocked wakes every waiter and installs a fresh change channel. The
// caller must hold the mutex.
func (c *Coordinator) signalLocked() {
	close(c.changed)
	c.changed = make(chan struct{})
}
