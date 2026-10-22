// Package candidateview shares company-private read projections across pool and board.
package candidateview

const EmptyProfileSQL = `'{"location":null,"skills":[],"years_of_experience":null,"seniority":null,"education":{"highest_completed":null,"in_progress":null},"languages":[]}'::jsonb`

// CorrectedEducationSQL uses correction alias o, with the E2 rank/status rule.
const CorrectedEducationSQL = `jsonb_build_object('highest_completed',
 (SELECT e->>'level' FROM jsonb_array_elements(COALESCE(NULLIF(o.corrections->'education','null'::jsonb),'[]'::jsonb)) e WHERE e->>'status'='completed' ORDER BY array_position(ARRAY['secondary','high_school','technical','tsu','bachelor','specialty','master','phd'],e->>'level') DESC LIMIT 1),
 'in_progress',(SELECT e->>'level' FROM jsonb_array_elements(COALESCE(NULLIF(o.corrections->'education','null'::jsonb),'[]'::jsonb)) e WHERE e->>'status'='in_progress' ORDER BY array_position(ARRAY['secondary','high_school','technical','tsu','bachelor','specialty','master','phd'],e->>'level') DESC LIMIT 1))`

// EffectiveProfileSQL overlays only six-key profile data, never contact or full studies.
// base is a trusted SQL expression, not request input. o is company/organic scoped.
func EffectiveProfileSQL(base string) string {
	return `(` + base + `) || COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(COALESCE(o.corrections,'{}'::jsonb)) WHERE key IN ('location','skills','years_of_experience','seniority','languages')),'{}'::jsonb)
 || CASE WHEN o.corrections ? 'education' THEN jsonb_build_object('education',` + CorrectedEducationSQL + `) ELSE '{}'::jsonb END`
}
