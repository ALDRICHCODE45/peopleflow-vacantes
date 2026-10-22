package board

// These projections deliberately use the same six-key snapshot contract for
// frozen intake copies and the live manual profile on board/detail reads.
const manualProfileSQL = `jsonb_build_object(
 'location',jsonb_build_object('country',cc.country_code,'state',cc.state_code,'municipality',cc.municipality_code),
 'skills',cc.skills,'years_of_experience',trim_scale(cc.years_of_experience)::text,'seniority',cc.seniority,
 'education',jsonb_build_object('highest_completed',
   (SELECT level FROM company_candidate_educations e WHERE e.company_candidate_id=cc.id AND e.status='completed'
    ORDER BY array_position(ARRAY['secondary','high_school','technical','tsu','bachelor','specialty','master','phd'],e.level) DESC,e.position,e.id LIMIT 1),
   'in_progress',(SELECT level FROM company_candidate_educations e WHERE e.company_candidate_id=cc.id AND e.status='in_progress' ORDER BY array_position(ARRAY['secondary','high_school','technical','tsu','bachelor','specialty','master','phd'],e.level) DESC,e.position,e.id LIMIT 1)),
 'languages',COALESCE((SELECT jsonb_agg(jsonb_build_object('code',l.code,'level',l.level) ORDER BY l.code)
   FROM company_candidate_languages l WHERE l.company_candidate_id=cc.id),'[]'::jsonb))`

const organicProfileSQL = `jsonb_build_object(
 'location',CASE WHEN cp.country_code IS NULL THEN NULL ELSE jsonb_build_object('country',cp.country_code,'state',cp.state_code,'municipality',cp.municipality_code) END,
 'skills',COALESCE(cp.skills,'{}'::text[]),'years_of_experience',trim_scale(cp.years_of_experience)::text,'seniority',cp.seniority,
 'education',jsonb_build_object('highest_completed',
   (SELECT level FROM candidate_educations e WHERE e.user_id=cp.user_id AND e.status='completed'
    ORDER BY array_position(ARRAY['secondary','high_school','technical','tsu','bachelor','specialty','master','phd'],e.level) DESC,e.position,e.id LIMIT 1),
   'in_progress',(SELECT level FROM candidate_educations e WHERE e.user_id=cp.user_id AND e.status='in_progress' ORDER BY array_position(ARRAY['secondary','high_school','technical','tsu','bachelor','specialty','master','phd'],e.level) DESC,e.position,e.id LIMIT 1)),
 'languages',COALESCE((SELECT jsonb_agg(jsonb_build_object('code',l.code,'level',l.level) ORDER BY l.code)
   FROM candidate_languages l WHERE l.user_id=cp.user_id),'[]'::jsonb))`
