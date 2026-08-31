# Delta for Candidates

## ADDED Requirements

### Requirement: Candidate Profile Field Matrix

The candidate profile write (`PUT /me/profile`) and read (`GET /me/profile`) wire contract MUST cover exactly the client-owned persisted field set of `candidate_profiles` (migration `00006`), excluding the separately reserved `cv_s3_key`. `PUT` has full-replacement semantics, consistent with the canonical requirement that stored fields reflect the latest body: an omitted or JSON `null` nullable field MUST be persisted as SQL `NULL`, an omitted or JSON `null` `skills` field MUST become an empty array, and an omitted or JSON `null` `salary_currency` MUST become `'MXN'`. A field present with a value MUST be set and validated where a rule exists. The API does not provide PATCH-style tri-state updates.

| Field | Wire name | Wire type | Persistence |
|---|---|---|---|
| `phone`, `linkedin_url`, `portfolio_url`, `professional_title`, `current_company` | as named | `*string` | nullable TEXT; omitted/null clears on replacement |
| `years_of_experience` | as named | `*int` | nullable SMALLINT; omitted/null clears on replacement |
| `profile_summary` | as named | `*string` | nullable TEXT; omitted/null clears on replacement |
| `birth_date` | as named | `*string` `YYYY-MM-DD` | nullable DATE; omitted/null clears; malformed date rejected with 400 |
| `city`, `country` | as named | `*string` | nullable TEXT; omitted/null clears on replacement |
| `education_level` | as named | `*string` enum | nullable TEXT, CHECK `candidate_profiles_education_check`; omitted/null clears |
| `field_of_study` | `field_of_study` | `*string` | nullable TEXT; omitted/null clears on replacement |
| `skills` | as named | `[]string` | TEXT[] NOT NULL default `{}`; omitted/null becomes `{}`; values are lowercased/trimmed/deduped |
| `current_salary_gross`, `current_salary_net`, `expected_salary` | as named | `*int` | nullable INTEGER; omitted/null clears on replacement |
| `salary_currency` | as named | `*string` | NOT NULL DEFAULT `'MXN'`; omitted/null becomes `'MXN'`; a supplied value must be accepted by the use case |
| `expected_salary_period` | as named | `*string` enum `monthly\|annual` | nullable TEXT, CHECK `candidate_profiles_salary_period_check`; omitted/null clears |

The response (`GET /me/profile`) MUST carry `user_id`, every set client-owned field above, and `created_at`/`updated_at`. Server-managed columns (`user_id`, `created_at`, `updated_at`, `search_vector`) MUST NOT be client-writable; values supplied for them MUST be ignored.

#### Scenario: omitted fields are replaced with their empty-state values

- GIVEN a profile with `city='Mexico City'`, `profile_summary='Backend engineer'`, `skills=['go']`, and `salary_currency='USD'`
- WHEN `PUT /me/profile` is sent with only `{"city":"Guadalajara"}`
- THEN `city` becomes `'Guadalajara'`, `profile_summary` becomes NULL, `skills` becomes an empty array, and `salary_currency` becomes `'MXN'`

#### Scenario: explicit null clears a nullable column

- GIVEN a profile with a non-NULL `profile_summary`
- WHEN `PUT /me/profile` is sent with `{"profile_summary": null}`
- THEN the persisted `profile_summary` is NULL

#### Scenario: malformed birth_date is rejected

- GIVEN `PUT /me/profile` with `{"birth_date": "31-12-2020"}`
- WHEN the use case parses the date
- THEN the response is `400` and no row is written

#### Scenario: server-managed fields are not client-writable

- GIVEN `PUT /me/profile` with `{"user_id": "<other-uuid>", "created_at": "...", "search_vector": "..."}`
- WHEN the write is processed
- THEN those values are ignored (the row's server-managed columns are untouched)

#### Scenario: salary_currency falls back to MXN

- GIVEN a `PUT /me/profile` with no `salary_currency` key
- WHEN the row is inserted or replaced
- THEN `salary_currency` is `'MXN'` and the response carries it

### Requirement: CV Storage Key Reserve Semantics

The `cv_s3_key` column is RESERVED for the future CV/storage slice (decision C1 — locked non-goal: no CV/S3 lifecycle in this change). The DB column MUST remain nullable and MUST stay reserved; client writes to `cv_s3_key` MUST be rejected or ignored (a client-supplied value MUST NOT be persisted as a client-asserted storage reference); and `cv_s3_key` MUST be OMITTED from ordinary wire responses (both `GET /me/profile` and `PUT /me/profile` bodies) until the future CV slice owns storage. No client flow may establish a `cv_s3_key` value through the candidate profile API.

#### Scenario: client-supplied cv_s3_key is not persisted

- GIVEN `PUT /me/profile` with `{"cv_s3_key": "resumes/fake.pdf"}`
- WHEN the write is processed
- THEN the persisted row's `cv_s3_key` is NOT set to the client value (rejected or ignored) and the write outcome is unchanged for every other field

#### Scenario: cv_s3_key is omitted from wire responses

- GIVEN a profile row (with or without a reserved `cv_s3_key` value)
- WHEN `GET /me/profile` (or a `PUT /me/profile` response) is returned
- THEN the body carries no `cv_s3_key` field

#### Scenario: the column stays reserved, not dropped

- GIVEN the `candidate_profiles` schema
- WHEN the migration/column is inspected
- THEN `cv_s3_key` still exists as a nullable column reserved for the future CV slice (no CV/S3 lifecycle behavior is implemented)

## MODIFIED Requirements

### Requirement: Field Validation

`education_level` MUST be `high_school|bachelor|master|phd`. `expected_salary_period` MUST be `monthly|annual`. `skills` MUST be lowercased (and trimmed/deduped) before write. Invalid values rejected with 400. The study-field wire name MUST be `field_of_study` on BOTH request and response bodies: the request tag MUST be corrected from the defect `json:"field_of study"` (which silently never binds client input) to `field_of_study`, and a contract test MUST pin the request and response JSON names so DTO/schema drift is detectable. `field_of_study` values are free text (no enum) and round-trip through `PUT`/`GET` unchanged.

(Previously: only the three enum/normalization rules were named; the canonical field contract did not cover `field_of_study`, and the request wire tag shipped as the defective `field_of study`.)

#### Scenario: invalid education_level is rejected

- GIVEN an authenticated user
- WHEN `PUT /me/profile` carries `education_level = "vocational"`
- THEN response is 400 and no row is written

#### Scenario: invalid salary_period is rejected

- GIVEN an authenticated user
- WHEN `PUT /me/profile` carries `expected_salary_period = "weekly"`
- THEN response is 400 and no row is written

#### Scenario: skills are lowercased on write

- GIVEN an authenticated user sending `skills = ["Go", "AWS", "React"]`
- WHEN `PUT /me/profile` is processed
- THEN the persisted row stores `["go", "aws", "react"]`

#### Scenario: field_of_study binds on the request and round-trips

- GIVEN `PUT /me/profile` with `{"field_of_study": "Computer Science"}`
- WHEN the write is processed and `GET /me/profile` is read back
- THEN the persisted and returned value is `"Computer Science"` (the request tag `field_of study` no longer silently drops the input)

#### Scenario: field_of_study wire names are pinned against drift

- GIVEN a static scan of the candidate request and response DTO tags
- WHEN the JSON tag names for the study field are collected
- THEN both the request and response tags are exactly `field_of_study` (no space variant exists)
