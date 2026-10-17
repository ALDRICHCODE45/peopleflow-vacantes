package pipelineconfig

import "errors"

var ErrStructureLocked = errors.New("pipeline structure requires empty pipeline")

// SameStructure deliberately ignores names; identities, kinds and order stay fixed.
func (c Configuration) SameStructure(other Configuration) bool {
	if len(c.Stages) != len(other.Stages) || c.Exit.ID != other.Exit.ID || c.Exit.Kind != other.Exit.Kind {
		return false
	}
	for i, s := range c.Stages {
		if s.ID != other.Stages[i].ID || s.Kind != other.Stages[i].Kind {
			return false
		}
	}
	return true
}
