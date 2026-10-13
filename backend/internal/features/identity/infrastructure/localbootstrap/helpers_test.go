package localbootstrap

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
)

// errVerifierReject is a stand-in for an invalid/expired token signature.
var errVerifierReject = errors.New("verifier rejected the token")

// fakeClock is a deterministic, race-safe clock shared by the handler and the
// coordinator under test.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func newFakeClock() *fakeClock {
	return &fakeClock{now: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// fakeVerifier records calls and returns a fixed result.
type fakeVerifier struct {
	mu     sync.Mutex
	claims security.Claims
	err    error
	calls  int
	tokens []string
}

func (v *fakeVerifier) Verify(_ context.Context, token string) (security.Claims, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.calls++
	v.tokens = append(v.tokens, token)
	return v.claims, v.err
}

func (v *fakeVerifier) callCount() int {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.calls
}

// fakeUserInfo records calls and returns a fixed result.
type fakeUserInfo struct {
	mu        sync.Mutex
	info      UserInfo
	err       error
	calls     int
	tokens    []string
	fetchHook func()
}

func (u *fakeUserInfo) Fetch(_ context.Context, token string) (UserInfo, error) {
	u.mu.Lock()
	u.calls++
	u.tokens = append(u.tokens, token)
	hook := u.fetchHook
	info, err := u.info, u.err
	u.mu.Unlock()
	if hook != nil {
		hook()
	}
	return info, err
}

func (u *fakeUserInfo) callCount() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.calls
}

// fakeCreator records the single creation attempt.
type fakeCreator struct {
	mu    sync.Mutex
	code  CreateCode
	err   error
	calls int
	last  CreateUserCommand
}

func (c *fakeCreator) Create(_ context.Context, cmd CreateUserCommand) (CreateCode, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls++
	c.last = cmd
	return c.code, c.err
}

func (c *fakeCreator) callCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.calls
}

func (c *fakeCreator) lastCommand() CreateUserCommand {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.last
}
