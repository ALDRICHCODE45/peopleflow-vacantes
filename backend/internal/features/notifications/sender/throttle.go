package sender

import (
	"context"
	"sync"
	"time"
)

// Throttle hands out the right to send one email; Wait blocks until it is
// granted or ctx ends (then it returns ctx's error and nothing is sent).
type Throttle interface {
	Wait(ctx context.Context) error
}

// Bucket is the per-instance throttle of §Sender: NOTIFICATIONS_EMAIL_MAX_PER_SECOND
// emails per second, paced one every 1/rate with a burst of one, so no
// one-second window ever exceeds the rate (the SES sandbox limit is per
// second) and idle time never accumulates a burst. The global rate is the
// rate × instances (Q5).
type Bucket struct {
	mu       sync.Mutex
	interval time.Duration
	next     time.Time
	now      func() time.Time
	sleep    func(ctx context.Context, d time.Duration) error
}

// NewBucket paces at perSecond (≤ 0 means 1, the default); nil now / sleep
// mean the real clock.
func NewBucket(perSecond int, now func() time.Time, sleep func(ctx context.Context, d time.Duration) error) *Bucket {
	if perSecond <= 0 {
		perSecond = 1
	}
	if now == nil {
		now = time.Now
	}
	if sleep == nil {
		sleep = sleepCtx
	}
	return &Bucket{interval: time.Second / time.Duration(perSecond), now: now, sleep: sleep}
}

// Wait reserves the next slot and sleeps until it.
func (b *Bucket) Wait(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	b.mu.Lock()
	now := b.now()
	at := b.next
	if at.Before(now) {
		at = now
	}
	b.next = at.Add(b.interval)
	b.mu.Unlock()
	if d := at.Sub(now); d > 0 {
		return b.sleep(ctx, d)
	}
	return nil
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
