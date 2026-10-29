package scoring

import "github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/content"

func quality(d content.Document, in Input) Quality {
	personality := map[int]bool{}
	attention := AttentionCounts{Total: len(d.Attention)}
	for _, a := range d.Attention {
		if in.Answers[a.Position] != a.Expected {
			attention.Misses++
		}
	}
	run, longest, last := 0, 0, 0
	for _, p := range d.Order {
		isAttention := false
		for _, a := range d.Attention {
			if a.Position == p.Position {
				isAttention = true
				break
			}
		}
		if isAttention {
			continue
		}
		personality[p.Position] = true
		v := in.Answers[p.Position]
		if v == last {
			run++
		} else {
			run = 1
			last = v
		}
		longest = max(longest, run)
	}
	type state struct {
		value    int
		answered bool
		elapsed  *int64
	}
	states := map[int]state{}
	changes := ChangeCounts{}
	for _, e := range in.Events {
		if !personality[e.Position] {
			continue
		}
		s := states[e.Position]
		if e.Value == nil {
			if s.value != 0 {
				changes.Clears++
			}
			s.value = 0
			s.elapsed = nil
		} else {
			if s.value != 0 && s.value != *e.Value {
				changes.ValueChanges++
			}
			if s.value == 0 && s.answered {
				changes.Reanswers++
			}
			s.value = *e.Value
			s.answered = true
			s.elapsed = e.ElapsedMS
		}
		states[e.Position] = s
	}
	changes.Total = changes.ValueChanges + changes.Clears + changes.Reanswers
	fast := FastCounts{Total: len(personality)}
	timingComplete := true
	for _, p := range d.Order {
		if !personality[p.Position] {
			continue
		}
		s := states[p.Position]
		if s.elapsed == nil || *s.elapsed < 0 || *s.elapsed > 3600000 {
			timingComplete = false
			continue
		}
		if *s.elapsed < int64(d.Quality.Signals[2].FastBelowMS) {
			fast.FastCount++
		}
	}
	counts := []any{attention, LongStringCounts{Run: longest}, fast, changes}
	values := []int{attention.Misses, longest, fast.FastCount, changes.Total}
	q := Quality{Tier: "tier.sin", Signals: []Signal{}}
	mild, strong := 0, 0
	for i, rule := range d.Quality.Signals {
		s := Signal{ID: rule.ID, Severity: "none", Counts: counts[i]}
		if i == 2 && !timingComplete || i == 3 && in.EventsIncomplete {
			s.Severity = "unknown"
			s.Counts = nil
			q.Partial = true
		} else if rule.StrongMin != nil && values[i] >= *rule.StrongMin {
			s.Severity = "strong"
			strong++
		} else if values[i] >= rule.MildMin {
			s.Severity = "mild"
			mild++
		}
		q.Signals = append(q.Signals, s)
	}
	if strong >= d.Quality.RelevantStrongMin || mild >= d.Quality.RelevantMildMin {
		q.Tier = "tier.relevantes"
	} else if mild == d.Quality.SomeMildCount {
		q.Tier = "tier.algunas"
	}
	return q
}
