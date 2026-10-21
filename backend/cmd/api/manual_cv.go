package main

import (
	"context"
	"errors"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/cvs"
	cvstorage "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/storage"
)

// Cross-feature CV policy is composed here, not in applications infrastructure.
type manualCVInspector struct{}

func (manualCVInspector) Inspect(name string, content []byte) (string, error) {
	mime, err := cvs.Inspect(name, content)
	switch {
	case errors.Is(err, cvs.ErrContentMismatch):
		err = app.ErrManualCVContentMismatch
	case errors.Is(err, cvs.ErrUnsupportedType):
		err = app.ErrManualCVUnsupportedType
	case errors.Is(err, cvs.ErrTooLarge):
		err = app.ErrManualCVTooLarge
	}
	return mime, err
}

type manualCVStorage struct{ local *cvstorage.Local }

func (s manualCVStorage) Put(content []byte) (string, error) {
	if s.local == nil {
		return "", app.ErrStorageUnavailable
	}
	return s.local.Put(context.Background(), content)
}
func (s manualCVStorage) Delete(key string) error {
	if s.local == nil {
		return app.ErrStorageUnavailable
	}
	// Compensation must survive cancellation of the originating HTTP request.
	return s.local.Delete(context.Background(), key)
}

var _ app.ManualCVInspector = manualCVInspector{}
var _ app.ManualFileStorage = manualCVStorage{}
