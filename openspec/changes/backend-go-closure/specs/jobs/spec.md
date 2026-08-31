# Delta for Jobs

## MODIFIED Requirements

### Requirement: Status Domain

Jobs MUST be born `status='draft'` (DB default). Only `status='published'` rows are exposed on read. The full status domain is `draft → published → closed`, and transitions are NOT out of scope: transitions are delivered normatively through the gated `PATCH /jobs/{id}` write route and MUST obey the canonical `Status Transition Table` (including the legal `closed → {draft, published}` re-opens), the CAS concurrency control, and the active-company update gate owned by this same specification. This requirement owns the status vocabulary and read-visibility coupling only; it does not restate the transition mechanics.

(Previously: this requirement claimed "The transitions (publish/close) and their endpoints are OUT of scope," which contradicted the later normative requirements in this same specification that deliver `POST /jobs` draft creation and `PATCH /jobs/{id}` publish/close/re-open transitions; the stale delta-era claim is removed.)

#### Scenario: default insert produces a draft

- GIVEN a row inserted without an explicit `status`
- WHEN the row is read
- THEN `status='draft'`

#### Scenario: only published rows are exposed on read

- GIVEN rows with `status IN ('draft', 'published', 'closed')`
- WHEN `GET /jobs` runs
- THEN only the `published` row is in the response

#### Scenario: status changes occur only through the gated PATCH transition table

- GIVEN any job owned by a live company
- WHEN its `status` is changed through the API
- THEN the change happens exclusively via `PATCH /jobs/{id}` under `RequireAuth` + `RequireCompanyRole(recruiter)` and the canonical `Status Transition Table` (no other endpoint alters `status`, and no transition bypasses the CAS or active-company gates)
