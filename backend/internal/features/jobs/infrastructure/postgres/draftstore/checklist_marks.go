package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/checklist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var _ checklist.MarksStore = (*Store)(nil)

func (s *Store) GetChecklistMarks(ctx context.Context, companyID, actorID, id uuid.UUID) ([]checklist.Mark, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin checklist marks read: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := s.authorizeChecklist(ctx, tx, companyID, actorID, id); err != nil {
		return nil, err
	}
	c, _, err := readChecklist(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, 0, len(c.Criteria))
	for _, criterion := range c.Criteria {
		ids = append(ids, uuid.MustParse(criterion.ID))
	}
	rows, err := tx.Query(ctx, `SELECT m.participation_id,m.criterion_id,m.verdict,m.note,u.id,u.full_name,m.marked_at
 FROM participation_checklist_marks m JOIN process_participations p ON p.id=m.participation_id JOIN users u ON u.id=m.marked_by
 WHERE p.process_id=$1 AND m.criterion_id=ANY($2::uuid[]) ORDER BY m.participation_id,m.criterion_id`, id, ids)
	if err != nil {
		return nil, fmt.Errorf("read checklist marks: %w", err)
	}
	defer rows.Close()
	items := []checklist.Mark{}
	for rows.Next() {
		m, err := scanChecklistMark(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, m)
	}
	return items, rows.Err()
}

// Every mark mutation holds the draft lock before reading the process,
// checklist and participation. Concurrent replacements and mark writes thus
// serialize in the same order as lifecycle and pipeline mutations.
func (s *Store) beginChecklistMark(ctx context.Context, companyID, actorID, id, pid, cid uuid.UUID) (pgx.Tx, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin checklist mark write: %w", err)
	}
	fail := func(err error) (pgx.Tx, error) { _ = tx.Rollback(ctx); return nil, err }
	if _, err := s.authorizeChecklist(ctx, tx, companyID, actorID, id); err != nil {
		return fail(err)
	}
	if err := requireActiveProcess(ctx, tx, id); err != nil {
		return fail(err)
	}
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM process_participations WHERE process_id=$1 AND id=$2)`, id, pid).Scan(&exists); err != nil {
		return fail(err)
	}
	if !exists {
		return fail(drafts.ErrNotFound)
	}
	c, _, err := readChecklist(ctx, tx, id)
	if err != nil {
		return fail(err)
	}
	if !c.Has(cid.String()) {
		return fail(drafts.ErrNotFound)
	}
	return tx, nil
}

func (s *Store) PutChecklistMark(ctx context.Context, companyID, actorID, id, pid, cid uuid.UUID, body []byte) (checklist.Mark, error) {
	tx, err := s.beginChecklistMark(ctx, companyID, actorID, id, pid, cid)
	if err != nil {
		return checklist.Mark{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	input, err := checklist.DecodeMark(body)
	if err != nil {
		return checklist.Mark{}, err
	}
	previous, found, err := readChecklistMark(ctx, tx, pid, cid)
	if err != nil {
		return checklist.Mark{}, err
	}
	if found && previous.Verdict == input.Verdict && equalChecklistNote(previous.Note, input.Note) {
		return previous, nil
	}
	if _, err := tx.Exec(ctx, `INSERT INTO participation_checklist_marks(participation_id,criterion_id,verdict,note,marked_by,marked_at)
 VALUES($1,$2,$3,$4,$5,clock_timestamp()) ON CONFLICT(participation_id,criterion_id)
 DO UPDATE SET verdict=EXCLUDED.verdict,note=EXCLUDED.note,marked_by=EXCLUDED.marked_by,marked_at=EXCLUDED.marked_at`, pid, cid, input.Verdict, input.Note, actorID); err != nil {
		return checklist.Mark{}, fmt.Errorf("write checklist mark: %w", err)
	}
	if err := s.auditChecklistMark(ctx, tx, actorID, id, pid, cid, previous, found, &input); err != nil {
		return checklist.Mark{}, err
	}
	result, _, err := readChecklistMark(ctx, tx, pid, cid)
	if err != nil {
		return checklist.Mark{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return checklist.Mark{}, fmt.Errorf("commit checklist mark: %w", err)
	}
	return result, nil
}

func (s *Store) DeleteChecklistMark(ctx context.Context, companyID, actorID, id, pid, cid uuid.UUID) error {
	tx, err := s.beginChecklistMark(ctx, companyID, actorID, id, pid, cid)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	previous, found, err := readChecklistMark(ctx, tx, pid, cid)
	if err != nil {
		return err
	}
	if !found {
		return nil
	}
	if _, err := tx.Exec(ctx, `DELETE FROM participation_checklist_marks WHERE participation_id=$1 AND criterion_id=$2`, pid, cid); err != nil {
		return fmt.Errorf("delete checklist mark: %w", err)
	}
	if err := s.auditChecklistMark(ctx, tx, actorID, id, pid, cid, previous, true, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func scanChecklistMark(row pgx.Row) (checklist.Mark, error) {
	var m checklist.Mark
	err := row.Scan(&m.ParticipationID, &m.CriterionID, &m.Verdict, &m.Note, &m.MarkedBy.ID, &m.MarkedBy.FullName, &m.MarkedAt)
	return m, err
}
func readChecklistMark(ctx context.Context, tx pgx.Tx, pid, cid uuid.UUID) (checklist.Mark, bool, error) {
	m, err := scanChecklistMark(tx.QueryRow(ctx, `SELECT m.participation_id,m.criterion_id,m.verdict,m.note,u.id,u.full_name,m.marked_at FROM participation_checklist_marks m JOIN users u ON u.id=m.marked_by WHERE m.participation_id=$1 AND m.criterion_id=$2`, pid, cid))
	if errors.Is(err, pgx.ErrNoRows) {
		return checklist.Mark{}, false, nil
	}
	return m, err == nil, err
}
func equalChecklistNote(a, b *string) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}

func (s *Store) auditChecklistMark(ctx context.Context, tx pgx.Tx, actorID, id, pid, cid uuid.UUID, previous checklist.Mark, found bool, next *checklist.MarkInput) error {
	type snapshot struct {
		Verdict string  `json:"verdict"`
		Note    *string `json:"note"`
	}
	var old, newValue *snapshot
	if found {
		old = &snapshot{previous.Verdict, previous.Note}
	}
	if next != nil {
		newValue = &snapshot{next.Verdict, next.Note}
	}
	oldJSON, err := json.Marshal(old)
	if err != nil {
		return err
	}
	newJSON, err := json.Marshal(newValue)
	if err != nil {
		return err
	}
	event := audit.AuditEvent{ID: uuid.Must(uuid.NewV7()), ActorType: audit.ActorTypeUser, ActorID: &actorID, EventType: "ParticipationChecklistMarked", EntityType: "process_participation", EntityID: pid, Metadata: map[string]string{"vacancy_id": id.String(), "criterion_id": cid.String(), "previous": string(oldJSON), "new": string(newJSON)}}
	if err := s.audit.Append(ctx, tx, event); err != nil {
		return fmt.Errorf("co-write checklist mark audit: %w", err)
	}
	return nil
}
