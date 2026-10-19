package main

import (
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publicjobs"
	"github.com/google/uuid"
)

// Composition adapter reuses the safe screening projector and the canonical
// built-in stage identities, without introducing sibling feature dependencies.
type participationRules struct{}

func (participationRules) Screening(stored []byte) (app.Screening, error) {
	safe, err := publicjobs.BuildScreening(stored)
	if err != nil {
		return app.Screening{}, err
	}
	form := app.Screening{Revision: safe.Revision, Questions: make([]app.Question, len(safe.Questions))}
	for i, q := range safe.Questions {
		question := app.Question{ID: q.ID, Prompt: q.Prompt, Type: q.Type}
		if q.Options != nil {
			question.Options = make([]app.Option, len(q.Options))
			for j, o := range q.Options {
				question.Options[j] = app.Option{ID: o.ID, Label: o.Label}
			}
		}
		form.Questions[i] = question
	}
	return form, nil
}
func (participationRules) InitialStage(vacancy uuid.UUID) uuid.UUID {
	return uuid.MustParse(pipelineconfig.Defaults(vacancy).Stages[0].ID)
}
