# Candidates Specification

Self-service candidate profile under `/me/*`. Target from JWT (`cognito_sub` → `users.id`), never URL/body. No profile-status lifecycle in this slice.

## Requirements

### Requirement: Self-Service Profile Access

`GET /me/profile` MUST return the caller's profile; `PUT /me/profile` MUST upsert it. Target MUST resolve from JWT `sub` → `users.cognito_sub`; path/body ids MUST be ignored.

#### Scenario: GET returns the caller's profile

- GIVEN an authenticated user with a profile row
- WHEN `GET /me/profile`
- THEN response is 200 with that profile

#### Scenario: GET without a profile returns 404

- GIVEN an authenticated user with no profile row
- WHEN `GET /me/profile`
- THEN response is 404

#### Scenario: PUT creates on first call

- GIVEN an authenticated user with no profile row
- WHEN `PUT /me/profile` with valid body
- THEN response is 200 and one profile row exists for that user

#### Scenario: PUT is idempotent on repeat

- GIVEN an authenticated user with an existing profile
- WHEN `PUT /me/profile` again with valid body
- THEN response is 200, no second row exists, stored fields reflect the latest body

### Requirement: Ownership Invariant (No IDOR)

Target SHALL resolve only from JWT `cognito_sub`. Path/body ids MUST be ignored. Unknown `cognito_sub` MUST NOT surface as a server error.

#### Scenario: path id is ignored

- GIVEN user A authenticated, user B has a profile
- WHEN `GET /me/profile/<user-b-id>`
- THEN response is user A's profile, or 404, never user B's

#### Scenario: unknown cognito_sub is not 5xx

- GIVEN a valid JWT whose `sub` matches no live `users.cognito_sub`
- WHEN any `/me/*` candidate route runs
- THEN response is 401, never 5xx

### Requirement: Field Validation

`education_level` MUST be `high_school|bachelor|master|phd`. `expected_salary_period` MUST be `monthly|annual`. `skills` MUST be lowercased before write. Invalid values rejected with 400.

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

### Requirement: Languages List Management

`GET /me/profile/languages` MUST return the caller's `candidate_languages` rows. `PUT /me/profile/languages` MUST atomically replace the full list. `level` MUST be one of CEFR `A1|A2|B1|B2|C1|C2`. The pair `(user_id, language)` SHALL be unique.

#### Scenario: PUT replaces the full list atomically

- GIVEN user has `[english=B2, spanish=C1]`
- WHEN `PUT /me/profile/languages` carries `[english=C1, french=A2]`
- THEN persisted rows are `[english=C1, french=A2]`; spanish is gone

#### Scenario: duplicate language in payload is rejected

- GIVEN user has `[english=B2]`
- WHEN `PUT /me/profile/languages` carries two entries for `english`
- THEN response is 400 and the stored list is unchanged

#### Scenario: invalid CEFR level is rejected

- GIVEN an authenticated user
- WHEN `PUT /me/profile/languages` carries `level = "native"`
- THEN response is 400 and no rows are written

### Requirement: Profile Lifecycle

A profile SHALL be born active; this slice SHALL NOT add `status`, `suspended`, or `hidden` on `candidate_profiles`.

#### Scenario: new profile has no status column

- GIVEN a freshly inserted profile row
- WHEN the row or schema is inspected
- THEN no `status` / `suspended` / `hidden` field exists

### Requirement: Authentication Required

Every `/me/*` route MUST run only after `RequireAuth` accepts. Unauthenticated or invalid-token requests MUST be rejected pre-handler.

#### Scenario: missing Authorization header is rejected

- GIVEN a request to `/me/profile` without `Authorization`
- WHEN the route runs
- THEN response is 401; candidate handler is not invoked

#### Scenario: invalid token is rejected

- GIVEN a tampered or expired JWT
- WHEN `/me/profile`
- THEN response is 401; candidate handler is not invoked
