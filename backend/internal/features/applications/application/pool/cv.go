package pool

import (
	"context"
	"errors"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/google/uuid"
)

// CVWriter shares intake's inspection and private-storage ports. It never writes
// candidate-owned CV versions or library entries.
type CVWriter interface {
	CorrectCV(context.Context, uuid.UUID, uuid.UUID, string, uuid.UUID, uuid.UUID, string, board.ManualInput, board.ManualCVInspector, board.ManualFileStorage) (Detail, error)
}
type OriginalFileReader interface {
	OriginalFile(context.Context, uuid.UUID, string, uuid.UUID, uuid.UUID) (board.File, error)
}

func (s *Service) CorrectCV(ctx context.Context, company, actor uuid.UUID, kind string, id, pid uuid.UUID, etag string, input board.ManualInput, inspector board.ManualCVInspector, storage board.ManualFileStorage) (Detail, error) {
	writer, ok := s.reader.(CVWriter)
	if !ok {
		return Detail{}, errors.New("candidate CV writer unavailable")
	}
	return writer.CorrectCV(ctx, company, actor, kind, id, pid, etag, input, inspector, storage)
}
func (s *Service) OriginalFile(ctx context.Context, company uuid.UUID, kind string, id, pid uuid.UUID) (board.File, error) {
	reader, ok := s.reader.(OriginalFileReader)
	if !ok {
		return board.File{}, board.ErrNotFound
	}
	return reader.OriginalFile(ctx, company, kind, id, pid)
}
