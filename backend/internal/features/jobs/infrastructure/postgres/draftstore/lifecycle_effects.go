package draftstore

import (
	"context"
	"encoding/json"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// LifecycleView reuses L1's view builder inside a composition caller's transaction.
// The caller must hold the parent draft lock, acquired before the process lock.
func (s *Store) LifecycleView(ctx context.Context, tx pgx.Tx, id uuid.UUID) (json.RawMessage, error) {
	view, _, err := readLifecycle(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	return json.Marshal(view)
}

// requireActiveProcess runs in a fresh statement AFTER the parent draft lock.
// L1 transitions hold that same lock through the process update and commit, so
// this cannot retain a pre-wait process snapshot. Never fold it into readDraft.
// Never-published drafts remain configurable.
func requireActiveProcess(ctx context.Context, tx pgx.Tx, id uuid.UUID) error {
	view, _, err := readLifecycle(ctx, tx, id)
	if err != nil {
		return err
	}
	if view.Process != nil && *view.Process == "finished" {
		return &lifecycle.ProcessFinished{Lifecycle: view}
	}
	return nil
}

func embedLifecycle(ctx context.Context, tx pgx.Tx, id uuid.UUID, body []byte) ([]byte, error) {
	view, _, err := readLifecycle(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	return renderWithLifecycle(body, view)
}

func renderWithLifecycle(body []byte, view lifecycle.View) ([]byte, error) {
	value, err := draftjson.Decode(body)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(view)
	if err != nil {
		return nil, err
	}
	embedded, err := draftjson.Decode(encoded)
	if err != nil {
		return nil, err
	}
	value.(map[string]any)["lifecycle"] = embedded
	return draftjson.EncodeValidatedValue(value)
}
