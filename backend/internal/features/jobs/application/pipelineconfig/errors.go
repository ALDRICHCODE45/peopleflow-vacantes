package pipelineconfig

import "errors"

// ErrCutoffStageInUse prevents removing the stored delivery milestone.
var ErrCutoffStageInUse = errors.New("pipelineconfig: cutoff stage in use")
