package postgres

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/assessment"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/content"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/scoring"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// finishAssessment runs only after load acquired draft -> process -> participation
// -> invitation locks and checked availability/consent. The draft lock also
// serializes profile saves, fixing the confirmed profile at the finish boundary.
func (s *AssessmentStore) finishAssessment(ctx context.Context, tx pgx.Tx, a assessment.Access, v candidateInvitation, artifact *content.Artifact) (assessment.Result, error) {
	in := scoring.Input{Answers: map[int]int{}}
	rows, err := tx.Query(ctx, `SELECT position,value FROM psychometric_answers WHERE invitation_id=$1 AND value IS NOT NULL`, v.i.ID)
	if err != nil {
		return assessment.Result{}, err
	}
	for rows.Next() {
		var position, value int
		if err = rows.Scan(&position, &value); err != nil {
			rows.Close()
			return assessment.Result{}, err
		}
		in.Answers[position] = value
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return assessment.Result{}, err
	}
	// Reuse B2's completeness definition, including attention positions, rather
	// than trusting the denormalized answered_count or deriving another order.
	if missing := scoring.MissingPositions(artifact, in.Answers); len(missing) > 0 {
		return assessment.Result{}, &scoring.IncompleteError{MissingPositions: missing}
	}
	rows, err = tx.Query(ctx, `SELECT position,value,client_elapsed_ms FROM psychometric_answer_events WHERE invitation_id=$1 ORDER BY server_sequence`, v.i.ID)
	if err != nil {
		return assessment.Result{}, err
	}
	for rows.Next() {
		var e scoring.AnswerEvent
		if err = rows.Scan(&e.Position, &e.Value, &e.ElapsedMS); err != nil {
			rows.Close()
			return assessment.Result{}, err
		}
		in.Events = append(in.Events, e)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return assessment.Result{}, err
	}
	p, version, err := read(ctx, tx, v.process)
	if err != nil {
		return assessment.Result{}, err
	}
	var profileSnapshot []byte
	if p.Confirmed {
		in.Profile = &scoring.Profile{Version: strconv.FormatInt(version, 10), Competencies: []scoring.Requirement{}}
		for _, c := range p.Competencies {
			in.Profile.Competencies = append(in.Profile.Competencies, scoring.Requirement{CompetencyID: c.CompetencyID, Importance: c.Importance, DesiredBand: c.DesiredBand})
		}
		// Retain the full confirmed profile (rationale/task included), not just the
		// scoring projection. Unconfirmed drafts are not comparison authority.
		rendered, e := render(v.process, p, version)
		if e != nil {
			return assessment.Result{}, e
		}
		profileSnapshot = rendered.Body
	}
	result, err := scoring.Score(artifact, in)
	if err != nil {
		return assessment.Result{}, err
	}
	snapshot, err := json.Marshal(result)
	if err != nil {
		return assessment.Result{}, err
	}
	comparison, err := json.Marshal(result.Comparison)
	if err != nil {
		return assessment.Result{}, err
	}
	finishedAt, err := invitationNow(ctx, tx)
	if err != nil {
		return assessment.Result{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO psychometric_results(invitation_id,content_version,scoring_version,finished_at,snapshot) VALUES($1,$2,$3,$4,$5)`, v.i.ID, result.ContentVersion, result.ScoringVersion, finishedAt, snapshot); err != nil {
		return assessment.Result{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO psychometric_comparisons(id,invitation_id,profile_version,profile_snapshot,content_version,scoring_version,created_at,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, uuid.New(), v.i.ID, result.Comparison.ProfileVersion, profileSnapshot, result.ContentVersion, result.ScoringVersion, finishedAt, comparison); err != nil {
		return assessment.Result{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE psychometric_invitations SET finished_at=$2,purge_after=(($2::timestamptz AT TIME ZONE 'UTC')+interval '12 months') AT TIME ZONE 'UTC' WHERE id=$1`, v.i.ID, finishedAt); err != nil {
		return assessment.Result{}, err
	}
	actor, err := assessmentActor(ctx, tx, a, v.participation)
	if err != nil {
		return assessment.Result{}, err
	}
	if err = s.invitations.jobs.AuditPsychometricInvitation(ctx, tx, actor, v.process, v.participation, v.i.ID, "PsychometricAssessmentFinished"); err != nil {
		return assessment.Result{}, err
	}
	response, err := assessmentResult(struct {
		Status string `json:"status"`
	}{"finished"}, 200)
	if err != nil {
		return assessment.Result{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return assessment.Result{}, err
	}
	return response, nil
}

// Public policy actions use system; account actions use the candidate user ID,
// following the existing audit vocabulary (which has no candidate actor type).
func assessmentActor(ctx context.Context, tx pgx.Tx, a assessment.Access, participation uuid.UUID) (uuid.UUID, error) {
	if a.Public {
		return uuid.Nil, nil
	}
	var actor uuid.UUID
	err := tx.QueryRow(ctx, `SELECT candidate_id FROM process_participations WHERE id=$1`, participation).Scan(&actor)
	return actor, err
}
