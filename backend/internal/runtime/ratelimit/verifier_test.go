package ratelimit

// Independent-verifier regression probes for B8 validation (S8): TTL expiry and
// renewal, non-answer preservation, sweep retention, full key capacity and
// concurrent settle/admit.

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestVerifierValidationBoundaries(t *testing.T) {
	now := time.Unix(100000, 0)
	a := NewAssessment(DefaultLimits(), nil, func() time.Time { return now })
	r, w := a.admit("token:v", "ip:a")
	if w != 0 {
		t.Fatal(w)
	}
	a.settle("token:v", "ip:a", r, outcomeKnown)
	now = now.Add(23 * time.Hour)
	a.settle("token:v", "ip:a", false, outcomeKnown)
	renewed := now.Add(24 * time.Hour)
	for _, o := range []outcome{outcomeOther, outcomeOther} {
		a.settle("token:v", "ip:a", false, o)
		if a.keys["token:v"].validUntil != renewed {
			t.Fatal("non-answer changed validation")
		}
	}
	now = renewed.Add(-time.Nanosecond)
	a.sweep(now)
	if a.keys["token:v"] == nil {
		t.Fatal("swept validated key")
	}
	now = renewed
	a.sweep(now)
	if a.keys["token:v"] != nil {
		t.Fatal("TTL boundary retained")
	}
	for _, status := range []int{0, 404, 500, 503} {
		if (&catalogRecorder{status: status}).outcome() != outcomeOther {
			t.Fatal(status)
		}
	}
}

func TestVerifierValidationCapacityAndRace(t *testing.T) {
	now := time.Unix(100000, 0)
	l := DefaultLimits()
	l.PerIP = 200000
	a := NewAssessment(l, nil, func() time.Time { return now })
	for i := 0; i < l.MaxKeys-1; i++ {
		key := fmt.Sprintf("token:%d", i)
		r, w := a.admit(key, "ip:a")
		if w != 0 {
			t.Fatalf("%d: %v", i, w)
		}
		a.settle(key, "ip:a", r, outcomeKnown)
	}
	now = now.Add(11 * time.Minute)
	r, w := a.admit("token:0", "ip:a")
	if w != 0 || r {
		t.Fatal("existing validated blocked", r, w)
	}
	a.settle("token:0", "ip:a", r, outcomeKnown)
	_, w = a.admit("token:new", "ip:a")
	if w != l.Window {
		t.Fatal("new key not fail closed", w)
	}
	if len(a.keys) != l.MaxKeys || a.keys["token:new"] != nil {
		t.Fatal("capacity")
	}
	_, w = a.admit("token:0", "ip:new")
	if w != l.Window {
		t.Fatal("new IP not fail closed", w)
	}
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, w := a.admit("token:0", "ip:a")
			if w != 0 {
				t.Error(w)
				return
			}
			a.settle("token:0", "ip:a", r, outcomeKnown)
		}()
	}
	wg.Wait()
	if len(a.keys) != l.MaxKeys || a.keys["ip:a"].pending != 0 {
		t.Fatal("race/cap")
	}
	a.settle("token:0", "ip:a", false, outcomeUnknown)
	if !a.keys["token:0"].validUntil.IsZero() {
		t.Fatal("not cleared")
	}
}
