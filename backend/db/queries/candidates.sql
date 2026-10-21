-- name: UpsertCandidateProfile :one
-- Reserved cv_s3_key and search_vector remain database-owned.
INSERT INTO candidate_profiles (
 user_id, phone, linkedin_url, portfolio_url, professional_title,
 current_company, years_of_experience, profile_summary, birth_date,
 country_code, state_code, municipality_code, skills,
 current_salary_gross, current_salary_net, expected_salary,
 salary_currency, expected_salary_period, created_at, updated_at
) VALUES (
 $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now(),now()
)
ON CONFLICT (user_id) DO UPDATE SET
 phone=EXCLUDED.phone, linkedin_url=EXCLUDED.linkedin_url,
 portfolio_url=EXCLUDED.portfolio_url, professional_title=EXCLUDED.professional_title,
 current_company=EXCLUDED.current_company, years_of_experience=EXCLUDED.years_of_experience,
 profile_summary=EXCLUDED.profile_summary, birth_date=EXCLUDED.birth_date,
 country_code=EXCLUDED.country_code,state_code=EXCLUDED.state_code,municipality_code=EXCLUDED.municipality_code,
 skills=EXCLUDED.skills,current_salary_gross=EXCLUDED.current_salary_gross,
 current_salary_net=EXCLUDED.current_salary_net,expected_salary=EXCLUDED.expected_salary,
 salary_currency=EXCLUDED.salary_currency,expected_salary_period=EXCLUDED.expected_salary_period,
 updated_at=now()
RETURNING *;

-- name: GetCandidateProfileByUserID :one
SELECT * FROM candidate_profiles WHERE user_id=$1;

-- name: GetLegacyCandidateEducation :one
SELECT level, field FROM candidate_educations
WHERE user_id=$1 AND status='completed' AND level IN ('high_school','bachelor','master','phd')
ORDER BY CASE level WHEN 'phd' THEN 4 WHEN 'master' THEN 3 WHEN 'bachelor' THEN 2 ELSE 1 END DESC, position, id
LIMIT 1;

-- name: DeleteCandidateEducations :exec
DELETE FROM candidate_educations WHERE user_id=$1;

-- name: InsertLegacyCandidateEducation :exec
INSERT INTO candidate_educations(user_id,position,level,field,status) VALUES($1,0,$2,$3,'completed');

-- name: ListCandidateLanguagesByUserID :many
SELECT user_id,code,level FROM candidate_languages WHERE user_id=$1 ORDER BY code;

-- name: DeleteCandidateLanguagesByUserID :exec
DELETE FROM candidate_languages WHERE user_id=$1;

-- name: InsertCandidateLanguage :exec
INSERT INTO candidate_languages(user_id,code,level) VALUES($1,$2,$3);

-- name: SetCandidateSeniority :exec
UPDATE candidate_profiles SET seniority=$2 WHERE user_id=$1;

-- name: ListCandidateEducations :many
SELECT level,institution,field,status,start_year,end_year FROM candidate_educations WHERE user_id=$1 ORDER BY position,id;

-- name: InsertCandidateEducation :exec
INSERT INTO candidate_educations(user_id,position,level,institution,field,status,start_year,end_year) VALUES($1,$2,$3,$4,$5,$6,$7,$8);
