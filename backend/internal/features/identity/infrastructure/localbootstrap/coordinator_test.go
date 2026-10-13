package localbootstrap

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
)

func testCandidate(t *testing.T, clock *fakeClock) Candidate {
	t.Helper()
	return Candidate{
		Subject:       "sub-1",
		Email:         "user@example.com",
		FullName:      "Ada Lovelace",
		UserType:      valueobjects.UserRecruiter,
		Database:      DatabaseTarget{Host: "127.0.0.1", Port: "5432", Name: "local_db"},
		OperationCode: "OPERATIONCODE1234567890ABCDE",
		ExpiresAt:     clock.Now().Add(OperationTTL),
	}
}

func TestNewOperationCode(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 64; i++ {
		code, err := NewOperationCode()
		if err != nil {
			t.Fatalf("NewOperationCode: %v", err)
		}
		if len(code) != 26 {
			t.Fatalf("code %q length = %d, want 26 (128-bit unpadded base32)", code, len(code))
		}
		if code != strings.ToUpper(code) {
			t.Fatalf("code %q is not uppercase", code)
		}
		if !validOperationCode(code) {
			t.Fatalf("code %q is not a valid 16-byte base32 value", code)
		}
		if seen[code] {
			t.Fatalf("code %q repeated; crypto randomness expected", code)
		}
		seen[code] = true
	}
}

func TestCoordinator_Stage_RejectsPendingWithoutOverwrite(t *testing.T) {
	clock := newFakeClock()
	c := NewCoordinator(clock.Now)
	first := testCandidate(t, clock)

	if err := c.Stage(first); err != nil {
		t.Fatalf("first Stage: %v", err)
	}
	second := first
	second.OperationCode = "SECONDOPERATIONCODE12345678"
	second.Email = "other@example.com"

	err := c.Stage(second)
	if !errors.Is(err, ErrStagePending) {
		t.Fatalf("second Stage error = %v, want ErrStagePending", err)
	}
	got, err := c.WaitForCandidate(context.Background())
	if err != nil {
		t.Fatalf("WaitForCandidate: %v", err)
	}
	if got.OperationCode != first.OperationCode || got.Email != first.Email {
		t.Errorf("candidate was overwritten: %+v", got)
	}
}

func TestCoordinator_Stage_ReplacesExpiredCandidate(t *testing.T) {
	clock := newFakeClock()
	c := NewCoordinator(clock.Now)
	if err := c.Stage(testCandidate(t, clock)); err != nil {
		t.Fatalf("first Stage: %v", err)
	}
	clock.Advance(OperationTTL + time.Second)
	if c.Pending() {
		t.Fatalf("Pending() = true after expiry")
	}
	next := testCandidate(t, clock)
	next.OperationCode = "NEXTOPERATIONCODE1234567890AB"
	if err := c.Stage(next); err != nil {
		t.Fatalf("Stage after expiry: %v", err)
	}
	got, err := c.WaitForCandidate(context.Background())
	if err != nil {
		t.Fatalf("WaitForCandidate: %v", err)
	}
	if got.OperationCode != next.OperationCode {
		t.Errorf("candidate = %+v, want the replacement", got)
	}
}

func TestCoordinator_Stage_RejectsAlreadyExpiredCandidate(t *testing.T) {
	clock := newFakeClock()
	c := NewCoordinator(clock.Now)
	expired := testCandidate(t, clock)
	expired.ExpiresAt = clock.Now().Add(-time.Second)
	if err := c.Stage(expired); !errors.Is(err, ErrOperationExpired) {
		t.Fatalf("Stage(expired) error = %v, want ErrOperationExpired", err)
	}
}

func TestCoordinator_WaitForCandidate(t *testing.T) {
	clock := newFakeClock()
	c := NewCoordinator(clock.Now)
	want := testCandidate(t, clock)

	result := make(chan Candidate, 1)
	go func() {
		got, err := c.WaitForCandidate(context.Background())
		if err != nil {
			result <- Candidate{Email: "error:" + err.Error()}
			return
		}
		result <- got
	}()

	// Give the waiter a chance to block, then stage.
	time.Sleep(10 * time.Millisecond)
	if err := c.Stage(want); err != nil {
		t.Fatalf("Stage: %v", err)
	}

	select {
	case got := <-result:
		if got.OperationCode != want.OperationCode {
			t.Fatalf("WaitForCandidate = %+v, want %+v", got, want)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("WaitForCandidate did not unblock after Stage")
	}
}

func TestCoordinator_WaitForCandidate_ContextCancel(t *testing.T) {
	clock := newFakeClock()
	c := NewCoordinator(clock.Now)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.WaitForCandidate(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("WaitForCandidate error = %v, want context.Canceled", err)
	}
}

func TestCoordinator_Approve(t *testing.T) {
	clock := newFakeClock()
	c := NewCoordinator(clock.Now)
	cand := testCandidate(t, clock)
	if err := c.Stage(cand); err != nil {
		t.Fatalf("Stage: %v", err)
	}

	if err := c.Approve("WRONGOPERATIONCODE123456789"); !errors.Is(err, ErrCodeMismatch) {
		t.Fatalf("Approve(wrong) error = %v, want ErrCodeMismatch", err)
	}
	if err := c.CheckApproval(cand.OperationCode); !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("CheckApproval before approval error = %v, want ErrApprovalRequired", err)
	}
	if err := c.Approve(cand.OperationCode); err != nil {
		t.Fatalf("Approve(correct): %v", err)
	}
	if err := c.CheckApproval(cand.OperationCode); err != nil {
		t.Fatalf("CheckApproval after approval: %v", err)
	}
	if err := c.CheckApproval("OTHEROPERATIONCODE1234567890"); !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("CheckApproval(mismatch) error = %v, want ErrApprovalRequired", err)
	}
}

func TestCoordinator_Approve_AfterExpiry(t *testing.T) {
	clock := newFakeClock()
	c := NewCoordinator(clock.Now)
	cand := testCandidate(t, clock)
	if err := c.Stage(cand); err != nil {
		t.Fatalf("Stage: %v", err)
	}
	clock.Advance(OperationTTL + time.Second)
	if err := c.Approve(cand.OperationCode); !errors.Is(err, ErrOperationExpired) {
		t.Fatalf("Approve after expiry error = %v, want ErrOperationExpired", err)
	}
	if c.Pending() {
		t.Fatalf("Pending() = true after expired approval")
	}
}

func TestCoordinator_Reject_ClearsState(t *testing.T) {
	clock := newFakeClock()
	c := NewCoordinator(clock.Now)
	cand := testCandidate(t, clock)
	if err := c.Stage(cand); err != nil {
		t.Fatalf("Stage: %v", err)
	}
	if err := c.Approve(cand.OperationCode); err != nil {
		t.Fatalf("Approve: %v", err)
	}
	c.Reject()
	if err := c.CheckApproval(cand.OperationCode); !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("CheckApproval after Reject error = %v, want ErrApprovalRequired", err)
	}
}

func TestCoordinator_Consume(t *testing.T) {
	clock := newFakeClock()
	c := NewCoordinator(clock.Now)
	cand := testCandidate(t, clock)
	if err := c.Stage(cand); err != nil {
		t.Fatalf("Stage: %v", err)
	}
	if err := c.Approve(cand.OperationCode); err != nil {
		t.Fatalf("Approve: %v", err)
	}

	got, err := c.Consume(cand.OperationCode, cand.Subject, cand.Email, cand.FullName, cand.UserType)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if got.Email != cand.Email || got.Subject != cand.Subject {
		t.Errorf("Consume returned %+v, want the immutable candidate", got)
	}

	// Replay is a zero-write rejection.
	if _, err := c.Consume(cand.OperationCode, cand.Subject, cand.Email, cand.FullName, cand.UserType); !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("replayed Consume error = %v, want ErrApprovalRequired", err)
	}
}

func TestCoordinator_Consume_IdentityMismatch(t *testing.T) {
	tests := []struct {
		name     string
		subject  string
		email    string
		fullName string
	}{
		{name: "different subject", subject: "sub-2", email: "user@example.com", fullName: "Ada Lovelace"},
		{name: "different email", subject: "sub-1", email: "other@example.com", fullName: "Ada Lovelace"},
		{name: "different name", subject: "sub-1", email: "user@example.com", fullName: "Grace Hopper"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clock := newFakeClock()
			c := NewCoordinator(clock.Now)
			cand := testCandidate(t, clock)
			if err := c.Stage(cand); err != nil {
				t.Fatalf("Stage: %v", err)
			}
			if err := c.Approve(cand.OperationCode); err != nil {
				t.Fatalf("Approve: %v", err)
			}

			_, err := c.Consume(cand.OperationCode, tt.subject, tt.email, tt.fullName, cand.UserType)
			if !errors.Is(err, ErrIdentityConflict) {
				t.Fatalf("Consume error = %v, want ErrIdentityConflict", err)
			}
			// The grant must survive so the correct identity can still apply.
			if err := c.CheckApproval(cand.OperationCode); err != nil {
				t.Fatalf("CheckApproval after mismatch = %v, want the armed grant retained", err)
			}
		})
	}
}

func TestCoordinator_Consume_WrongTypeMismatch(t *testing.T) {
	clock := newFakeClock()
	c := NewCoordinator(clock.Now)
	cand := testCandidate(t, clock)
	if err := c.Stage(cand); err != nil {
		t.Fatalf("Stage: %v", err)
	}
	if err := c.Approve(cand.OperationCode); err != nil {
		t.Fatalf("Approve: %v", err)
	}
	_, err := c.Consume(cand.OperationCode, cand.Subject, cand.Email, cand.FullName, valueobjects.UserCandidate)
	if !errors.Is(err, ErrIdentityConflict) {
		t.Fatalf("Consume(user type mismatch) error = %v, want ErrIdentityConflict", err)
	}
}

func TestCoordinator_Consume_Expired(t *testing.T) {
	clock := newFakeClock()
	c := NewCoordinator(clock.Now)
	cand := testCandidate(t, clock)
	if err := c.Stage(cand); err != nil {
		t.Fatalf("Stage: %v", err)
	}
	if err := c.Approve(cand.OperationCode); err != nil {
		t.Fatalf("Approve: %v", err)
	}
	clock.Advance(OperationTTL + time.Second)
	if _, err := c.Consume(cand.OperationCode, cand.Subject, cand.Email, cand.FullName, cand.UserType); !errors.Is(err, ErrOperationExpired) {
		t.Fatalf("Consume after expiry error = %v, want ErrOperationExpired", err)
	}
}

func TestCoordinator_ConcurrentStages(t *testing.T) {
	clock := newFakeClock()
	c := NewCoordinator(clock.Now)

	const workers = 8
	var wg sync.WaitGroup
	var mu sync.Mutex
	successes := 0
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		go func(i int) {
			defer wg.Done()
			cand := testCandidate(t, clock)
			cand.OperationCode = "CONCURRENTSTAGE" + strings.Repeat(string(rune('A'+i)), 10)
			if err := c.Stage(cand); err == nil {
				mu.Lock()
				successes++
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()

	if successes != 1 {
		t.Fatalf("concurrent stages succeeded %d times, want exactly 1", successes)
	}
}

func TestCoordinator_ConcurrentConsume(t *testing.T) {
	clock := newFakeClock()
	c := NewCoordinator(clock.Now)
	cand := testCandidate(t, clock)
	if err := c.Stage(cand); err != nil {
		t.Fatalf("Stage: %v", err)
	}
	if err := c.Approve(cand.OperationCode); err != nil {
		t.Fatalf("Approve: %v", err)
	}

	const workers = 8
	var wg sync.WaitGroup
	var mu sync.Mutex
	successes := 0
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			if _, err := c.Consume(cand.OperationCode, cand.Subject, cand.Email, cand.FullName, cand.UserType); err == nil {
				mu.Lock()
				successes++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	if successes != 1 {
		t.Fatalf("concurrent consumes succeeded %d times, want exactly 1", successes)
	}
}
