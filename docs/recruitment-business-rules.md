# Recruitment business rules — agreed product handoff

This document consolidates the confirmed business rules agreed during discovery between the product owner and the frontend session. It is a **shared business reference** for the backend owner, not an implementation specification, a data model, an API contract, or authorization to build. Technical decomposition, schemas, endpoints and sequencing belong to the backend owner.

Where this document says a rule is agreed, it means the product behavior is decided. Where it says a detail is **open**, the product decision has not been made yet; do not invent it. Where earlier shorthand could be mistaken for an unresolved conflict, the agreed reading is recorded under "Agreed scope clarifications" (section 16); genuinely undecided items live in "Open decisions" (section 17).

Source of truth: `odd/discovery/recruitment-business-rules.md` (accepted discovery record, not modified by this document). This document only reorganizes it; if the two ever disagree, the discovery record and the owner's latest ruling win.

Exact UI labels are preserved in Spanish. Everything else is English technical prose.

---

## 1. Terminology

These names are used consistently below. Prefer them over synonyms in questions and reviews.

| Term | Meaning |
| --- | --- |
| **Logical vacancy** | The durable business need to fill N positions. It groups one original process plus zero or more replacement processes. Reporting groups original and replacement processes under one logical vacancy, supporting separate process results and combined history. |
| **Original process** | The first delivery process under a logical vacancy. Its delivery starts at publication. |
| **Replacement process** | A linked delivery process created after a fulfilled original process is closed, to refill a departure. Has its own principal recruiter, target, commitment date, pipeline and clock, and starts at its explicit configured start (not at original publication). |
| **Process** | Umbrella term for original or replacement. Each process has its own delivery and coverage results, pipeline and clock; lifecycle is evaluated per process. |
| **Vacancy lifecycle** | State of a process: `Borrador`, `Publicada`, `Pausada`, `Cerrada`. Exact replacement lifecycle labels — including which states count as active — and a replacement's public-listing mechanics remain open; do not assume a private replacement is `Publicada`. |
| **Delivery fulfillment** | Whether the recruiter's agreed candidate-delivery commitment was met: `Pendiente`, `Cumplida`. |
| **Hiring coverage** | Whether the required positions are filled: `Sin cubrir`, `Parcialmente cubierta`, `Cubierta`. |
| **Principal recruiter** | The single responsible recruiter for a process at a given time (`responsable principal`). Distinct from collaborators. |
| **Collaborator recruiter** | A recruiter authorized to work on a process without being responsible for it. |
| **Stakeholder** | Read-only role with visibility into its own organization only. |
| **Requester** | Who asked to fill the position: `Área solicitante` (internal department, default/predominant) or `Cliente` (another company). Internal information, never public. |
| **Participación / participation** | One candidate's involvement in one process, with its own stage, substates, history and delivery evaluation. A candidate may have several participations at once. |
| **Candidate-owned profile** | The candidate-managed PeopleFlow profile. Only the candidate writes it. Recruiters never overwrite it. |
| **Internal organization record** | The organization's own record of a candidate, editable by authorized recruiters with audit. Separate from the candidate-owned profile. |
| **Global talent directory** | The opt-in PeopleFlow directory (`Talento PeopleFlow`) searchable by authenticated recruiting users. |
| **Cutoff stage / milestone** | The configured pipeline stage whose attainment counts as delivered for the process. |
| **Commitment date** | `Fecha compromiso de entrega` / `Fecha máxima de entrega`. Business-day date by which delivery is due. |
| **Semantic stage** | A stage whose business function is fixed even if renamed: `Placement` (hiring/coverage), `En proceso` (substate container), `Descartados` (exceptional exit). |

## 2. Roles

The existing organization roles are **Propietario** (owner) and **Reclutador** (recruiter); **Stakeholder** is a newly agreed read-only role. Principal recruiter and collaborator recruiter are **per-process assignments**, not global roles: the same person can be principal on one process and a collaborator (or unrelated) on another. A `Reclutador` may create a vacancy and becomes its principal on creation regardless of their assignment on any other vacancy. The candidate is not an organization role but owns candidate-facing surfaces.

| Action | Propietario | Principal recruiter | Collaborator recruiter | Stakeholder |
| --- | --- | --- | --- | --- |
| Create vacancy | Yes | Yes (auto-assigned as principal) | Yes | No |
| Publish / pause / close | Yes | Yes | No | No |
| Reassign principal recruiter | Yes (only) | No | No | No |
| Add / remove collaborators | Yes | Yes | No | No |
| Manage other collaborators | Yes | Yes | No | No |
| Change targets / commitment date / pipeline config | Yes | Yes | No | No |
| Add candidates (organic intake or recruiter intake) | Yes | Yes | Yes | No |
| Move candidates through the pipeline (may trigger delivery/coverage) | Yes | Yes | Yes | No |
| Consult and attach candidate/vacancy process documents | Yes | Yes | Yes (vacancy-authorized) | Read-only |
| Consult vacancies, candidates, history, performance, metrics | Yes | Own scope | Own scope | Organization-wide, read-only |
| Search global talent directory (`Talento PeopleFlow`) | Yes (may act as recruiter) | Yes | Yes | No |
| Search internal organization candidates (`Candidatos de mi organización`) | Yes | Yes | Yes (own org) | Own org, read-only |
| Edit internal organization record | Yes | Yes | Yes (authorized) | No |
| Edit candidate-owned profile | No (nobody except the candidate) | No | No | No |

### Role rules

- **ROLE-1.** `Reclutador` may work on authorized vacancies but cannot independently reassign responsibility.
- **ROLE-2.** When a `Reclutador` creates a vacancy, that creator is auto-assigned as principal recruiter. Later reassignment requires `Propietario` (audited, does not reset the clock).
- **ROLE-3.** Collaborators may incorporate candidates, move them through the pipeline and manage process documents; their moves may trigger delivery/coverage subject to the agreed confirmations and audit. They cannot perform management actions (publish/pause/close, targets, commitment date, pipeline configuration, assignment).
- **ROLE-4.** Collaborators cannot manage other collaborators and cannot reassign the principal recruiter.
- **ROLE-5.** `Stakeholder` is strictly read-only within their own organization. No modifications. No global talent search. Sensitive-document access and detailed enforcement are open (see Open decisions).
- **ROLE-6.** `Reclutador` sees their own metrics and the vacancies where they are principal or collaborator — never other recruiters' individual performance. Detailed enforcement is open.
- **ROLE-7.** Both `Propietario` and `Stakeholder` can access the full organization executive overview; `Stakeholder` remains read-only.
- **ROLE-8.** `Reclutador` may consult the shared internal candidate pool of their own organization to reuse talent even when the candidate is not linked to their vacancies. This does **not** grant access to unrelated vacancy notes, evaluations, history, or other recruiters' performance. Other organizations' internal records remain inaccessible.
- **ROLE-9.** Shared candidate identity/reuse does not imply shared write ownership. Per-process information stays restricted to authorized participants/roles.

### 2.1 Requester model

- **REQ-1.** Requester is a single choice between `Área solicitante` and `Cliente`, not parallel company+department fields. Default `Área solicitante`; that is expected to be the dominant case.
- **REQ-2.** Preserve support for `Cliente` on the vacancy without requiring a separate client company for internal recruitment.
- **REQ-3.** Areas and external clients are reusable, organization-scoped lists with inline add from the vacancy form; do not store unrestricted per-vacancy free text. Adding an entry persists it in the catalog even if the vacancy draft is later cancelled; warn the user before creation. Within the same organization and requester type, names differing only in letter case or surplus whitespace count as duplicates; preserve accent distinctions. Offer selection of the existing entry instead of creating a duplicate or automatically merging/selecting it. Catalog maintenance remains open.
- **REQ-4.** Requester is internal information, kept separately from the publicly displayed hiring company, and must never appear on public vacancy pages.
- **REQ-5.** Preserve requester type/value for filtering and reports. An optional contact-person field is unconfirmed; the earlier three-separate-requester-fields proposal was **rejected**.
- **REQ-6.** Public `Área profesional` identifies the job's discipline, independently of the internal requester. For example, a backend developer belongs to `Tecnología y sistemas` in the approved initial catalog, while the requester may be the internal `Departamento de TI` or the external client `Cyber Power`. Keep both concepts: candidates see the professional area, never the requester. Professional area is required for publication but may remain empty in an incomplete draft (VAC-2); publication is outside the first private-draft slice. Do not replace professional area with requester, infer mappings between their catalogs, or treat the current UI's nine area options as an approved final catalog. The initial platform-wide catalog is confirmed in REQ-7; its technical representation remains to be agreed. This separation is a requirement, not evidence of implemented persistence.
- **REQ-7.** The initial shared professional-area catalog has 16 options: `Tecnología y sistemas`; `Ingeniería`; `Producto`; `Diseño y creatividad`; `Ventas y desarrollo comercial`; `Marketing y comunicación`; `Administración y finanzas`; `Recursos humanos`; `Operaciones y producción`; `Logística y transporte`; `Atención y soporte al cliente`; `Salud`; `Educación y capacitación`; `Legal`; `Construcción y mantenimiento`; `Turismo, hotelería y gastronomía`. These classify the job's discipline, not the employer's industry or its internal requester. Backend development belongs to `Tecnología y sistemas`; `Ingeniería` covers disciplines such as industrial, mechanical and electrical engineering. This refines the earlier illustrative backend-to-Ingeniería example without authorizing automatic reclassification of legacy data. The catalog is upcoming, not implemented.

## 3. Vacancy lifecycle, publication and coverage

Lifecycle, delivery fulfillment and coverage are **three independent dimensions**. Candidate pipeline stages are not lifecycle states.

| Dimension | Values |
| --- | --- |
| Vacancy lifecycle | `Borrador`, `Publicada`, `Pausada`, `Cerrada` |
| Delivery fulfillment | `Pendiente`, `Cumplida` |
| Hiring coverage | `Sin cubrir`, `Parcialmente cubierta`, `Cubierta` |

- **VAC-1.** Creating a draft does not start the delivery clock. Publishing starts it.
- **VAC-2.** Incomplete drafts are allowed.
- **VAC-3.** Publication requires: principal recruiter, requester (internal area or external client), request date, required hiring headcount, candidate delivery target, delivery cutoff stage, commitment date, plus the offer's required public content. These management fields are **internal**, including hiring headcount; requiring them to publish does not expose them publicly. Exact public-content validation must be mapped against existing forms.
- **VAC-4.** Candidate-facing public content is the offer: title, description, requirements, location, work modality (`Modalidad`), work schedule (`Jornada`), contract type, professional area (`Área profesional`, REQ-6) and benefits, plus salary **only when explicitly enabled**. Never expose internal management fields publicly.
- **VAC-5.** Pausing stops active delivery time. Resuming continues accumulated time without resetting it.
- **VAC-6.** When a previously public vacancy is paused or closed, remove it from public search and block new applications. Preserve direct-link access to its public detail with a `Pausada` or `Cerrada` notice and keep existing applications. This does **not** authorize exposing drafts or never-published replacement processes.
- **VAC-7.** Preserve total calendar duration and pause history separately.
- **VAC-8.** Delivery fulfillment does not close the vacancy. Full coverage does not close it automatically either. Closure is manual, with no additional approver.
- **VAC-9.** Closing requires a reason: `Cubierta`, `Cancelada` or `Otro`. `Otro` requires an explanation. `Cubierta` is allowed only when the required positions are filled.
- **VAC-10.** Closing never automatically fulfills candidate delivery.
- **VAC-11.** Required delivered-candidate quantity is independent of required hiring headcount — for example five delivered candidates for two hires.

## 4. Delivery and coverage semantics

- **DEL-1.** A configured pipeline column is the delivery milestone. Fulfillment is automatic when the distinct-candidate target is reached; no separate approval role.
- **DEL-2.** Count historical attainment of the milestone, not merely current occupancy. Advancing or withdrawing later does not erase a previously recorded delivery.
- **DEL-3.** Count the same person only once per process (for delivery and coverage). Do not double-count through duplicate records or repeated transitions. Deduplication mechanics are open.
- **DEL-4.** Moving a candidate into semantic `Placement` confirms hiring and adds one covered position.
- **DEL-5.** Moving that candidate out of `Placement` requires explicit confirmation and reduces coverage. Preserve hiring/departure history and do not erase fulfilled delivery or its KPI.
- **DEL-6.** If reducing a target from five to three makes three already-delivered candidates sufficient, fulfillment occurs **at the edit time**, not retrospectively.
- **DEL-7.** When changing the cutoff, use recorded candidate movements to determine who previously reached the new milestone, counting each person once. Current occupancy alone is insufficient. If that change fulfills the target, fulfillment occurs at change time; preview the impact and record which candidates explain the result.
- **DEL-8.** Hiring-coverage duration is calendar elapsed time from original publication until all required positions are filled, **without** subtracting pauses. For replacements, use that process's explicit start instead of original publication. This intentionally differs from active delivery time.
- **DEL-9.** Whenever full coverage is achieved, preserve a timestamped coverage milestone and its duration. Later departures reduce current coverage without deleting that milestone; reaching full coverage again creates another event. Current coverage and historical coverage achievements must remain distinguishable.
- **DEL-10.** The coverage-time chart uses time to first full coverage per process, counting each process once even if it later loses and regains coverage. Subsequent achievements stay in history. Distinguish replacement processes from originals. Aggregation, reporting period and other filters are open.

## 5. Candidate pipeline and columns

Default columns for each process:

1. `Nuevos`
2. `Screening`
3. `Screening OK`
4. `En proceso`
5. `Placement`
6. `Descartados`

This is the default list, not a requirement to pass through `Descartados` as a normal progression step.

- **PIPE-1.** Each process has independent column names/order, substates and delivery cutoff configuration.
- **PIPE-2.** Default columns can be renamed; order persists.
- **PIPE-3.** Progression columns can be reordered **before** `Placement`, which remains the final hiring step. This approved constraint narrows the initial unrestricted reorder request.
- **PIPE-4.** Allow at most three additional user-named columns.
- **PIPE-5.** Extra columns are ordinary required steps inserted before `Placement`, not alternative terminal outcomes or post-hiring steps.
- **PIPE-6.** Additional columns do not acquire hiring semantics; `Placement` retains that function. Documents and post-hiring follow-up remain within `Placement`.
- **PIPE-7.** Any normal progression stage may be the delivery cutoff; `Descartados` is not a delivery stage.
- **PIPE-8.** Keep `Descartados` outside the ordered normal progression.
- **PIPE-9.** Names do not change semantic functions. Renaming `Placement` keeps its hiring/coverage effect; renaming `En proceso` keeps its substate behavior.
- **PIPE-10.** Renaming a column with a critical action requires a dialog explaining that the action remains unchanged.
- **PIPE-11.** Ordinary progression must not skip required stages. `Descartados` is an exceptional exit available from any stage, not a mandatory progression step.
- **PIPE-12.** Moving a candidate to `Descartados` requires a recorded reason distinguishing recruiter rejection from candidate withdrawal. An additional explanatory comment is optional. The reason catalog is open; do not conflate all discards with recruiter decisions.
- **PIPE-13.** Recovery from `Descartados` requires confirmation and returns the candidate to their previous stage, retaining both discard and recovery history. If that stage was `Placement`, explicitly confirm renewed occupancy before restoring hiring/coverage; never restore it silently.
- **PIPE-14.** Backward movements retain history; leaving `Placement` has the confirmation and coverage consequences of DEL-5.
- **PIPE-15.** Removing a used column/substate must not remove historical evidence. Resolve occupants before removal and replace any active cutoff configuration before deleting its column.
- **PIPE-16.** Reordering progression steps is a behavior-changing configuration edit, with impact preview and audit.
- **PIPE-17.** Preserve already attained historical milestones when adding/reordering steps; do not silently move candidates or rewrite completed results.
- **PIPE-18.** When adding a required stage, candidates already beyond its insertion point are not forced backward. Record the stage as **not applicable due to process change**, never completed; it must not falsely count as delivery. The stage applies to candidates who have not yet passed that point.

### 5.1 Substates

- **SUB-1.** Unlimited user-defined substates exist **only inside semantic `En proceso`**.
- **SUB-2.** `Primera entrevista`, `Segunda entrevista`, `Pruebas psicométricas` and `Propuesta entregada` were **examples, not mandatory built-in substates**.
- **SUB-3.** A candidate has at most one active substate at a time, with history of changes.
- **SUB-4.** Substates are tracking labels, not mandatory sequential steps; candidates need not traverse all of them or follow an order.
- **SUB-5.** Support filtering process candidates by active substate. Allow multiple selections with OR semantics: match any selected substate. Include `Sin subestado` for candidates in `En proceso` with no assigned substate. Combination with other filters and cross-vacancy reporting semantics are open.
- **SUB-6.** Use substates for detailed activities instead of adding a column per interview.

### 5.2 Internal vacancy checklist (v1)

- `GET/PUT /v2/me/company/job-drafts/{id}/checklist` stores ordered criteria and current reminder stages. GET returns version `0` and empty arrays before the first save; PUT requires the opaque checklist ETag in `If-Match`. Identical stored replacements do not increment the version or emit an event. GET hides retired reminder stages.
- Checklist access uses the recruiter owner-or-principal gate (foreign/non-principal vacancies are `404`). Finished processes reject writes with `409 process_finished`; reads remain available. Criteria inform comparison only; the backend does not evaluate, reject or move candidates in v1.
- `GET …/checklist/marks` returns current-criterion marks for all participations of the process, including discarded candidates, ordered by participation/criterion. `PUT/DELETE …/participations/{pid}/checklist-marks/{criterion_id}` sets or clears a recruiter verdict (`met`/`not_met`, optional trimmed note up to 500 characters). Writes are last-write-wins; identical writes and absent deletes are no-ops. Removing a criterion hides, but retains, its marks; re-adding its ID restores them. Recruiter names are resolved at read time.

### 5.3 Private psychometric profile (v1, B3)

- `GET/PUT /v2/me/company/job-drafts/{id}/psychometric-profile` stores the seven catalog competencies, desired bands, job rationales/tasks, enabled/confirmed flags, current progression auto-send stages and expiry (1–30 days, default 7). Never-saved profiles are disabled/unconfirmed at version `0`; PUT requires the opaque `pp1-…` ETag and replaces all writable fields.
- The checklist's access and lifecycle gates apply. Confirmation is explicit and independent of enabled; server timestamps cannot be supplied. GET hides retired auto-send stages. Changed saves co-write `JobDraftPsychometricProfileConfigured` with version and JSON-string previous/new snapshots; rejected and identical saves change nothing. This slice creates no invitations and never rejects or moves candidates. See [backend endpoint details](../backend/docs/psychometric-tests.md).

## 6. Delivery configuration, cutoff and commitment date

- **CFG-1.** Delivery cutoff column is configurable per process. Original-process delivery starts at publication; replacement delivery starts at its explicit configured start. Neither is a freely configurable clock-start choice.
- **CFG-2.** Before fulfillment, delivery quantity and cutoff column may be edited with audit history.
- **CFG-3.** At fulfillment, freeze the target, milestone and evaluation inputs as part of the historical result.
- **CFG-4.** Each process has a configurable `fecha compromiso de entrega` / `fecha máxima de entrega`.
- **CFG-5.** Pauses do not automatically move this date.
- **CFG-6.** Date edits must be explicit and record previous value, new value, acting user and timestamp.
- **CFG-7.** At fulfillment, evaluate against the commitment date then in force. Later edits cannot rewrite an early/on-time/late result.
- **CFG-8.** Performance reporting uses **business days**: Monday–Friday, excluding Mexico's official mandatory rest days. No custom organization calendars in initial scope. Authoritative calendar sourcing, year coverage and partial-day rounding are open; this document does not enumerate legal dates.
- **CFG-9.** The commitment date includes the entire local day; the following day is outside the commitment date even if business-day lateness rounding needs further definition.
- **CFG-10.** Commitment dates must fall on a business day. Reject weekends and official mandatory rest days with an explanation and ask the user to choose another date; never silently shift it.
- **CFG-11.** Initial publication from draft is blocked if the commitment date is already past in `America/Mexico_City`; require an explicit update before publishing. The current local date is valid if it is a business day, because the commitment includes that entire day. This does not require resetting overdue commitments when resuming existing processes.
- **CFG-12.** Stable organization calculation timezone: Mexico City, `America/Mexico_City`. Do not derive changing KPI boundaries from the viewer's geolocation or travel.
- **CFG-13.** Preserve the time basis used by historical results. Active elapsed time and calendar commitment compliance are distinct measurements.

## 7. Assignment and reopening

### 7.1 Reassignment

- **ASG-1.** Reassignment does **not** reset the vacancy clock or move its commitment date automatically.
- **ASG-2.** Close the previous responsible recruiter's assignment interval and start the next one's interval.
- **ASG-3.** `Propietario` may assign or change the principal responsible recruiter. `Reclutadores` may work on authorized vacancies but cannot independently reassign responsibility.
- **ASG-4.** Record acting user, previous/new assignee and timestamp.
- **ASG-5.** Show total process active time separately from time assigned to each recruiter.
- **ASG-6.** Show whether a recruiter received an already-overdue vacancy or how much time remained.
- **ASG-7.** Do not automatically attribute inherited delay entirely to the last recruiter.
- **ASG-8.** Explicit commitment renegotiation follows the same audited date-edit policy.
- **ASG-9.** Each process has one principal responsible recruiter at a time. Record the actual actor for each action separately from process responsibility.
- **ASG-10.** Collaborator recruiters from the same organization may be added/removed by `Propietario` and the principal recruiter, with audit history.

### 7.2 Reopening

- **REO-1.** If closed **before** delivery fulfillment, reopening resumes the existing commitment and accumulated active time without resetting it. Exclude the closed interval from active delivery time, like a pause; the commitment date does not shift automatically. Preserve closure/reopening history.
- **REO-2.** After a **fulfilled, closed** original process, create a linked replacement process under the same logical vacancy rather than reopening the original or creating an independent duplicate vacancy. Keep the original process closed and its result intact.

## 8. Replacement processes

- **REP-1.** Each replacement process has its own principal recruiter, target, commitment date, pipeline and clock, with a link to its source process and the specific hiring being replaced.
- **REP-2.** Do not overwrite/reset the original fulfilled KPI. Later departure events remain visible without rewriting historical delivery or closure results.
- **REP-3.** A replacement process starts **explicitly** after its delivery target and commitment date are configured. That event begins its clock; do not reuse the original publication timestamp.
- **REP-4.** Replacement publication is optional and separate from starting work. An unpublished replacement can use existing candidates or recruiter-introduced candidates. Publishing later does not restart its clock.
- **REP-5.** Reuse candidate identities without duplicating people. The recruiter chooses which candidates to resume, with separate participation in the replacement process.
- **REP-6.** Previous delivery events never automatically fulfill the new process; any renewed delivery must be recorded for that process.
- **REP-7.** Record the departed hire, departure timestamp and reason without erasing the prior hiring. A move to `Descartados` in the original process is historical evidence, not grounds to automatically add that person to the replacement as discarded. Recording the departure preserves the original hiring event, delivery KPI, historical coverage milestones and closure; it changes only current coverage (DEL-5, DEL-9) and does not require reopening the original process (REO-2).
- **REP-8.** Identify the particular hiring being replaced when multiple positions were covered.
- **REP-9.** Report one logical vacancy with its original and replacement processes, supporting separate process results and combined history rather than counting replacements as unrelated new vacancies.
- **REP-10.** For resumed candidates, show their previous stage as reference and let the recruiter explicitly confirm the starting stage in the replacement process. Audit this controlled intake exception to the no-skipping rule; do not require unnecessary repetition of prior assessments.
- **REP-11.** Intake itself never automatically counts as renewed delivery; record renewed delivery explicitly for the replacement process.
- **REP-12.** Allow only one active replacement process per logical vacancy at a time; it may cover multiple positions. Later replacements are sequential processes, preserving all previous ones. Exact lifecycle states considered active are open.
- **REP-13.** Replacement processes do **not** automatically copy original-process documents. Authorized users can consult source documents and explicitly choose which to link, preserving source and version references. Linking does not bypass source access or retention/deletion rules.

## 9. Candidate intake and profile

- **INT-1.** Recruiters can introduce candidates to a vacancy without an organic application.
- **INT-2.** An authorized recruiting user may directly incorporate a currently discoverable global-directory candidate into a vacancy without prior invitation acceptance. Record recruiter-initiated incorporation, never a voluntary application. Directory visibility does not imply candidate acceptance.
- **INT-3.** Recruiter-initiated incorporation stays **internal** until the recruiter explicitly decides to contact the candidate. Intake sends no automatic notification and creates no candidate-facing dashboard entry.
- **INT-4.** Do **not** require or build an external-contact activity log for recruiter outreach in this scope — explicitly rejected. Do not infer candidate-facing visibility from an off-platform contact the system does not track. In-platform messaging scope and any future explicit visibility transition are open.
- **INT-5.** A candidate may participate in multiple vacancies simultaneously using one identity/profile, with stage, substate, history and delivery evaluation independent per process. Moving or discarding a candidate in one vacancy must not change other participations. Identity-sharing visibility boundaries are open; this does not authorize cross-organization data access.
- **INT-6.** Such candidates need no PeopleFlow account or self-service profile.
- **INT-7.** Recruiter manual intake must expose the candidate profile fields currently offered in the candidate dashboard profile section, subject to the agreed removals/changes. Inventory the real UI before defining exact field parity; this is **not** a minimal contact-only form.
- **INT-8.** Required manual-intake fields: name, education level, contact method, residence/location and **CV**. Other available profile fields remain optional unless separately agreed.
- **INT-9.** CV is **mandatory**, superseding the earlier optional-CV proposal.
- **INT-10.** Require at least one contact method: email or telephone; allow both. Exact format validation is open.
- **INT-11.** For recruiter manual intake, residence requires city and municipality/`alcaldía`; postal code is optional. Do not require a full street address.
- **INT-12.** Support manual form entry and desired assisted prefill from CV, LinkedIn and OCC for both recruiter intake and candidate self-service profiles.
- **INT-13.** Assisted extraction prefills an **editable** form for recruiter review and correction before saving; it must never silently create the candidate. Missing required fields must be completed. If extraction fails, allow manual completion without losing the uploaded CV.
- **INT-14.** If intake email or telephone matches an existing candidate record, show a possible duplicate **before** creating another record so the recruiter can review and reuse the existing identity. Never merge automatically: shared contact information is not proof of identical identity. Search visibility boundaries and confirmed-distinct override mechanics are open.
- **INT-15.** A CV attachment is always required before saving recruiter candidate intake, regardless of manual entry, CV parsing, LinkedIn or OCC prefill. External profile data or a URL never substitutes for the CV document. Do not infer self-service draft/persistence rules from this intake requirement.
- **INT-16.** External-platform extraction feasibility/permissions are **not verified**. Saving a URL, parsing a CV and importing external profile data are different capabilities.
- **INT-17.** CV is mandatory for **organic candidate applications as well**. Remove the employer setting that permits applications without CV; it must not remain a configurable exemption. This does not require a CV just to save an incomplete self-service profile unless separately agreed.
- **INT-18.** Remove the cover letter from the application process.
- **INT-19.** Candidate profiles and vacancy requirements support multiple languages, with a level per language: `básico`, `intermedio`, `avanzado` or `nativo`. Language choices are `Español`, `Inglés` and `Otro` with the language specified. Exact matching rules and field requiredness are open; do not assume native-level filtering semantics.
- **INT-20.** Keep both `Seniority` and `Años de experiencia` as separate fields in candidate profiles and vacancy requirements. Rename the existing seniority-equivalent field rather than introducing a duplicate; verify existing form semantics during inventory.
- **INT-21.** Candidate experience is a nonnegative number of years, allowing decimals (for example `1.5`) and `0`. Vacancy experience is a **minimum** required number of years, not a maximum that excludes more experienced candidates. Exact seniority options, numeric precision and validation bounds are open.
- **INT-22.** Education, experience and language requirements inform users and support filtering; they do **not** automatically reject applications. The recruiter decides. Explicit knockout criteria would require a separately agreed future rule.
- **INT-23.** Distinguish candidate education level from the vacancy's minimum required education level. Record education completion status (`en curso`, `concluidos`, `incompletos`) separately so ongoing studies are not represented as completed qualifications. Education catalog, multiple educational records and vacancy acceptance/matching rules are open.
- **INT-29.** Decided 2026-10-21 (supersedes the level list and language choices of INT-19 and the open details of INT-20, INT-21 and INT-23): **system-wide** (candidate profile, recruiter intake, vacancy requirements, filters and search) languages come from a broad ISO catalog with Spanish names (including Mexican Indigenous languages), chosen from a searchable list, never free text; each language has a level on the CEFR scale `A1`, `A2`, `B1`, `B2`, `C1`, `C2` plus `Nativo`. Seniority levels: `Practicante`, `Junior`, `Semi-senior`, `Senior`, `Líder`, `Gerente`, `Director`, separate from years of experience (decimal, e.g. `1.5`; a minimum in vacancies). Education levels follow the Mexican system: `Secundaria`, `Bachillerato/Preparatoria`, `Carrera técnica`, `Técnico Superior Universitario (TSU)`, `Licenciatura/Ingeniería`, `Especialidad`, `Maestría`, `Doctorado`. A candidate may record several studies (level, institution, field, status and optional dates) with status `en curso`, `en pausa`, `concluido` or `trunco`; an ongoing study never counts as a completed qualification. The vacancy states a minimum education level and whether it accepts ongoing studies.
- **INT-24.** `Fecha de solicitud` and `fecha de requerimiento` mean the same thing: keep only `Fecha de solicitud`, recording when filling the position was requested, independently of draft creation and publication. It does not start the delivery KPI.
- **INT-25.** `Fecha ideal de contratación` is an optional target hiring date, separate from the delivery commitment date. It does not affect the delivery KPI.
- **INT-26.** `Fecha de cierre` is recorded automatically when the recruiter closes the vacancy, not entered manually. Reopening preserves that closure in history; each subsequent closure creates a new timestamped event.
- **INT-27.** Keep closure separate from publication, target hiring and delivery commitment dates.
- **INT-28.** Remove/defer for now the optional application-deadline input — currently labeled `Fecha de cierre` with helper `Fecha límite para recibir postulaciones` — from the upcoming draft UI and its contract. Do not store it without expiry behavior. This field is not the actual closure timestamp: `Fecha compromiso de entrega` (CFG-4), the optional `Fecha ideal de contratación` (INT-25) and the event-generated actual `Fecha de cierre` (INT-26) are unaffected, and the mislabeled field must not be reinterpreted as closure.

## 10. Privacy, visibility and the global directory

- **PRIV-1.** Remove both birth date and age **entirely** from candidate profile fields (public and private), application flow and recruiter intake. Age is not an optional public field; do not collect, derive or display it as a structured field.
- **PRIV-2.** Treatment of existing stored data and age/birth-date information embedded in uploaded CVs still requires explicit privacy design.
- **PRIV-3.** `Global-directory visibility is disabled by default`. The candidate must explicitly activate it and can deactivate it later to stop appearing in new searches.
- **PRIV-4.** When the candidate enables recruiter discoverability, **profile photo is the only independently optional shared profile item**. Photo is hidden from recruiting viewers by default; the candidate must explicitly choose to share it.
- **PRIV-5.** Available email, phone and CV are shared with authorized recruiting viewers as part of the visibility choice, without separate field-level sharing toggles for them. This does not require collecting both contact methods, does not expose internal employer data, and never reinstates age/birth date.
- **PRIV-6.** Make the scope of sharing clear when activating visibility.
- **PRIV-7.** Disabling discoverability removes the candidate from global searches and prevents global-profile consultation, including via direct links. It does `not` automatically withdraw applications or existing recruitment participations. Those retain process-scoped information subject to privacy/retention rules, not ongoing unrestricted access to a hidden global profile.
- **PRIV-8.** "Public" in this context means discoverable only by authenticated recruiting users authorized for talent search, **not** anonymous internet visitors or search engines.
- **PRIV-9.** Both `Reclutador` and `Propietario` may search global talent and incorporate candidates; `Propietario` may act as a recruiter. Candidate accounts cannot search other candidates. `Stakeholder` has no global talent-search access.
- **PRIV-10.** The candidate wants control of potentially discriminatory public-profile information, including optional photo visibility and other fields still to define. Age must be removed entirely.
- **PRIV-11.** Withdrawal from a process is different from a personal-data deletion request.
- **PRIV-12.** Retention duration, deletion/anonymization behavior, visibility, secure storage and applicable privacy requirements need explicit design. Auditability does not authorize indefinite retention of sensitive data.

## 11. Documents

- **DOC-1.** `Placement` supports multiple user-chosen documents per candidate participation/process, such as contracts or CVs. Technical limits and supported formats are open. These are internal process documents, **not** public attachments or automatic additions to the candidate-managed profile.
- **DOC-2.** Multiple internal documents exist at vacancy level (for example vacancy-related contracts) for team access, separate from candidate-specific attachments. They must not become public vacancy attachments. Vacancy-level documents can be uploaded starting in draft and throughout the process, without waiting for `Placement`.
- **DOC-3.** `Propietario` and authorized vacancy recruiters manage process documents; `Stakeholder` consults read-only within the organization. General shared candidate-pool access does **not** grant access to another process's documents.
- **DOC-4.** Authorized users may attach vacancy-level and candidate-process documents **after closure** without reopening the process or changing its metrics. Preserve the same permissions and audit the attachment. This attachment permission alone grants no general business edits, but it does not prohibit separately approved departure events recorded under REP-7.
- **DOC-5.** Replacing a vacancy-level or candidate-process document creates a **new version** rather than silently overwriting it; record acting user and timestamp. Previous versions remain subject to the retention/deletion policy, not an indefinite-storage guarantee.
- **DOC-6.** Separate business event history, editable candidate data and document contents.
- **DOC-7.** Each application or recruiter intake keeps a reference to the **CV version used for that participation**. Updating the candidate profile CV must not silently replace the document evaluated in existing processes. Version availability remains subject to the document retention/deletion policy, not indefinite storage.
- **DOC-8.** Preserve only the historical personal data needed to explain a result; do not duplicate a whole CV on every movement.
- **DOC-9.** A document-removal event may remain without retaining the file forever.
- **DOC-10.** Exact file management operations remain open.

## 12. Search, discovery and profiles

- **SRCH-1.** Public filters: label `Idioma adicional`, options `Español`/`Inglés`/`Otro` with custom language entry. Remove insurance, flexible-hours and training filters — **not** those benefits from vacancy data.
- **SRCH-2.** Advanced search is required in two separate scopes: `Talento PeopleFlow` (opted-in global profiles) and `Candidatos de mi organización` (internal records subject to existing access rules). Keep them separate rather than merging results or exposing private organization data globally.
- **SRCH-3.** The existing sidebar `DB interna` entry is the internal-candidate concept. The current frontend is a local table/detail without selectable candidate cards; adding a **card view** alongside the table is a new extension. Both views share results, filters and sorting; switching only changes presentation and must not reset the search.
- **SRCH-4.** Authorized recruiters may edit the internal organization record with audit history, but never directly change the candidate-managed profile. Internal corrections must not overwrite that profile or another organization's records.
- **SRCH-5.** Candidate-managed profile updates must not automatically overwrite internal records. While the recruiter is still authorized to view that global profile, show differences and let them explicitly select which updates to incorporate, with audit history and preservation of unselected internal corrections. Do not use synchronization to bypass disabled global visibility or silently replace participation-specific CV versions.
- **SRCH-6.** Keep `Talento PeopleFlow` as a separate recruiter-facing discovery area. Advanced candidate search includes a global PeopleFlow talent directory (OCC-like), not only an organization's internal pool.
- **SRCH-7.** Do not publish recruiter-created internal candidate records or organization-private evaluations/documents through global search.
- **SRCH-8.** Advanced search combines structured profile fields (location, education, seniority, years of experience and languages) with CV keywords using `AND`, `OR` and `NOT`. Provide visual controls for structured filters plus a Boolean input for CV text, without requiring expressions for structured fields. Approved interaction example: `("Java" OR "Kotlin") AND "Spring" NOT "practicante"`.
- **SRCH-9.** Exact grammar (including implicit conjunction before `NOT`), validation, text extraction/indexing behavior and relevance ranking must be specified with backend before implementation. Recruiter visibility restrictions apply to all results.

### 12.1 Salary

- **SAL-1.** Salary inputs (current, expected, vacancy) need gross/net selection, currency and pay period. Default currency `MXN` and default pay period `mensual` (monthly), both editable. Apply to current salary, expected salary and vacancy compensation.
- **SAL-2.** The initial shared currency catalog is confirmed: `MXN` (pesos mexicanos) and `USD` (dólares estadounidenses). The initial shared pay-period catalog is confirmed: `por hora`, `semanal`, `quincenal`, `mensual` and `anual`. These are business labels, not a technical schema; their representation remains to be agreed. `quincenal` is the confirmed label for a twice-a-month period and must not be read as every-two-weeks (biweekly/`catorcenal`) or as fixing payroll cut-off dates. The catalog is confirmed, **not implemented**. Cross-unit search and comparison behavior remains open. **No automatic conversion between currencies or between pay periods is approved in this scope**, and no gross/net conversion is approved.
- **SAL-3.** Vacancy compensation supports an explicit choice between fixed amount and salary range.
- **SAL-4.** Keep internal compensation data separate from its public visibility. Vacancy salary is hidden publicly by default and requires explicit recruiter activation to publish.
- **SAL-5.** Public salary filters must never compare against hidden internal compensation. Vacancies with hidden salary remain eligible for searches **without** salary criteria but are excluded whenever a public amount/range filter is active.
- **SAL-6.** Public salary filters let users select currency, pay period and gross/net basis. Compare published salaries only when all three match, without implicit conversions.
- **SAL-7.** Match ranges when the published offer overlaps the requested range at least partially. A fixed amount matches when it falls within the requested range. Example: a `30–40k` search matches a `35–45k` offer and a fixed `38k` offer, provided currency, pay period and gross/net basis match.
- **SAL-8.** Decided 2026-10-20: bounds are inclusive; one end alone is allowed ("from X" matches offers whose maximum or fixed amount is at least X; "up to Y" matches offers starting at Y or less); filter units default to `MXN` · `mensual` · gross, editable, required only when an amount is entered. Do not extend this fixed/range choice to candidate salaries without confirmation.

### 12.2 Vacancy content and catalogs

- **CAT-1.** Contract options: `Por proyecto`, `Indeterminado`, `Servicios profesionales / Contractor`, `Temporal`, `Becaría`. `Contractor` and `Servicios profesionales` are merged into one product-catalog option. Each vacancy has exactly **one** contract type. This catalog is not a legal classification; existing-data/API mapping is open.
- **CAT-2.** `Other benefits` supports multiple custom benefit items, not a single free-text item, displayed alongside predefined benefits in the public vacancy detail. No organization-wide benefit catalog is approved; these are custom items beside the predefined ones. Requester catalogs (`áreas solicitantes` / `clientes`, REQ-3) are separate and are not part of a benefit catalog.
- **CAT-3.** Use Tiptap's headless editor with the existing shadcn/Tailwind UI instead of extending the homemade marker editor. Support paragraphs, lists, bold, italic, safe links, undo/redo, and `pequeño`, `normal`, `grande` font-size presets applied to selected text, allowing mixed sizes while preserving other formatting. Arbitrary sizes are not allowed; exact styling values are implementation detail and must preserve mobile readability. Persist a versioned rich JSON document, validated by Go against the agreed allowed nodes, attributes, links and resource limits; derive plain text on the server without replacing the rich source. Saving and reopening must preserve formatting. Use static rendering for read-only content rather than loading an interactive editor everywhere. This is upcoming implementation, not existing behavior. Keep explicit save and draft version checks; collaboration, AI, images and paid editor features are outside this initial editor unit.
- **CAT-4.** Education, languages and location must be represented; inspect existing fields before adding duplicates.
- **CAT-5.** Include municipality/`alcaldía`, city and postal code; exact applicable forms still need mapping.
- **CAT-6.** `Jornada` (work schedule: `Tiempo completo` / `Medio tiempo`) and `Tipo de contratación` (the CAT-1 catalog) are separate vacancy fields and must not be combined. `Jornada` is also distinct from `Modalidad` (work mode: presencial / remoto / híbrido). Each vacancy has exactly one contract type (CAT-1). The current UI mixes these: the single `employment_type` field labeled `Jornada` offers `full_time`/`part_time` (Tiempo completo / Medio tiempo) together with `contract`/`internship` (`frontend/src/features/jobs/formatters.ts`, `frontend/src/features/jobs/create/form/basic-information-section.tsx`). Separating `Jornada` from contract type is an upcoming UI/contract change, **not yet implemented**; do not map schedule values to contract types and do not infer missing legacy dimensions.

## 13. Metrics, dashboards and reporting

- **MET-1.** `Executive summary` means an organization-wide operational overview, **not** a candidate summary or an assumed AI-generated narrative. It must show each recruiter's performance and each vacancy's progress, elapsed time and current status. Keep lifecycle, delivery and coverage distinguishable and preserve the agreed attribution/time rules. Detailed layouts, filters and metric formulas are open.
- **MET-2.** Both `Propietario` and `Stakeholder` can access the full executive overview within their organization. `Stakeholder` remains read-only.
- **MET-3.** `Reclutador` sees their own metrics and vacancies where they are principal or collaborator, without access to other recruiters' individual performance.
- **MET-4.** The company dashboard already has a chart, currently titled `Origen de las postulaciones` in the frontend (discovery shorthand described it as `origen de las vacantes`); retain it. This is **not** a request for new candidate-source tracking. Its real data source remains unverified.
- **MET-5.** Add separate charts for candidate-delivery time and hiring-coverage time. Do not merge the two metrics.
- **MET-6.** Ignore the initial "Trust" note.

## 14. Auditability (core requirement)

- **AUD-1.** Any critical change affecting behavior or results must leave explainable historical evidence: what changed (previous/new values where applicable), which user, when, and any generated consequence for delivery, coverage or metrics.
- **AUD-2.** Examples include deadline/target/milestone edits, publication and pauses, assignments, hiring/reversal, and changes to process rules.
- **AUD-3.** Users must be able to inspect whether delivery was on time, the evidence candidates, later `Placement` departures, departure timestamps and candidate details. Current state must not overwrite the historical explanation.
- **AUD-4.** Record when an edit itself caused fulfillment.
- **AUD-5.** Record acting user, previous/new assignee and timestamp on assignment changes (see ASG-4).
- **AUD-6.** Checklist replacement co-writes `JobDraftChecklistConfigured` (`job_draft`) with version and complete `previous`/`new` checklist snapshots encoded as JSON strings. Rejected writes and identical stored replacements produce no event.
- **AUD-7.** Mark changes co-write `ParticipationChecklistMarked` (`process_participation`) with `vacancy_id`, `criterion_id` and JSON-string `previous`/`new` verdict/note snapshots (`"null"` when absent). No-ops and rejected writes produce no event.

## 15. Worked examples (agreed behavior)

These examples are the approved behaviors to reason about and to test against; they are not exhaustive test cases.

1. **Target reduction triggers fulfillment now.** A process targets five delivered candidates and three are already delivered. The recruiter reduces the target to three, which makes the three already-delivered candidates sufficient. Fulfillment occurs at the edit time, not by rewriting the earlier period.
2. **Cutoff change uses history.** Changing the cutoff to an earlier stage counts candidates who *previously* reached it, using recorded movements and counting each person once. If that fulfills the target, fulfillment happens at change time and the system records which candidates explain the result.
3. **Five deliveries for two hires.** The delivery target can be five while the hiring headcount is two. Fulfilling delivery does not close the vacancy; reaching full coverage does not close it automatically either.
4. **Pause and resume.** Pausing stops active delivery time. Resuming continues accumulated time. The commitment date does not move automatically. Coverage duration, however, is calendar time from publication without subtracting pauses — the two metrics intentionally differ.
5. **Inserted required stage.** Adding a required stage in the middle does not push candidates already beyond it backward. That stage is recorded as not applicable due to process change, never completed, and must not falsely count as delivery.
6. **Discard and recovery.** A candidate discarded from any stage and recovered returns to the previous stage after confirmation. If that stage is `Placement`, renewed occupancy is explicitly confirmed before restoring hiring/coverage.
7. **Replacement after departure.** A hire departs after a fulfilled, closed original process. A linked replacement process is created under the same logical vacancy, with its own recruiter/target/commitment/pipeline/clock, started explicitly. Reusing a candidate does not automatically fulfill the replacement; renewed delivery must be recorded explicitly for that process.
8. **Hidden salary excluded from filtered search.** A vacancy with hidden salary still appears in searches without salary criteria, but is excluded when a public amount/range filter is active (SAL-5).
9. **Visibility off, process intact.** A candidate disables global discoverability, so they leave global search and direct global-profile links stop working. Existing applications/participations are not withdrawn.
10. **No CV, no application.** An organic application cannot be saved without a CV, and no employer setting may re-enable CV-less applications.

## 16. Agreed scope clarifications

These points are decided. They are recorded here because earlier shorthand could be misread as a conflict. They are **not** requests to reconfirm business behavior.

1. **Reporting and process results.** Reporting groups the original and replacement processes under one logical vacancy, supporting separate process results and combined history (REP-9, DEL-10). Replacement processes are not counted as unrelated new vacancies.
2. **Delivery is per process, with renewed delivery.** Delivery is evaluated independently per process, not once per logical vacancy. The same candidate is counted at most once **within a single process** (DEL-3). Across processes under the same logical vacancy, a candidate's renewed delivery is recorded explicitly and independently for the replacement process (REP-6, REP-11); earlier delivery never auto-fulfills the new process.
3. **One principal per process.** Each process has one principal responsible recruiter at a time (ASG-9), and a replacement process has its own principal (REP-1), which may differ from the original's. Responsibility is a per-process assignment, not a global role.
4. **Clock start.** Original-process delivery starts at publication; replacement delivery starts at its explicit configured start (CFG-1, REP-3). Publishing a replacement later does not restart its clock (REP-4). Neither case is a freely configurable clock-start choice.
5. **Cutoff stage.** Any normal progression stage may be the configured delivery cutoff, including the first column `Nuevos`; `Descartados` is not a delivery stage (PIPE-7). The open item is how a cutoff change or column reordering is evaluated against recorded history, not whether `Nuevos` is a valid cutoff.
6. **Explicit resumed delivery vs automatic ordinary transitions.** Ordinary progression fulfills automatically when the distinct-candidate target reaches the configured milestone, with no separate approval role (DEL-1). The replacement-resumption path is a controlled, explicitly confirmed exception: the recruiter confirms the resumed starting stage and records renewed delivery for that process (REP-10, REP-11). The remaining open item is intake at stages with critical actions, especially `Placement` (section 17).

## 17. Open decisions

These are genuinely undecided. They are extensions of confirmed rules, not contradictions, and do not repeat settled behavior. Do not treat any as agreed.

1. **Pipeline edge cases.** Recovery when the previous stage no longer exists; exact effects of reordering existing required steps on active candidates (PIPE-16/PIPE-17). Normal discard recovery, additional-column placement, mandatory progression and inserted-stage exemptions are confirmed.
2. **Business-day calendar.** Authoritative Mexican mandatory-rest calendar sourcing, partial days and business-day early/late calculation (CFG-8). Monday–Friday exclusion and business-day-only commitment dates are confirmed.
3. **Collaboration and reporting.** Collaboration permission details and fair recruiter-level reporting (ROLE-6, ASG-10). One principal per process is confirmed.
4. **Replacement lifecycle.** Lifecycle labels (including which states count as active), public-listing mechanics and critical-action intake semantics, especially intake into `Placement` (REP-12, REP-10). One active replacement per logical vacancy, serialized replacements, linked processes, selective reuse, separate reporting and explicit start are confirmed.
5. **Field inventory and requester model.** Exact parity of recruiter-intake fields against the real candidate UI (INT-7), requester/client catalog maintenance (REQ-3); inline persistence and normalized duplicate selection are confirmed.
6. **Identity, privacy and documents.** Candidate identity/deduplication (DEL-3, INT-14), retention/deletion/anonymization and secure storage (PRIV-12, DOC-1, DOC-10), and external extraction feasibility (INT-16).
7. **Access, search and reporting details.** Sensitive-document access and role enforcement, advanced-search grammar/indexing (SRCH-9), executive-summary metrics/filters and `origen`/source reporting (MET-1). Organization-wide overview and organization-scoped read-only `Stakeholder` access are confirmed.
8. **Salary comparison details.** Cross-unit comparison and boundary/one-sided filter input (SAL-2, SAL-8). The initial currency catalog (`MXN`, `USD`) and pay-period catalog (`por hora`, `semanal`, `quincenal`, `mensual`, `anual`) are confirmed (SAL-2); no gross/net or currency/pay-period conversion is approved.
9. **Pipeline filtering combinations.** Substates combined with other filters and cross-vacancy reporting semantics (SUB-5).
10. **Vacancy public-content validation.** Exact required public content at publication mapped against existing forms (VAC-3).
11. **Backend end-to-end design review** before any implementation plan is treated as closed. This is the backend owner's design work, not a product question.

## 18. Non-goals and explicit rejections

- No implementation is authorized by this document. It is a business reference, not a build order.
- No login/auth implementation and no AWS-dependent infrastructure work in this discovery scope; access boundaries must not be erased from design.
- No infrastructure rebuild is authorized.
- No currency conversion and no gross/net conversion in this scope (SAL-2).
- No AI-generated candidate narrative is implied by `executive summary` (MET-1).
- No automatic application rejection from education/experience/language requirements (INT-22).
- No external-contact activity log for recruiter outreach (INT-4).
- No insurance, flexible-hours or training **filters** (the benefits themselves remain in vacancy data) (SRCH-1).
- No cross-organization data access from identity reuse (INT-5, ROLE-8).
- No birth date or age collection, derivation or display (PRIV-1).
- No cover letter in the application process (INT-18).
- No freely configurable clock start: original-process delivery starts at publication and replacement delivery starts at its explicit configured start (CFG-1).
- No custom organization calendars in initial scope (CFG-8).
- No three-separate-requester-fields model (REQ-5).
- No public exposure of draft or never-published replacement processes (VAC-6).
- No general post-closure business edits and no rewriting of historical results: no reopening by a departure event, and no retrospective change to the original hiring event, delivery KPI, historical coverage milestones or closure. Explicitly agreed exceptions remain allowed: document attachments (DOC-4) and recorded later departures with confirmation and audit, which change only current coverage (REP-7, DEL-5, DEL-9, REO-2).

## 19. Source, status and maintenance

- **Source:** `odd/discovery/recruitment-business-rules.md`, itself synthesized from the product owner's WhatsApp notes and clarification messages. Explicit confirmations supersede earlier tentative ideas (notably configurable clock start, birth-date retention and salary conversion).
- **Status:** discovery is ongoing. Confirmed rules are separated from agreed scope clarifications and open decisions above. This document does not authorize feature implementation, commits or tasks.
- **Maintenance:** when a product decision changes, update the corresponding numbered rule and, if it closes an open decision, move it out of section 17. Record agreed shorthand clarifications in section 16; add only genuinely unresolved items to section 17.
