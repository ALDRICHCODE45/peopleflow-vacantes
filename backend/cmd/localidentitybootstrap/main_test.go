// Tests for the localidentitybootstrap composition root. Every dependency is a
// fake: no real database, network, terminal or provider is contacted, and no
// real environment secret is read.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	localbootstrap "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/localbootstrap"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	testKey      = "0123456789abcdef0123456789abcdef"
	testVerifier = "test-access-token"
)

func testEnv(overrides map[string]string) map[string]string {
	env := map[string]string{
		localbootstrap.EnvEnabled:       "true",
		localbootstrap.EnvAppEnv:        "local",
		localbootstrap.EnvAddr:          localbootstrap.DefaultAddr,
		localbootstrap.EnvKey:           testKey,
		localbootstrap.EnvUserType:      localbootstrap.RequiredUserType,
		localbootstrap.EnvCognitoDomain: "https://example.auth.us-east-1.amazoncognito.com",
		localbootstrap.EnvDatabaseURL:   "postgres://admin:not-a-real-secret@127.0.0.1:5432/local_db",
		localbootstrap.EnvJWTMode:       localbootstrap.JWTModeJWKS,
		localbootstrap.EnvJWTIssuer:     "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_EXAMPLE",
		localbootstrap.EnvJWTClientID:   "example-client-id",
		localbootstrap.EnvJWTTokenUse:   localbootstrap.JWSTokenUse,
	}
	for k, v := range overrides {
		if v == "" {
			delete(env, k)
			continue
		}
		env[k] = v
	}
	return env
}

func getenvFor(env map[string]string) func(string) string {
	return func(key string) string { return env[key] }
}

// fakePool records the pool lifecycle without touching Postgres.
type fakePool struct {
	pingErr    error
	pingCalls  int32
	closeCalls int32
}

func (p *fakePool) Ping(context.Context) error { atomic.AddInt32(&p.pingCalls, 1); return p.pingErr }
func (p *fakePool) Close()                     { atomic.AddInt32(&p.closeCalls, 1) }
func (p *fakePool) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}
func (p *fakePool) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("fakePool: query not supported")
}
func (p *fakePool) QueryRow(context.Context, string, ...any) pgx.Row { return nil }

var _ Pool = (*fakePool)(nil)

// fakeTerminal is a scriptable private terminal.
type fakeTerminal struct {
	interactive bool
	lines       chan string
	mu          sync.Mutex
	prompts     []string
	closeOnce   sync.Once
	// readDelay holds each line back, as a slow operator or a loaded
	// scheduler would, so tests cannot depend on approval being instant.
	readDelay time.Duration
}

func newFakeTerminal() *fakeTerminal {
	return &fakeTerminal{interactive: true, lines: make(chan string, 4)}
}

func (t *fakeTerminal) IsInteractive() bool { return t.interactive }

func (t *fakeTerminal) ShowPrompt(prompt string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.prompts = append(t.prompts, prompt)
	return nil
}

func (t *fakeTerminal) ReadLine() (string, error) {
	line, ok := <-t.lines
	if !ok {
		return "", io.EOF
	}
	time.Sleep(t.readDelay)
	return line, nil
}

// Close unblocks a blocked ReadLine exactly once, as Run does on shutdown.
func (t *fakeTerminal) Close() error {
	t.closeOnce.Do(func() { close(t.lines) })
	return nil
}

func (t *fakeTerminal) promptText() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return strings.Join(t.prompts, "")
}

// spy is the recording Runtime state for one test.
type spy struct {
	openPoolCalls    atomic.Int32
	listenCalls      atomic.Int32
	verifierCalls    atomic.Int32
	userInfoCalls    atomic.Int32
	creatorCalls     atomic.Int32
	newTerminalCalls atomic.Int32

	pool     *fakePool
	terminal *fakeTerminal
	listenCh chan string
	creator  *fakeCreator

	stdout bytes.Buffer
}

// fakeVerifier always accepts the token and returns a fixed subject.
type fakeVerifier struct {
	sub   string
	calls *atomic.Int32
}

func (v *fakeVerifier) Verify(_ context.Context, _ string) (security.Claims, error) {
	if v.calls != nil {
		v.calls.Add(1)
	}
	return security.Claims{Subject: v.sub}, nil
}

// fakeUserInfo returns the matching profile.
type fakeUserInfo struct {
	info  localbootstrap.UserInfo
	calls *atomic.Int32
}

func (u *fakeUserInfo) Fetch(_ context.Context, _ string) (localbootstrap.UserInfo, error) {
	if u.calls != nil {
		u.calls.Add(1)
	}
	return u.info, nil
}

// fakeCreator records the single creation attempt.
type fakeCreator struct {
	mu    sync.Mutex
	code  localbootstrap.CreateCode
	err   error
	calls int32
}

func (c *fakeCreator) Create(context.Context, localbootstrap.CreateUserCommand) (localbootstrap.CreateCode, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls++
	return c.code, c.err
}

func newSpy(t *testing.T) *spy {
	t.Helper()
	return &spy{
		pool:     &fakePool{},
		terminal: newFakeTerminal(),
		listenCh: make(chan string, 1),
		creator:  &fakeCreator{code: localbootstrap.CreateCodeCreated},
	}
}

// runtime builds the injected Runtime. The terminal and CLI seams are
// overridable by the caller before calling.
func (s *spy) runtime(env map[string]string) Runtime {
	return Runtime{
		Getenv: getenvFor(env),
		Clock:  time.Now,
		OpenPool: func(context.Context, string) (Pool, error) {
			s.openPoolCalls.Add(1)
			return s.pool, nil
		},
		NewVerifier: func(func(string) string) (security.Verifier, error) {
			s.verifierCalls.Add(1)
			return &fakeVerifier{sub: "sub-1", calls: &s.verifierCalls}, nil
		},
		NewUserInfo: func(string, time.Duration) localbootstrap.UserInfoClient {
			s.userInfoCalls.Add(1)
			return &fakeUserInfo{
				info:  localbootstrap.UserInfo{Subject: "sub-1", Email: "user@example.com", FullName: "Ada Lovelace"},
				calls: &s.userInfoCalls,
			}
		},
		NewCreator: func(Pool) localbootstrap.UserCreator {
			s.creatorCalls.Add(1)
			return s.creator
		},
		NewTerminal: func() (localbootstrap.Terminal, error) {
			s.newTerminalCalls.Add(1)
			return s.terminal, nil
		},
		Listen: func(network, _ string) (net.Listener, error) {
			s.listenCalls.Add(1)
			ln, err := net.Listen(network, "127.0.0.1:0")
			if err != nil {
				return nil, err
			}
			s.listenCh <- ln.Addr().String()
			return ln, nil
		},
		Stdout: &s.stdout,
		Stderr: io.Discard,
	}
}

func (s *spy) creatorCallCount() int {
	return int(atomic.LoadInt32(&s.creator.calls))
}

func TestUsage(t *testing.T) {
	var buf bytes.Buffer
	Usage(&buf)
	out := buf.String()
	for _, want := range []string{
		"IDENTITY_LOCAL_BOOTSTRAP_ENABLED",
		"IDENTITY_LOCAL_BOOTSTRAP_KEY",
		"IDENTITY_LOCAL_BOOTSTRAP_ADDR",
		"APP_ENV=local",
		"recruiter",
		"approval",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("Usage does not mention %q", want)
		}
	}
	if strings.Contains(out, testKey) {
		t.Errorf("Usage leaked the bridge key")
	}
}

func TestRun_DisabledByDefault(t *testing.T) {
	s := newSpy(t)
	env := testEnv(map[string]string{localbootstrap.EnvEnabled: ""})

	if err := Run(t.Context(), s.runtime(env)); err != nil {
		t.Fatalf("Run(disabled) = %v, want nil", err)
	}
	if s.openPoolCalls.Load() != 0 || s.listenCalls.Load() != 0 || s.verifierCalls.Load() != 0 || s.newTerminalCalls.Load() != 0 {
		t.Errorf("disabled run created dependencies: pool=%d listen=%d verifier=%d terminal=%d",
			s.openPoolCalls.Load(), s.listenCalls.Load(), s.verifierCalls.Load(), s.newTerminalCalls.Load())
	}
	if !strings.Contains(s.stdout.String(), "disabled") {
		t.Errorf("disabled notice missing from stdout: %q", s.stdout.String())
	}
}

func TestRun_RejectsInvalidConfigurationBeforeDependencies(t *testing.T) {
	tests := []struct {
		name string
		env  map[string]string
	}{
		{name: "non local app env", env: testEnv(map[string]string{localbootstrap.EnvAppEnv: "production"})},
		{name: "missing app env", env: testEnv(map[string]string{localbootstrap.EnvAppEnv: ""})},
		{name: "short bridge key", env: testEnv(map[string]string{localbootstrap.EnvKey: "short"})},
		{name: "candidate user type", env: testEnv(map[string]string{localbootstrap.EnvUserType: "candidate"})},
		{name: "remote database target", env: testEnv(map[string]string{localbootstrap.EnvDatabaseURL: "postgres://u@db.example.com:5432/local_db"})},
		{name: "pem jwt mode", env: testEnv(map[string]string{localbootstrap.EnvJWTMode: "pem"})},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newSpy(t)
			err := Run(t.Context(), s.runtime(tt.env))
			if err == nil {
				t.Fatalf("Run returned nil error, want a safe rejection")
			}
			if s.openPoolCalls.Load() != 0 || s.listenCalls.Load() != 0 || s.verifierCalls.Load() != 0 {
				t.Errorf("invalid config created dependencies: pool=%d listen=%d verifier=%d",
					s.openPoolCalls.Load(), s.listenCalls.Load(), s.verifierCalls.Load())
			}
			if strings.Contains(err.Error(), testKey) {
				t.Errorf("error leaks the bridge key: %v", err)
			}
		})
	}
}

func TestRun_RequiresInteractivePrivateTerminal(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*spy)
	}{
		{name: "non interactive stdin", mutate: func(s *spy) { s.terminal.interactive = false }},
		{name: "terminal open failure", mutate: func(s *spy) { s.terminal = nil }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newSpy(t)
			if tt.mutate != nil {
				tt.mutate(s)
			}
			rt := s.runtime(testEnv(nil))
			if s.terminal == nil {
				rt.NewTerminal = func() (localbootstrap.Terminal, error) {
					return nil, errors.New("no controlling terminal")
				}
			}

			err := Run(t.Context(), rt)
			if err == nil {
				t.Fatalf("Run returned nil without an interactive terminal")
			}
			if s.listenCalls.Load() != 0 || s.openPoolCalls.Load() != 0 || s.verifierCalls.Load() != 0 {
				t.Errorf("non-interactive run created dependencies: listen=%d pool=%d verifier=%d",
					s.listenCalls.Load(), s.openPoolCalls.Load(), s.verifierCalls.Load())
			}
		})
	}
}

func TestRun_RejectPathExitsWithoutWriting(t *testing.T) {
	s := newSpy(t)
	s.terminal.lines <- "reject"
	rt := s.runtime(testEnv(nil))

	done := make(chan error, 1)
	go func() { done <- Run(t.Context(), rt) }()

	addr := waitForAddr(t, s.listenCh)
	stageOnce(t, addr, nil)

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run(reject) = %v, want a safe nil exit", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not exit after reject")
	}
	if s.creatorCallCount() != 0 {
		t.Errorf("creator called %d times on the reject path, want 0", s.creatorCallCount())
	}
}

func TestRun_OneShotCreateThenExit(t *testing.T) {
	s := newSpy(t)
	rt := s.runtime(testEnv(nil))

	done := make(chan error, 1)
	go func() { done <- Run(t.Context(), rt) }()

	s.terminal.readDelay = 200 * time.Millisecond
	addr := waitForAddr(t, s.listenCh)
	code := stageOnce(t, addr, nil)
	s.terminal.lines <- "approve " + code

	if status, body := applyWhenApproved(t, addr, code); status != http.StatusOK {
		t.Fatalf("apply status = %d, want 200 (body %q)", status, body)
	} else if body != `{"ok":true,"code":"created"}` {
		t.Fatalf("apply body = %q", body)
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run(create) = %v, want nil", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not exit after the one-shot apply")
	}

	if s.creatorCallCount() != 1 {
		t.Errorf("creator called %d times, want exactly 1", s.creatorCallCount())
	}
	if atomic.LoadInt32(&s.pool.pingCalls) != 1 || atomic.LoadInt32(&s.pool.closeCalls) != 1 {
		t.Errorf("pool ping=%d close=%d, want exactly one each", s.pool.pingCalls, s.pool.closeCalls)
	}
	if strings.Contains(s.stdout.String(), testKey) {
		t.Errorf("stdout leaked the bridge key: %q", s.stdout.String())
	}
}

// failingTerminal exposes read completion independently from resource closure.
type failingTerminal struct {
	failure    chan error
	readDone   chan struct{}
	prompted   chan struct{}
	closeCalls atomic.Int32
	promptOnce sync.Once
}

func (f *failingTerminal) IsInteractive() bool { return true }
func (f *failingTerminal) ShowPrompt(string) error {
	f.promptOnce.Do(func() { close(f.prompted) })
	return nil
}
func (f *failingTerminal) ReadLine() (string, error) {
	defer close(f.readDone)
	return "", <-f.failure
}
func (f *failingTerminal) Close() error {
	f.closeCalls.Add(1)
	return nil // ReadLine has already returned on every tested path.
}

func TestRun_TerminalReadFailure(t *testing.T) {
	for _, staged := range []bool{false, true} {
		for _, readErr := range []error{io.EOF, errors.New("private raw read failure")} {
			name := "before_stage/" + readErr.Error()
			if staged {
				name = "after_stage/" + readErr.Error()
			}
			t.Run(name, func(t *testing.T) {
				s := newSpy(t)
				term := &failingTerminal{failure: make(chan error, 1), readDone: make(chan struct{}), prompted: make(chan struct{})}
				rt := s.runtime(testEnv(nil))
				rt.NewTerminal = func() (localbootstrap.Terminal, error) { return term, nil }
				var stderr bytes.Buffer
				rt.Stderr = &stderr
				ctx, cancel := context.WithCancel(t.Context())
				defer cancel()
				done := make(chan error, 1)
				go func() { done <- Run(ctx, rt) }()
				addr := waitForAddr(t, s.listenCh)
				if staged {
					stageOnce(t, addr, nil)
					select {
					case <-term.prompted:
					case <-time.After(time.Second):
						t.Fatal("no approval prompt")
					}
				}
				term.failure <- readErr
				select {
				case err := <-done:
					if err == nil || err.Error() != "local bootstrap: the private terminal closed before approval" {
						t.Errorf("Run error = %v, want sanitized terminal closure", err)
					}
				case <-time.After(time.Second):
					cancel()
					select {
					case <-done:
					case <-time.After(time.Second):
						t.Fatal("cancellation did not join Run")
					}
					t.Fatal("terminal read failure did not terminate approval wait")
				}
				select {
				case <-term.readDone:
				default:
					t.Error("reader did not exit")
				}
				if term.closeCalls.Load() != 1 || atomic.LoadInt32(&s.pool.closeCalls) != 1 || s.creatorCallCount() != 0 {
					t.Errorf("terminal closes=%d pool closes=%d creates=%d", term.closeCalls.Load(), s.pool.closeCalls, s.creatorCallCount())
				}
				want := "localidentitybootstrap: listening on " + addr + " (scope: users-only, user_type: recruiter)\n"
				if s.stdout.String() != want || stderr.String() != "" {
					t.Error("unexpected public output")
				}
			})
		}
	}
}

func waitForAddr(t *testing.T, ch chan string) string {
	t.Helper()
	select {
	case addr := <-ch:
		return addr
	case <-time.After(5 * time.Second):
		t.Fatal("listener address was not reported")
		return ""
	}
}

func stageOnce(t *testing.T, addr string, mutate func(*http.Request)) string {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, "http://"+addr+"/stage", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("new stage request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Local-Bootstrap-Key", testKey)
	req.Header.Set("Authorization", "Bearer "+testVerifier)
	if mutate != nil {
		mutate(req)
	}
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		t.Fatalf("stage request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("stage status = %d, want 202 (body %q)", resp.StatusCode, body)
	}
	var parsed struct {
		OperationCode string `json:"operation_code"`
	}
	body, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("stage body: %v (%q)", err, body)
	}
	if len(parsed.OperationCode) != 26 {
		t.Fatalf("stage operation_code = %q, want 26 chars", parsed.OperationCode)
	}
	return parsed.OperationCode
}

// applyWhenApproved applies once the operator approval is armed. The
// terminal line is handled by another goroutine, so an apply sent right after
// it may still see 409 approval_required; that answer consumes nothing
// (CheckApproval only reads state), so retrying until it changes is safe.
func applyWhenApproved(t *testing.T, addr, code string) (int, string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		status, body := applyOnce(t, addr, code)
		if status != http.StatusConflict || body != `{"ok":false,"code":"approval_required"}` || time.Now().After(deadline) {
			return status, body
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func applyOnce(t *testing.T, addr, code string) (int, string) {
	t.Helper()
	body := `{"operation_code":"` + code + `"}`
	req, err := http.NewRequest(http.MethodPost, "http://"+addr+"/apply", strings.NewReader(body))
	if err != nil {
		t.Fatalf("new apply request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Local-Bootstrap-Key", testKey)
	req.Header.Set("Authorization", "Bearer "+testVerifier)
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		t.Fatalf("apply request: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(raw)
}
