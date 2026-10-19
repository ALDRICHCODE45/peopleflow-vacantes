package pipelineconfig

import (
	"github.com/google/uuid"
	"testing"
)

func TestSameStructureAllowsOnlyRenames(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*Configuration)
		same   bool
	}{
		{"rename", func(c *Configuration) { c.Stages[1].Name = "Filter"; c.Exit.Name = "Outside" }, true},
		{"reorder", func(c *Configuration) { c.Stages[1], c.Stages[2] = c.Stages[2], c.Stages[1] }, false},
		{"add", func(c *Configuration) {
			c.Stages = append(c.Stages, Stage{ID: uuid.NewString(), Kind: "custom", Name: "Custom"})
		}, false},
		{"remove", func(c *Configuration) { c.Stages = c.Stages[:len(c.Stages)-1] }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := Defaults(uuid.New())
			b := Defaults(uuid.MustParse("11111111-1111-4111-8111-111111111111"))
			b = Configuration{Stages: append([]Stage{}, a.Stages...), Exit: a.Exit}
			tc.mutate(&b)
			if a.SameStructure(b) != tc.same {
				t.Fatal("wrong structure classification")
			}
		})
	}
}
