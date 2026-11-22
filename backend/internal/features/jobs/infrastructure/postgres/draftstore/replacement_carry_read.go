package draftstore

import (
	"context"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// carry_candidates[] of GET V/replacements (docs/contracts/replacement-processes-v1.md,
// «GET V/replacements» and «Carried candidates»): the candidates a start could carry,
// resolved with the rule the start applies (readCarryTemplates, planCarried).

// maxCarryCandidates caps the list; one more row is read to say it was truncated.
const maxCarryCandidates = 1000

type carryStage struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

// carryReason is a discard reason with the key names of the board item's discard.reason.
type carryReason struct {
	Group string `json:"group"`
	Key   string `json:"key"`
}

// carryCandidate is a candidate's most recent participation of the chain. Stage is that
// participation's stage by kind and name only, never an id (it belongs to another process
// of the chain); for a discarded one, the stage it was discarded from. DiscardReason
// is that participation's reason (reason_group/reason_code) when Discarded, and always serialized: null
// otherwise. v1 lists only eligible candidates, so Eligible is always true and there is no `reason`.
type carryCandidate struct {
	Candidate       namedCandidate `json:"candidate"`
	ProcessID       string         `json:"process_id"`
	ParticipationID string         `json:"participation_id"`
	Stage           carryStage     `json:"stage"`
	Discarded       bool           `json:"discarded"`
	DiscardReason   *carryReason   `json:"discard_reason"`
	Eligible        bool           `json:"eligible"`
}

// readCarryCandidates returns one row per distinct candidate identity with a participation in
// any process of the chain, from its most recent participation (created_at DESC, id DESC; the
// kind is the identity column), without the candidates currently in Placement (not discarded
// and in the Placement stage of their own process) and the departed hires (readDepartedHires: any
// participation of the chain left Placement with exit reason candidate_left), by name then id, capped at
// maxCarryCandidates. The name is the board's company view.
func readCarryCandidates(ctx context.Context, tx pgx.Tx, companyID uuid.UUID, chain replacementChain) ([]carryCandidate, bool, error) {
	processes := make([]uuid.UUID, len(chain.Processes))
	placements := make([]uuid.UUID, len(chain.Processes))
	pipelines := make(map[uuid.UUID]pipelineconfig.Configuration, len(chain.Processes))
	for i, p := range chain.Processes {
		pipeline, _, err := readPipeline(ctx, tx, p.ID)
		if err != nil {
			return nil, false, err
		}
		processes[i], pipelines[p.ID] = p.ID, pipeline
		for _, stage := range pipeline.Stages {
			if stage.Kind == "placement" {
				if placements[i], err = uuid.Parse(stage.ID); err != nil {
					return nil, false, err
				}
			}
		}
	}
	rows, err := tx.Query(ctx, `WITH chain AS (SELECT c.process_id, c.placement_id FROM unnest($2::uuid[], $3::uuid[]) AS c(process_id, placement_id)),
latest AS (
 SELECT DISTINCT ON (k.kind, k.identity) p.id, p.process_id, k.kind, k.identity, p.discarded_at IS NOT NULL AS discarded,
  p.reason_group, p.reason_code,
  CASE WHEN p.discarded_at IS NOT NULL THEN p.previous_stage_id ELSE p.stage_id END AS shown_stage, p.stage_id
 FROM process_participations p JOIN chain ON chain.process_id = p.process_id
 CROSS JOIN LATERAL (SELECT CASE WHEN p.company_candidate_id IS NULL THEN 'organic' ELSE 'manual' END AS kind,
  COALESCE(p.company_candidate_id, p.candidate_id) AS identity) k
 ORDER BY k.kind, k.identity, p.created_at DESC, p.id DESC)
SELECT l.kind, l.identity,
 COALESCE(CASE WHEN l.kind = 'manual' THEN cc.full_name
  WHEN jsonb_exists(o.corrections, 'full_name') THEN o.corrections->>'full_name' ELSE u.full_name END, '') AS full_name,
 l.process_id, l.id, l.shown_stage, l.discarded, l.reason_group, l.reason_code
FROM latest l JOIN chain ON chain.process_id = l.process_id
LEFT JOIN company_candidates cc ON l.kind = 'manual' AND cc.id = l.identity AND cc.company_id = $1
LEFT JOIN users u ON l.kind = 'organic' AND u.id = l.identity
LEFT JOIN company_candidate_corrections o ON l.kind = 'organic' AND o.user_id = l.identity AND o.company_id = $1
WHERE (l.discarded OR l.stage_id <> chain.placement_id)
 AND NOT EXISTS (SELECT 1 FROM placement_credits c JOIN process_participations d ON d.id = c.participation_id AND d.process_id = c.process_id
  WHERE c.process_id = ANY($2::uuid[]) AND c.exit_reason = 'candidate_left'
   AND ((l.kind = 'organic' AND d.candidate_id = l.identity) OR (l.kind = 'manual' AND d.company_candidate_id = l.identity)))
ORDER BY full_name, l.identity
LIMIT $4`, companyID, processes, placements, maxCarryCandidates+1)
	if err != nil {
		return nil, false, fmt.Errorf("list carry candidates: %w", err)
	}
	defer rows.Close()
	out := []carryCandidate{}
	for rows.Next() {
		var c carryCandidate
		var identity, process, participation, stage uuid.UUID
		var group, code *string
		if err = rows.Scan(&c.Candidate.Kind, &identity, &c.Candidate.FullName, &process, &participation, &stage, &c.Discarded, &group, &code); err != nil {
			return nil, false, err
		}
		if c.Discarded && group != nil && code != nil {
			c.DiscardReason = &carryReason{Group: *group, Key: *code}
		}
		c.Candidate.ID, c.ProcessID, c.ParticipationID, c.Eligible = identity.String(), process.String(), participation.String(), true
		if c.Stage, err = namedStage(pipelines[process], stage); err != nil {
			return nil, false, err
		}
		out = append(out, c)
	}
	if err = rows.Err(); err != nil {
		return nil, false, err
	}
	if len(out) > maxCarryCandidates {
		return out[:maxCarryCandidates], true, nil
	}
	return out, false, nil
}

// namedStage is the kind and name of a stage of a pipeline: a live stage, the exit or a
// retired one (a participation can still sit in, or have left from, a retired stage).
func namedStage(p pipelineconfig.Configuration, id uuid.UUID) (carryStage, error) {
	want := id.String()
	candidates := append(append([]pipelineconfig.Stage{}, p.Stages...), p.Exit)
	for _, stage := range append(candidates, p.RetiredStages()...) {
		if stage.ID == want {
			return carryStage{Kind: stage.Kind, Name: stage.Name}, nil
		}
	}
	return carryStage{}, fmt.Errorf("draftstore: stage %s is not in the pipeline", want)
}
