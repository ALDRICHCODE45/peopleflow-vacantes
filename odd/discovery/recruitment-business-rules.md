# Recruitment business rules — discovery record

This document records product discovery with the user, not an implementation plan or an implemented contract. Its purpose is to preserve confirmed decisions separately from proposals and unresolved questions before frontend/backend design.

## Status and working agreement

- Discovery is ongoing. Only this documentation is authorized now; no feature implementation is authorized by this record.
- Product targets recruiters and HR teams in any company, not only recruiting agencies.
- Prior UI demonstration was presented successfully; sample-vacancy deployment was completed by the user.
- Continue ODD with bounded end-to-end iterations. Discuss feature design with the backend agent before implementation, then coordinate frontend/backend work in separate worktrees against agreed contracts.
- User requests RDD and applicable reviews for implementation. Activation has not been verified or changed during this discovery.
- Defer login/auth implementation and AWS-dependent infrastructure work; do not erase access boundaries from feature design.
- Prefer TanStack Query for client remote state and native Next.js capabilities where appropriate. Evaluate Zod and Zustand based on need, not by default.
- Backend is implemented in Go under backend/. Ask the backend agent for capability/contract evidence rather than independently inspecting its internals. User expects substantial AWS groundwork already exists; reuse it where verified, but do not assert business-only implementation scope without the backend owner's assessment. No infrastructure rebuild is authorized.
- Backend capability consultation is requested; implementation verification has not occurred for the decisions below.
- After product discovery is closed, produce a detailed clean business-rule document outside `odd/`, accessible to the backend agent. Do not forward raw conversational noise as the specification.
- Also map existing frontend-demonstrated functionality requiring real integration, beyond this session's new requirements. Distinguish confirmed real integration, local/mock behavior and unverified backend support using repository evidence; UI presence alone does not prove backend absence.
- Then contact the backend agent through intercom with document access, context, scope and coordination plan. Backend owns its technical decomposition and implementation design; do not prescribe its internals or absorb its entire codebase into frontend context.
- Agents should exchange contract questions and technical clarifications directly. Refer to settled product decisions instead of asking the user to repeat them; escalate only genuine new product decisions or conflicts. Verify document accessibility across worktrees rather than assuming an uncommitted frontend file exists in the backend worktree.

## Confirmed: vacancy lifecycle, delivery and coverage

These are three independent dimensions; candidate pipeline stages are not vacancy lifecycle statuses.

| Dimension | Values / meaning |
| --- | --- |
| Vacancy lifecycle | Borrador, Publicada, Pausada, Cerrada |
| Delivery fulfillment | Pendiente, Cumplida |
| Hiring coverage | Sin cubrir, Parcialmente cubierta, Cubierta |

- Creating a draft does not start the delivery clock. Publishing starts it.
- Allow incomplete drafts. Publication requires the principal recruiter, requester (internal area or external client), request date, required hiring headcount, candidate delivery target, delivery cutoff stage and commitment date, alongside the offer's required public content. These management fields are internal, including hiring headcount; requiring them to publish does not expose them publicly. Exact public-content validation must be mapped against existing forms.
- Candidate-facing vacancy content consists of the offer (title, description, requirements, location, work modality, contract type and benefits), plus salary only when explicitly enabled. Do not expose internal management fields in public representations.
- Pausing stops active delivery time; resuming continues accumulated time without resetting it.
- When a previously public vacancy is paused or closed, remove it from public search and block new applications. Preserve direct-link access to its public detail with a Pausada or Cerrada notice and keep existing applications. This does not authorize exposing drafts or never-published replacement processes.
- Preserve total calendar duration and pause history separately.
- Delivery fulfillment does not close the vacancy. Full coverage does not close it automatically either; closure is manual without an additional approver.
- Closing a vacancy requires a reason: Cubierta, Cancelada or Otro. Otro requires an explanation; Cubierta is allowed only when the required positions are filled. Closing never automatically fulfills candidate delivery. Remaining transition details require design.
- Required delivered-candidate quantity is independent of required hiring headcount (for example, five delivered candidates for two hires).
- Moving a candidate into semantic Placement confirms hiring and adds one covered position.
- Moving that candidate out of Placement requires explicit confirmation and reduces coverage. Preserve the hiring/departure history and do not erase fulfilled delivery or its KPI.
- Count the same person only once per vacancy for delivery and do not double-count coverage through duplicate records or repeated transitions. Deduplication mechanics remain to be designed.

## Confirmed: per-vacancy candidate pipeline

Default columns:

1. Nuevos
2. Screening
3. Screening OK
4. En proceso
5. Placement
6. Descartados

This list identifies defaults; it is not a requirement to pass through Descartados as a normal progression step.

- Each vacancy has independent column names/order, substates and delivery cutoff configuration.
- Default columns can be renamed; order persists. Progression columns can be reordered before Placement, which remains the final hiring step. This approved constraint narrows the initial unrestricted reorder request.
- Allow at most three additional user-named columns.
- Unlimited user-defined substates are supported only inside semantic En proceso. Primera entrevista, Segunda entrevista, Pruebas psicométricas and Propuesta entregada were examples, not mandatory built-in substates.
- A candidate has at most one active substate at a time, with history of changes. Substates are tracking labels, not mandatory sequential steps; candidates need not traverse all of them or follow an order.
- Support filtering vacancy pipeline candidates by their active substate. Allow multiple selections with OR semantics: match any selected substate. Include Sin subestado for candidates currently in En proceso with no assigned substate. Combination with other filters and cross-vacancy reporting semantics remain to be defined.
- Names do not change semantic functions. Renaming Placement still leaves its hiring/coverage effect; renaming En proceso retains its substate behavior.
- Renaming a column with a critical action requires a dialog explaining that the action remains unchanged.
- A configured column counts as the delivery milestone. Fulfillment is automatic when the distinct-candidate target is reached; no separate approval role is required.
- Count historical attainment of the delivery milestone, not merely current occupancy. Advancing or withdrawing later does not erase a previously recorded delivery.
- Ordinary progression must not skip required stages. Descartados is an exceptional exit available from any stage, not a mandatory progression step.
- Recovery from Descartados requires confirmation and returns the candidate to their previous stage, retaining both discard and recovery history. If that stage was Placement, explicitly confirm renewed occupancy before restoring hiring/coverage; never restore it silently. Recovery when the previous stage no longer exists remains unresolved.
- Moving a candidate to Descartados requires a recorded reason, distinguishing recruiter rejection from candidate withdrawal. An additional explanatory comment is optional. Reason catalog remains to be defined; do not conflate all discards with recruiter decisions.
- Backward movements retain history; leaving Placement has the confirmation and coverage consequences above.
- Removing a used column/substate must not remove historical evidence. Resolve occupants before removal and replace any active cutoff configuration before deleting its column.

### Confirmed: additional-column progression

- Extra columns are ordinary required steps inserted before Placement, not alternative terminal outcomes or post-hiring selection steps.
- Additional columns do not acquire hiring semantics; Placement retains that function. Documents and post-hiring follow-up remain within Placement.
- Any normal progression stage may be configured as the delivery cutoff; Descartados is not a delivery stage.
- Keep Descartados outside the ordered normal progression.
- Use substates inside En proceso for detailed activities instead of adding columns for every interview.
- Reordering progression steps is a behavior-changing configuration edit, with impact preview and audit.
- Preserve already attained historical milestones when adding/reordering steps; do not silently move candidates or rewrite completed results.
- When adding a required stage, candidates already beyond its insertion point are not forced backward. Record the stage as not applicable due to process change, never completed; it must not falsely count as delivery. The stage applies to candidates who have not yet passed that point. Detailed effects of reordering existing stages remain open.

## Confirmed: delivery configuration and historical evaluation

- Delivery cutoff column is configurable per vacancy; clock start is publication, not configurable at present.
- Before fulfillment, the delivery quantity and cutoff column may be edited with audit history.
- At fulfillment, freeze the target, milestone and evaluation inputs as part of the historical result.
- If reducing a target from five to three makes three already-delivered candidates sufficient, fulfillment occurs at the edit time, not retrospectively.
- When changing the cutoff, use recorded candidate movements to determine who previously reached the new milestone, counting each person once. Current occupancy alone is insufficient.
- If that change fulfills the target, fulfillment occurs at change time. Preview the impact before confirmation and record which candidates explain the result.
- Exact historical substate/column eligibility and transition edge cases require backend design; do not infer eligibility from visual column order alone.

### Commitment date and time basis

- Each vacancy has a configurable fecha compromiso de entrega / fecha máxima de entrega.
- Pauses do not automatically move this date.
- Date edits must be explicit and record previous value, new value, acting user and timestamp.
- At fulfillment, evaluate against the commitment date then in force. Later edits cannot rewrite an early/on-time/late result.
- Use business days for day-based performance reporting: Monday through Friday, excluding Mexico's official mandatory rest days. No custom organization calendars in the initial scope. Authoritative calendar sourcing, year coverage and partial-day rounding remain to be designed/verified; this record does not enumerate legal dates.
- The commitment date includes the entire local day; the following day is outside the commitment date even if business-day lateness rounding needs further definition.
- Commitment dates must fall on a business day. Reject weekends and official mandatory rest days with an explanation and ask the user to choose another date; never silently shift it.
- Initial publication from draft is blocked if the commitment date is already past in America/Mexico_City; require an explicit update before publishing. The current local date is valid if it is a business day because the commitment includes that entire day. This does not require resetting overdue commitments when resuming existing processes.
- Stable organization calculation timezone: Mexico City, `America/Mexico_City`. Do not derive changing KPI boundaries from the viewer's geolocation or travel.
- Preserve the time basis used by historical results. Active elapsed time and calendar commitment compliance are distinct measurements.

## Confirmed: assignment and reopening principles

### Reassignment

- Do not reset the vacancy clock or move its commitment date automatically upon reassignment.
- Close the previous responsible recruiter's assignment interval and start the next one's interval.
- Propietario may assign or change the principal responsible recruiter. Reclutadores may work on authorized vacancies but cannot independently reassign responsibility.
- When a Reclutador creates a vacancy, automatically assign that creator as principal responsible recruiter. Subsequent reassignment requires Propietario. This initial-assignment rule does not start the delivery clock before publication.
- Propietario and the principal responsible recruiter may add/remove collaborator recruiters from the same organization, with audit history. Collaborators cannot manage other collaborators or reassign the principal responsible recruiter. Collaborators may incorporate candidates, move them through the pipeline and manage process documents. Their moves may trigger delivery or coverage, subject to the agreed confirmations and audit. Propietario and the principal responsible recruiter additionally may change targets, commitment date and pipeline configuration, and publish, pause or close the vacancy; collaborators cannot perform those management actions. All actions remain subject to existing lifecycle restrictions, including frozen fulfilled-delivery configuration.
- Record acting user, previous/new assignee and timestamp.
- Show total vacancy active time separately from time assigned to each recruiter.
- Show whether a recruiter received an already-overdue vacancy or how much time remained.
- Do not automatically attribute inherited delay entirely to the last recruiter.
- Explicit commitment renegotiation follows the same audited date-edit policy.
- Each vacancy has one principal responsible recruiter at a time. Other authorized users may collaborate; record the actual actor for each action separately from vacancy responsibility. Detailed collaboration permissions and individual score formulas remain unresolved.

### Reopening

- If closed before delivery fulfillment, reopening resumes the existing commitment and accumulated active time without resetting it. Exclude the closed interval from active delivery time, like a pause; the commitment date does not shift automatically. Preserve closure/reopening history.
- After a fulfilled, closed original process, create a linked replacement process under the same logical vacancy rather than reopening the original or creating an independent duplicate vacancy. Keep the original process closed and its result intact.
- Each replacement process has its own principal recruiter, target, commitment date, pipeline and clock, with a link to its source process and the specific hiring being replaced.
- Do not overwrite/reset the original fulfilled KPI. Later departure events remain visible without rewriting historical delivery or closure results.
- A replacement process starts explicitly after its delivery target and commitment date are configured. That event begins its clock; do not reuse the original publication timestamp.
- Replacement publication is optional and separate from starting work. An unpublished replacement can use existing candidates or recruiter-introduced candidates. Publishing later does not restart its clock.
- Reuse candidate identities without duplicating people. The recruiter chooses which candidates to resume, with separate participation in the replacement process. Previous delivery events never automatically fulfill the new process; any renewed delivery must be recorded for that process.
- Record the departed hire, departure timestamp and reason without erasing the prior hiring. Any move to Descartados in the original process is historical evidence, not grounds to automatically add that person to the replacement as discarded. Identify the particular hiring being replaced when multiple positions were covered.
- Report one logical vacancy with its original and replacement processes, supporting separate process results and combined history rather than counting replacements as unrelated new vacancies.
- For resumed candidates, show their previous stage as reference and let the recruiter explicitly confirm the starting stage in the replacement process. Audit this controlled intake exception to the no-skipping rule; do not require unnecessary repetition of prior assessments. Intake itself never automatically counts as renewed delivery; record renewed delivery explicitly for the replacement process.
- Allow only one active replacement process per logical vacancy at a time; it may cover multiple positions. Later replacements are sequential processes, preserving all previous ones. Exact lifecycle states considered active must be specified before implementation.
- Exact replacement lifecycle labels, public-listing mechanics and intake at stages with critical actions (including Placement) remain to be designed.

## Confirmed: auditability is a core business requirement

Any critical change affecting behavior or results must leave explainable historical evidence, including:

- What changed, including previous/new values where applicable.
- Which user made the change.
- When it happened.
- Any generated consequence for delivery, coverage or metrics.

Examples include deadline/target/milestone edits, publication and pauses, assignments, hiring/reversal, and changes to process rules.

Users must be able to inspect whether delivery was on time, the evidence candidates, later Placement departures, departure timestamps and candidate details. Current state must not overwrite the historical explanation. Record when an edit itself caused fulfillment.

### Personal data and documents

- Placement supports multiple user-chosen documents per candidate participation/process, such as contracts or CVs; technical limits and supported formats remain undefined. These are internal process documents, not public attachments or automatic additions to the candidate-managed profile.
- Propietario and recruiters authorized for the vacancy may manage candidate process documents; Stakeholder may consult them read-only within the organization. General shared candidate-pool access does not grant access to another process's documents.
- Also support multiple internal documents at vacancy level (for example, vacancy-related contracts) for convenient team access, separate from candidate-specific attachments. Apply the same access model: Propietario and authorized vacancy recruiters manage them, Stakeholder consults read-only. They must not become public vacancy attachments. Vacancy-level documents can be uploaded starting in draft and throughout the process, without waiting for Placement. Replacement processes do not automatically copy original-process documents. Authorized users can consult source documents and explicitly choose which to link to the replacement, preserving source and version references. Linking does not bypass source access or retention/deletion rules. Exact file management operations remain to be defined.
- Authorized users may attach vacancy-level and candidate-process documents after closure without reopening the process or changing its metrics. Preserve the same access permissions and audit the attachment. This does not authorize other post-closure business edits.
- Replacing a vacancy-level or candidate-process document creates a new version rather than silently overwriting it; record the acting user and timestamp. Previous versions remain subject to the retention/deletion policy, not an indefinite-storage guarantee.
- Separate business event history, editable candidate data and document contents.
- Each application or recruiter intake keeps a reference to the CV version used for that participation. Updating the candidate profile CV must not silently replace the document evaluated in existing processes. Version availability remains subject to the document retention/deletion policy, not indefinite storage.
- Preserve only the historical personal data needed to explain a result; do not duplicate a whole CV on every movement.
- A document-removal event may remain without retaining the file forever.
- Withdrawal from a process is different from a personal-data deletion request.
- Retention duration, deletion/anonymization behavior, visibility, secure storage and applicable privacy requirements need explicit design. Auditability does not authorize indefinite retention of sensitive data.

## Confirmed: candidate intake and profile changes

- Recruiters can introduce candidates to a vacancy without an organic application.
- An authorized recruiting user may directly incorporate a currently discoverable global-directory candidate into a vacancy without prior invitation acceptance. Record recruiter-initiated incorporation, never a voluntary application. Directory visibility does not imply candidate acceptance of that opportunity. This does not waive required intake fields or CV. Recruiter-initiated incorporation stays internal until the recruiter explicitly decides to contact the candidate. Intake itself sends no automatic notification and creates no candidate-facing dashboard entry. Do not require or build an external-contact activity log for recruiter outreach in this scope; user explicitly rejected that tracking. Do not infer candidate-facing visibility from an off-platform contact that the system does not track. In-platform messaging scope and any explicit future visibility transition remain undecided.
- A candidate may participate in multiple vacancies simultaneously using one candidate identity/profile, with stage, substate, history and delivery evaluation independent per process. Moving or discarding a candidate in one vacancy must not change other participations. Identity-sharing visibility boundaries remain to be designed; this does not authorize cross-organization data access.
- Such candidates need no PeopleFlow account or self-service profile.
- Recruiter manual intake must expose the candidate profile fields currently offered in the candidate dashboard profile section, subject to the agreed removals/changes (notably no birth date). Inventory the real UI before defining exact field parity; this is not a minimal contact-only form.
- Required manual-intake fields: name, education level, contact method, residence/location and CV. Other available profile fields remain optional unless separately agreed. CV is mandatory, superseding the assistant's optional-CV proposal. Require at least one contact method: email or telephone; allow both. Exact format validation remains to be designed.
- For recruiter manual intake, residence requires city and municipality/alcaldía; postal code is optional. Do not require a full street address.
- Support manual form entry and desired assisted prefill from CV, LinkedIn and OCC for both recruiter intake and candidate self-service profiles.
- Assisted extraction prefills an editable form for recruiter review and correction before saving; it must not silently create the candidate. Missing required fields must be completed. If extraction fails, allow manual completion without losing the uploaded CV.
- If intake email or telephone matches an existing candidate record, show a possible duplicate before creating another record so the recruiter can review and reuse the existing identity. Never merge automatically: shared contact information is not proof of identical identity. Search visibility boundaries and confirmed-distinct override mechanics remain to be designed.
- A CV attachment is always required before saving recruiter candidate intake, regardless of manual entry, CV parsing, LinkedIn or OCC prefill. External profile data or a profile URL never substitutes for the CV document. Do not infer self-service profile draft/persistence rules from this intake requirement.
- External-platform extraction feasibility/permissions are not verified. Saving a URL, parsing a CV and importing external profile data are different capabilities.
- Remove both birth date and age entirely from candidate profile fields (public and private), application flow and recruiter intake. Age is not an optional public field; do not collect, derive or display it as a structured profile field. Treatment of existing stored data and age/birth-date information embedded in uploaded CVs still requires explicit privacy design.
- CV is mandatory for organic candidate applications as well as recruiter intake. Remove the employer setting that permits applications without CV; it must not remain a configurable exemption. This does not require a CV just to save an incomplete self-service profile unless separately agreed.
- Remove the cover letter from the application process.
- Salary inputs (current, expected, vacancy, etc.) need gross/net selection, currency and pay period. Default currency to MXN and pay period to monthly (mensual), both editable. Apply this to current salary, expected salary and vacancy compensation. The initial shared currency catalog is confirmed as MXN (pesos mexicanos) and USD (dólares estadounidenses); the initial shared pay-period catalog is confirmed as por hora, semanal, quincenal, mensual and anual. Quincenal is the confirmed label for a twice-a-month period; it is not every-two-weeks (biweekly/catorcenal) and does not fix payroll cut-off dates. These are business labels, not a technical schema; their representation remains to be defined. The catalogs are confirmed, not implemented. Cross-unit search/comparison behavior remains to be defined. No automatic conversion between currencies or between pay periods is approved, and no gross/net conversion is approved in this scope.
- Vacancy compensation supports an explicit choice between fixed amount and salary range. Keep the internal compensation data separate from its public visibility: the recruiter chooses whether to show it on the public vacancy. Vacancy salary is hidden publicly by default and requires explicit recruiter activation to publish. Public salary filters must never compare against hidden internal compensation. Vacancies with hidden salary remain eligible for searches without salary criteria but are excluded whenever a public amount/range filter is active.
- Public salary filters let users select currency, pay period and gross/net basis. Compare published salaries only when all three match, without implicit conversions. Match ranges when the published offer overlaps the requested range at least partially. A fixed amount matches when it falls within the requested range. Example: a 30–40k search matches a 35–45k offer and a fixed 38k offer, provided currency, pay period and gross/net basis match. Boundary inclusion and one-sided filter input details remain to be specified. Do not extend this fixed/range choice to candidate salaries without confirmation.
- Include municipality/alcaldía, city and postal code; exact applicable forms remain to be mapped.

## Confirmed or bounded intent: vacancy fields, roles and search

- Preserve support for Cliente on the vacancy, but do not require a separate client company for internal recruitment.
- Requester is a choice between Área solicitante (internal department) and Cliente (another company), not mandatory parallel company/department fields. User expects Área solicitante to be the predominant case. Preserve requester type/value for filtering and reports.
- Default to Área solicitante. Areas and external clients are reusable organization-scoped lists; allow adding an entry from the vacancy form rather than storing unrestricted per-vacancy free text. This supports consistent filters/reports. Inline creation persists the catalog entry even if the vacancy draft is later cancelled; warn before creating it. Within the same organization and requester type, ignore letter case and surplus whitespace when detecting duplicate names, but preserve accents. Offer the existing entry for explicit selection rather than creating a duplicate or automatically merging/selecting it. Catalog maintenance remains to be designed.
- Área solicitante / Cliente is internal information, separate from the publicly displayed hiring company. Do not expose this requester field on public vacancy pages.
- Public Área profesional describes the job's discipline (for example, Tecnología y sistemas for a backend developer under the approved initial catalog); internal Área solicitante / Cliente identifies who requested recruiting (for example, Departamento de TI or Cyber Power). These are two independent concepts and must both remain: the proposal to replace professional area with requester was rejected. Professional area is required for publication, but incomplete drafts may leave it empty. The approved initial platform-wide catalog has 16 options: Tecnología y sistemas; Ingeniería; Producto; Diseño y creatividad; Ventas y desarrollo comercial; Marketing y comunicación; Administración y finanzas; Recursos humanos; Operaciones y producción; Logística y transporte; Atención y soporte al cliente; Salud; Educación y capacitación; Legal; Construcción y mantenimiento; Turismo, hotelería y gastronomía. Ingeniería covers disciplines such as industrial, mechanical and electrical engineering. This refines the earlier backend-to-Ingeniería example; it is not authorization to infer legacy-data reclassification. Do not infer mappings between public disciplines and organization-scoped requester entries. Separate public offer information from internal request information in the form; this is upcoming behavior, not implemented persistence.
- Any optional contact-person field remains unconfirmed; the earlier assistant proposal of three separate requester fields was not accepted.
- Fecha de solicitud and fecha de requerimiento mean the same thing: keep only Fecha de solicitud, recording when filling the position was requested, independently of draft creation and publication. It does not start the delivery KPI.
- Fecha ideal de contratación is an optional target hiring date, separate from the delivery commitment date. It does not affect the delivery KPI.
- Fecha de cierre is recorded automatically when the recruiter closes the vacancy, not entered manually. Reopening preserves that closure in history; each subsequent closure creates a new timestamped event. Keep closure separate from publication, target hiring and delivery commitment dates.
- Remove/defer for now the optional application-deadline input, currently labeled Fecha de cierre with helper Fecha límite para recibir postulaciones: do not store it without expiry behavior. This field is not the actual closure timestamp and must not be reinterpreted as one; the automatically recorded actual Fecha de cierre above is unaffected.
- Existing owner/recruiter roles remain. Stakeholder is read-only and may consult vacancies, candidates, history, recruiter performance and metrics belonging to their own organization only, never other organizations' information. No modifications are permitted. Sensitive-document access and detailed enforcement still require design.
- Ignore the initial Trust note.
- Education, languages and location must be represented; inspect existing fields before adding duplicates.
- Education, experience and language requirements inform users and support filtering; they do not automatically reject applications. The recruiter decides. Explicit knockout criteria would require a separately agreed future rule.
- Distinguish candidate education level from the vacancy's minimum required education level. Record education completion status (en curso, concluidos, incompletos) separately so ongoing studies are not represented as completed qualifications. Education catalog, treatment of multiple educational records and vacancy acceptance/matching rules remain to be defined.
- Candidate profiles and vacancy requirements support multiple languages, with a level per language: básico, intermedio, avanzado or nativo. Language choices are Español, Inglés and Otro with the language specified. Exact matching rules and field requiredness remain to be designed; do not assume native-level filtering semantics.
- Keep both Seniority and Años de experiencia as separate fields in candidate profiles and vacancy requirements. Rename the existing seniority-equivalent field rather than introducing a duplicate; verify existing form semantics during inventory. Candidate experience is a nonnegative number of years, allowing decimals (for example, 1.5) and 0 for no experience. Vacancy experience is a minimum required number of years, not a maximum that excludes more experienced candidates. Exact seniority options, numeric precision and validation bounds remain to be defined.
- Contract options: Por proyecto, Indeterminado, Servicios profesionales / Contractor, Temporal, Becaría. User explicitly approved merging Contractor and Servicios profesionales into one product-catalog option. Each vacancy has exactly one contract type, not multiple alternatives. This catalog is not a legal classification; existing-data/API mapping remains to be designed.
- Jornada (Tiempo completo / Medio tiempo) and Tipo de contratación (the contract list above) are separate vacancy fields and must not be combined; Jornada is also distinct from Modalidad (presencial/remoto/híbrido). The current UI's single employment_type field labeled Jornada mixes schedule with contract and must be split; this is an upcoming change, not implemented. Existing employmentType values (full_time/part_time/contract/internship) must not be read as contract types, and missing legacy dimensions must not be inferred.
- Other benefits supports multiple custom benefits, not a single free-text item, displayed alongside predefined benefits in the public vacancy detail.
- Add font-size control to the vacancy rich editor with predefined pequeño, normal and grande options, not arbitrary sizes, preserving consistent mobile readability. Exact styling values remain an implementation design detail.
- Public filters: label Idioma adicional, options Español/Inglés/Otro with custom language entry. Remove insurance, flexible-hours and training filters, not those benefits from vacancy data.
- Advanced search is required in two separate scopes: Talento PeopleFlow (opted-in global profiles) and Candidatos de mi organización (internal records subject to existing access rules). Keep them separate rather than merging their results or exposing private organization data globally.
- User identifies the existing sidebar DB interna entry as the internal-candidate concept, currently presented as a table. Add a card view alongside the table. Both views share results, filters and sorting; switching only changes presentation and must not reset the search. Verify current UI and real integration during inventory; user description does not prove backend implementation.
- Reclutador may consult the shared internal candidate pool across their own organization to reuse talent, even when a candidate is not linked to their assigned vacancies. This does not grant access to unrelated vacancy notes, evaluations, history or other recruiters' performance; process-level information remains restricted to authorized participants/roles. Other organizations' internal records remain inaccessible.
- Authorized recruiters may edit the organization-internal candidate record with audit history, but never directly change the candidate-managed PeopleFlow profile. Internal corrections must not overwrite that personal profile or another organization's records. Shared candidate identity/reuse does not imply shared write ownership; exact internal editing permissions remain to be designed.
- Candidate-managed profile updates must not automatically overwrite internal records. While the recruiter is still authorized to view that global profile, show differences and let them explicitly select which updates to incorporate, with audit history and preservation of unselected internal corrections. Do not use synchronization to bypass disabled global visibility or silently replace participation-specific CV versions.
- Keep Talento PeopleFlow as a separate recruiter-facing discovery area.
- Advanced candidate search includes a global PeopleFlow talent directory (OCC-like), not only an organization's internal candidate pool. Registered candidates can enable/disable public profile visibility to allow recruiter discovery. This does not authorize publishing recruiter-created internal candidate records or organization-private evaluations/documents.
- User wants control of potentially discriminatory public-profile information, including optional photo visibility and other fields still to define. User explicitly clarified that age must be removed entirely, not offered as an optional public field, consistent with birth-date removal. Global-directory visibility is disabled by default. The candidate must explicitly activate it and can deactivate it later to stop appearing in new searches.
- Public in this context means discoverable only by authenticated recruiting users authorized for talent search, not anonymous internet visitors or search engines. Both Reclutador and Propietario may search global talent and incorporate candidates; Propietario may act as a recruiter. Candidate accounts cannot search other candidates. Stakeholder has no global talent-search access and retains organization-internal read-only visibility.
- When the candidate enables recruiter discoverability, profile photo is the only independently optional shared profile item. Available email, phone and CV are shared with authorized recruiting viewers as part of that visibility choice, without separate field-level sharing toggles. This does not require collecting both contact methods or expose internal employer data, nor reinstate age/birth date. Make the scope of sharing clear when activating visibility. Profile photo is hidden from recruiting viewers by default; the candidate must explicitly choose to share it. Disabling discoverability removes the candidate from global searches and prevents global-profile consultation, including via direct links; it does not automatically withdraw applications or existing recruitment participations. Those retain their process-scoped information subject to privacy/retention rules, not ongoing unrestricted access to a hidden global profile. Exact shared-profile inventory and technical propagation of visibility changes remain unresolved.
- Advanced search combines structured profile fields (location, education, seniority, years of experience and languages) with CV keywords using AND, OR and NOT. Provide visual controls for structured profile filters plus a Boolean search input for CV text, without requiring expressions for structured fields. The approved interaction example is `("Java" OR "Kotlin") AND "Spring" NOT "practicante"`. Exact grammar (including implicit conjunction before NOT), validation, text extraction/indexing behavior and relevance ranking must be specified with backend before implementation; recruiter visibility restrictions apply to all results.
- Executive summary means an organization-wide operational overview, not a candidate summary or an assumed AI-generated narrative. It must show each recruiter's performance and each vacancy's progress, elapsed time and current status so users can understand the overall recruitment state of their organization. Keep lifecycle, delivery and coverage distinguishable and preserve the agreed attribution/time rules. Detailed layouts, filters and metric formulas remain to be designed.
- Both Propietario and Stakeholder can access the full executive overview within their organization. Stakeholder remains read-only.
- Reclutador sees their own metrics and vacancies where they are principal responsible recruiter or collaborator, without access to other recruiters' individual performance. Detailed access enforcement remains to be designed; collaborator membership and operational permissions follow the confirmed assignment rules above.
- User clarifies the company dashboard already has a chart described as origen de las vacantes; retain it. This is not a request for new candidate-source tracking. Inspect the existing chart during UI inventory to verify its actual data/labels.
- Add separate charts for candidate-delivery time and hiring-coverage time. Delivery measures fulfillment of the recruiter's agreed candidate commitment; coverage measures filling the required positions. Do not merge the two metrics.
- Hiring-coverage duration is calendar elapsed time from original publication until all required positions are filled, without subtracting pauses. For replacements, use that process's explicit start instead of original publication. This differs intentionally from active delivery time.
- Whenever full coverage is achieved, preserve a timestamped coverage milestone and its duration. Later departures reduce current coverage without deleting that milestone; reaching full coverage again creates another event. Current coverage and historical coverage achievements must remain distinguishable.
- The coverage-time chart uses time to first full coverage per process, counting each process once even if it later loses and regains coverage. Subsequent achievements remain in history; distinguish replacement processes from originals. Aggregation, reporting period and other filters remain to be defined.

## Open decisions to address next

1. Recovery when the previous stage no longer exists and exact effects of reordering existing required steps on active candidates; normal discard recovery, additional-column placement, mandatory progression and newly inserted-stage exemptions are confirmed above.
2. Authoritative Mexican mandatory-rest calendar sourcing, partial days and business-day late/early calculations; Monday–Friday excluding official mandatory rest days and business-day-only commitment dates are confirmed.
3. Collaboration permission details and fair recruiter-level reporting; one principal responsible recruiter per vacancy is confirmed.
4. Replacement lifecycle labels (including which states count as active), public-listing mechanics and critical-action intake semantics; one active replacement per logical vacancy, recruiter-confirmed starting stage for resumed candidates, linked processes, selective reuse, separate reporting and explicit start are confirmed. Pre-fulfillment closed intervals are excluded from active delivery time without shifting the commitment date.
5. Field inventory and requester/client model.
6. Candidate identity/deduplication, privacy, document access/retention and extraction feasibility.
7. Sensitive-document access and detailed role enforcement, advanced search, executive-summary metrics/filters and source/origin reporting; organization-wide overview and organization-scoped read-only Stakeholder access are confirmed.
8. Backend end-to-end design review before any implementation plan is treated as closed.

## Source and maintenance

Source: the user's WhatsApp notes and subsequent clarification messages in this frontend session. This is a structured synthesis, not a verbatim transcript. Explicit confirmations supersede earlier tentative ideas (notably configurable clock start, birth-date retention, and salary conversion).

Update this document as discovery proceeds, keeping proposals/open questions distinct from confirmed decisions. It is not an ODD implementation task checklist; no feature tasks or commits are authorized by its existence.
