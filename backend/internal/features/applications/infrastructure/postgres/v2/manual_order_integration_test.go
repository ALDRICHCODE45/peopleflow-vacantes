//go:build integration

package v2

import (
	"context"
	"errors"
	"testing"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestManualCreateValidationOrdering(t *testing.T) {
	f := setupManualIntake(t)
	duplicateExec(t, f.movementFixture, `UPDATE vacancy_processes SET status='closed',process_status='finished',lifecycle_version=lifecycle_version+1,closed_at=now(),process_finished_at=now() WHERE id=$1`, f.vacancy)
	in := f.input(pipelineconfig.Defaults(f.vacancy).Exit.ID)
	in = intakeChange(t, in, "candidate", map[string]any{})
	before := f.effects(t)
	_, err := f.create(in)
	var fields *board.ManualValidationError
	if !errors.As(err, &fields) || len(fields.Fields) < 3 {
		t.Fatal("all field errors must precede state and stage", err)
	}
	f.unchanged(t, before, 0)
	in = f.input(pipelineconfig.Defaults(f.vacancy).Exit.ID)
	_, err = f.create(in)
	var finished *board.ProcessFinished
	if !errors.As(err, &finished) {
		t.Fatal("state must precede stage", err)
	}
	f.unchanged(t, before, 0)
	// Authorization must win even over malformed input.
	in.Data = []byte("invalid JSON")
	_, err = f.board.CreateManual(context.Background(), f.company, uuid.New(), f.vacancy, in, f.inspect, f.files)
	if err == nil || errors.Is(err, board.ErrInvalidRequest) {
		t.Fatal("parsed unauthorized input", err)
	}
	f.unchanged(t, before, 0)
	if f.inspect.calls != 0 {
		t.Fatal("early rejection inspected file")
	}
}
