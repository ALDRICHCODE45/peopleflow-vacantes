package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/invitations"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/content"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/scoring"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var _ invitations.ResultsStore = (*InvitationsStore)(nil)

func confirmedProfile(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*scoring.Profile, []byte, error) {
	p, version, err := read(ctx, tx, id)
	if err != nil || !p.Confirmed {
		return nil, nil, err
	}
	projection := &scoring.Profile{Version: strconv.FormatInt(version, 10), Competencies: []scoring.Requirement{}}
	for _, c := range p.Competencies {
		projection.Competencies = append(projection.Competencies, scoring.Requirement{CompetencyID: c.CompetencyID, Importance: c.Importance, DesiredBand: c.DesiredBand})
	}
	rendered, err := render(id, p, version)
	return projection, rendered.Body, err
}

// insertComparison is shared with finish: every snapshot retains the complete
// B2 output and full confirmed profile; wire projection never changes storage.
func insertComparison(ctx context.Context, tx pgx.Tx, iid uuid.UUID, at time.Time, c scoring.Comparison, profile []byte) (uuid.UUID, error) {
	snapshot, err := json.Marshal(c)
	if err != nil {
		return uuid.Nil, err
	}
	id := uuid.New()
	_, err = tx.Exec(ctx, `INSERT INTO psychometric_comparisons(id,invitation_id,profile_version,profile_snapshot,content_version,scoring_version,created_at,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, id, iid, c.ProfileVersion, profile, c.ContentVersion, c.ScoringVersion, at, snapshot)
	return id, err
}
func (s *InvitationsStore) GetResult(ctx context.Context, company, actor, id, iid uuid.UUID) (invitations.Result, error) {
	return s.employerResult(ctx, company, actor, id, iid, false)
}
func (s *InvitationsStore) CreateComparison(ctx context.Context, company, actor, id, iid uuid.UUID) (invitations.Result, error) {
	return s.employerResult(ctx, company, actor, id, iid, true)
}
func (s *InvitationsStore) employerResult(ctx context.Context, company, actor, id, iid uuid.UUID, write bool) (invitations.Result, error) {
	tx, _, err := s.begin(ctx, company, actor, id, write)
	if err != nil {
		return invitations.Result{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var pid uuid.UUID
	err = tx.QueryRow(ctx, `SELECT i.participation_id FROM psychometric_invitations i JOIN process_participations p ON p.id=i.participation_id WHERE i.id=$1 AND p.process_id=$2`, iid, id).Scan(&pid)
	if errors.Is(err, pgx.ErrNoRows) {
		err = invitations.ErrNotFound
	}
	if err != nil {
		return invitations.Result{}, err
	}
	if _, _, err = lockParticipation(ctx, tx, id, pid); err != nil {
		return invitations.Result{}, err
	}
	var finished *time.Time
	var purge time.Time
	var cv, sv string
	err = tx.QueryRow(ctx, `SELECT finished_at,purge_after,content_version,scoring_version FROM psychometric_invitations WHERE id=$1 FOR UPDATE`, iid).Scan(&finished, &purge, &cv, &sv)
	if err != nil {
		return invitations.Result{}, err
	}
	now, err := invitationNow(ctx, tx)
	if err != nil {
		return invitations.Result{}, err
	}
	if finished == nil || !now.Before(purge) {
		return invitations.Result{}, invitations.ErrNotFound
	}
	var raw []byte
	var at time.Time
	err = tx.QueryRow(ctx, `SELECT snapshot,finished_at FROM psychometric_results WHERE invitation_id=$1`, iid).Scan(&raw, &at)
	if errors.Is(err, pgx.ErrNoRows) {
		err = invitations.ErrNotFound
	}
	if err != nil {
		return invitations.Result{}, err
	}
	var stored scoring.Result
	if err = json.Unmarshal(raw, &stored); err != nil {
		return invitations.Result{}, err
	}
	var value any
	status := 200
	if write {
		p, profile, err := confirmedProfile(ctx, tx, id)
		if err != nil {
			return invitations.Result{}, err
		}
		if p == nil {
			return invitations.Result{}, invitations.ErrProfileUnconfirmed
		}
		artifact, err := content.Load(cv)
		if err != nil {
			return invitations.Result{}, err
		}
		if artifact.Snapshot().ScoringVersion != sv || stored.ContentVersion != cv || stored.ScoringVersion != sv {
			return invitations.Result{}, errors.New("psychometric result pin mismatch")
		}
		comparison, err := scoring.Recompare(artifact, stored, p)
		if err != nil {
			return invitations.Result{}, err
		}
		cid, err := insertComparison(ctx, tx, iid, now, comparison, profile)
		if err != nil {
			return invitations.Result{}, err
		}
		if err = s.jobs.AuditPsychometricComparison(ctx, tx, actor, id, pid, iid, cid, p.Version); err != nil {
			return invitations.Result{}, err
		}
		value = comparisonProjection(cid, now, comparison)
		status = 201
	} else {
		rows, err := tx.Query(ctx, `SELECT id,profile_version,created_at,snapshot FROM psychometric_comparisons WHERE invitation_id=$1 ORDER BY created_at,id`, iid)
		if err != nil {
			return invitations.Result{}, err
		}
		history := []comparisonSummary{}
		var latest resultComparison
		for rows.Next() {
			var cid uuid.UUID
			var version *string
			var created time.Time
			var snapshot []byte
			if err = rows.Scan(&cid, &version, &created, &snapshot); err != nil {
				rows.Close()
				return invitations.Result{}, err
			}
			var c scoring.Comparison
			if err = json.Unmarshal(snapshot, &c); err != nil {
				rows.Close()
				return invitations.Result{}, err
			}
			history = append(history, comparisonSummary{cid, version})
			latest = comparisonProjection(cid, created, c)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return invitations.Result{}, err
		}
		if len(history) == 0 {
			return invitations.Result{}, errors.New("finished psychometric result missing initial comparison")
		}
		value = resultProjection(iid, at, stored, latest, history)
		if err = s.jobs.AuditPsychometricInvitation(ctx, tx, actor, id, pid, iid, "PsychometricResultViewed"); err != nil {
			return invitations.Result{}, err
		}
	}
	response, err := invitationResult(value, status)
	if err != nil {
		return invitations.Result{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return invitations.Result{}, err
	}
	return response, nil
}
