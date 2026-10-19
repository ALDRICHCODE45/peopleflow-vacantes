package main

import (
	"context"
	"errors"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/draftstore"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"time"
)

// Composition bridge keeps participation views independent of jobs internals.
type movementContext struct{ store *draftstore.Store }

func (m movementContext) RecordDelivery(ctx context.Context, tx pgx.Tx, id, actor, stage uuid.UUID, at time.Time) error {
	return m.store.RecordDelivery(ctx, tx, id, actor, stage, at)
}
func (m movementContext) DeliverySummary(ctx context.Context, tx pgx.Tx, id uuid.UUID) (string, int64, int64, error) {
	return m.store.DeliverySummary(ctx, tx, id)
}

func movementContextError(err error) error {
	for _, pair := range [][2]error{
		{drafts.ErrNotFound, app.ErrNotFound}, {drafts.ErrUnauthenticated, app.ErrUnauthenticated},
		{drafts.ErrForbidden, app.ErrForbidden}, {drafts.ErrCompanyInactive, app.ErrCompanyInactive},
		{drafts.ErrCompanyNotActive, app.ErrCompanyNotActive},
	} {
		if errors.Is(err, pair[0]) {
			return pair[1]
		}
	}
	return err
}

func (m movementContext) Load(ctx context.Context, tx pgx.Tx, company, actor, id uuid.UUID) (app.Pipeline, error) {
	c, required, err := m.store.MovementContext(ctx, tx, company, actor, id)
	if err != nil {
		return app.Pipeline{}, movementContextError(err)
	}
	out := app.Pipeline{Required: required, Stages: make([]app.Stage, len(c.Stages)), Exit: app.Stage{ID: c.Exit.ID, Kind: c.Exit.Kind, Name: c.Exit.Name}}
	for i, s := range c.Stages {
		out.Stages[i] = app.Stage{ID: s.ID, Kind: s.Kind, Name: s.Name}
	}
	return out, nil
}
