//go:build integration

package main

import (
	"crypto/sha256"
	"testing"
)

// Independent-verifier regression probes for B7b finish (S7, S9 persistence).

func TestPsychometricVerifierAttentionBoundary(t *testing.T) {
	f := assessmentSetup(t)
	finishConsent(t, f)
	in := finishAnswers(t, f)
	for _, p := range []int{48, 16, 32} {
		finishAnswer(t, f, &in, p, nil, nil)
	}
	before := sha256.Sum256([]byte(finishSnapshot(t, f)))
	for _, p := range []struct{ base, session string }{
		{f.public, ""}, {f.account, f.session},
	} {
		r := f.h.do(t, "POST", p.base+"/finish", "", p.session, nil)
		want := "{\"error\":\"psychometric assessment incomplete\",\"code\":\"incomplete\",\"data\":{\"missing_positions\":[16,32,48]}}\n"
		if r.status != 422 || string(r.body) != want {
			t.Fatalf("%d %s", r.status, r.body)
		}
		if sha256.Sum256([]byte(finishSnapshot(t, f))) != before {
			t.Fatal("rejection changed stored state")
		}
	}
}

func TestPsychometricVerifierMixedFinish(t *testing.T) {
	f := assessmentSetup(t)
	finishConsent(t, f)
	finishAnswers(t, f)
	start := make(chan struct{})
	out := make(chan draftFlowResponse, 2)
	for _, p := range []struct{ base, session string }{
		{f.public, ""}, {f.account, f.session},
	} {
		go func(base, session string) {
			<-start
			out <- f.h.do(t, "POST", base+"/finish", "", session, nil)
		}(p.base, p.session)
	}
	close(start)
	counts := map[int]int{}
	for range 2 {
		r := <-out
		counts[r.status]++
		if r.status == 200 {
			finishResponse(t, r)
		} else if r.status != 409 ||
			string(r.body) != "{\"error\":\"psychometric assessment finished\",\"code\":\"assessment_finished\"}\n" {
			t.Fatalf("%d %s", r.status, r.body)
		}
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatal(counts)
	}
	finishReject(t, f, f.public, "", 409,
		"assessment_finished", "psychometric assessment finished")
	finishReject(t, f, f.account, f.session, 409,
		"assessment_finished", "psychometric assessment finished")
}
