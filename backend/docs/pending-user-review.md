# Backend work pending the user's browser review

The user is away from a browser and asked both agents to keep implementing and to
accumulate what needs review (L28 in `odd/tasks/pipeline-customization.md`). Nothing
listed here is merged into `main`. Branches are stacked; review and merge them **in
order, bottom first**. Each backend branch is paired with the frontend branch that
implements its UI.

| Order | Backend branch | Frontend branch | Scope | How to test | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | `feat/vacancy-publication` (from `main` 79cda65) | `feat/vacancy-publication-ui` | Publication P1: «Solicitud» (request date, headcount), readiness checklist, publish, portfolio status | Frontend `docs/employer-manual-test.md` steps 29–33; backend `make db-migrate` applies 00018 and 00019 | Backend verified (L27); approved by the user (L70), merged into local main |
| 2 | `feat/vacancy-public` (stacked on 1) | `feat/vacancy-public-ui` (stacked on its P1 branch) | P2a: published vacancies in the public listing/detail (`/v2/jobs`), guard that keeps published content complete | Frontend `docs/employer-manual-test.md` steps 34–36; backend `make db-migrate` applies 00020 | Backend verified and native review approved (L34, L36); approved by the user (L70), merged into local main |
| 3 | `feat/candidate-identity` (stacked on 2) | `feat/candidate-identity-ui` (frontend steps 37–40) | P2b0: candidate sign-up/sign-in, explicit onboarding, candidate-only routes | API setting `IDENTITY_USERINFO_ENDPOINT` (value never committed); [contract and console checks](candidate-identity.md); sign up/verify email, onboard in `/candidato`, retry without rename, verify cross-role guards and recruiter flow | Backend verified (L40, L41); approved by the user (L70), merged into local main and the console checks |
| 4 | `feat/candidate-applications` (stacked on 3) | `feat/candidate-applications-ui` (frontend steps 41–44) | P2b: CV library and applying with CV and screening answers into `Nuevos` | Optional backend setting `CV_STORAGE_ROOT` (private directory; value never committed); without it the API starts and CV routes return `503 cv_storage_unavailable`; apply migrations 00021 and 00022; [CV API](candidate-cvs.md), [apply API](vacancy-applications.md); upload/rename/download/delete, apply/replay, verify candidate-only history and used-CV retention | Backend verified (L44–L47: isolated-DB integration with -race, independent verification and re-verification); approved by the user (L70), merged into local main |
| 5 | `feat/pipeline-movement` (stacked on 4) | `feat/pipeline-movement-ui` | Cut 4: real board, single-candidate moves, typed history, screening snapshots, recruiter CV download, coverage milestones, pipeline structure lock, candidate status | Backend `make db-migrate` applies 00023; [movement API and test map](pipeline-movement.md); move forward one/backward any, confirm Placement exit, check coverage and retained history, test stale tabs, rename locked columns, candidate status, retained CV download | Backend verified (L50–L52: isolated-DB integration with -race and independent verification); approved by the user (L70), merged into local main |
| 6 | `feat/pipeline-discard` (stacked on 5) | `feat/pipeline-discard-ui` | Cut 5: discard with grouped reason, private comment, optional candidate message, recovery, Placement confirmations and retained coverage milestones | Backend `make db-migrate` applies 00024; [discard API and test map](pipeline-discard.md); discard/recover from each column, confirm Placement departure/reentry, check closed/message then restored status and hidden message, retained private history, stale tabs and authorization | Backend verified (L55, L56); approved by the user (L70), merged into local main |
| 7 | `feat/public-listing-enrichment` (stacked on 6) | `feat/ui-polish` (frontend queue item 7) | Public cards: safe company logo, normalized excerpt, benefits/skills previews and totals, applicant ranges (all received, including discarded), screening question count; full detail skills | Backend `make db-migrate` applies 00025 (existing-projection backfill); [public API and test map](public-jobs-v2.md); browse both sources, check long/empty descriptions and logos, full detail benefits/skills, applicant thresholds and published questionnaire edits | Backend verified (L59, L60); approved by the user (L70), merged into local main |
| 8 | `feat/pipeline-substates-active` (stacked on 7) | `feat/pipeline-substates-active-ui` | Cut 6: active substate in En proceso, clearing on leave, retained name-snapshot history, catalog occupancy/removal guard, client-side filter contract | Backend `make db-migrate` applies 00026; [active-substate API and test map](pipeline-substates-active.md); set/clear/no-op, leave forward/backward/discard and re-enter null, rename occupied labels, block used removal with details, stale tabs, OR labels/Sin subestado and AND with other filters, candidate privacy | Backend verified (L64, L65); approved by the user (L70), merged into local main |
| 9 | `feat/pipeline-delivery-fulfillment` (stacked on 8) | `feat/pipeline-delivery-fulfillment-ui` | Delivery fulfillment: historical reached counts, exactly-once frozen snapshot, business-day result, status/preview/confirmation, read-only fulfilled configuration and board/write summaries | Backend `make db-migrate` applies 00027; [contract and test map](delivery-fulfillment.md); reach cutoff including Nuevos intake, discard/recover without losing attainment, preview lower target/different cutoff then confirm, check result/candidate order, freeze and stale tabs | Backend verified (L68, L69); approved by the user (L70), merged into local main |
| 10 | `feat/pipeline-column-editing` (stacked on main via `feat/pipeline-board-filters`) | `feat/pipeline-column-editing-ui` | Cut 7: structural edits with candidates, preview and applied-impact confirmation, retained stages, not-applicable history, explicit retired-stage recovery | Backend `make db-migrate` applies 00028; [contract/rules/test map](pipeline-column-editing.md); add/reorder around candidates, confirm actual impact, block occupied/cutoff removal, retire a discarded candidate's previous column, choose default/earlier recovery, check unchanged delivery and new-order moves | Backend verified (L77, L78); awaiting browser test |
| 11 | `feat/pipeline-filter-data` (stacked on 10) | `feat/pipeline-filter-data-ui` | §19: single-choice snapshot answers and current questionnaire filter catalog; immutable application-time city/skills/experience/education profile snapshot | Backend `make db-migrate` applies 00029; [contract/privacy/test map](board-filter-data.md); apply with/without a profile, edit profile and replay without changing old snapshot, edit questionnaire without changing old answers, test multi-select filters and legacy Sin dato, verify candidate/public privacy | Backend verified (L79, L80); awaiting browser test |
| 12 | `feat/geo-catalog` | `feat/geo-location-field-ui` (browser check together with row 13) | G1: worldwide countries, MX state/municipality catalog, one-postal-code lookup, importer and additive migration 00030 | Apply 00030 and `make geo-import`; [geo API/data/test map](geo-catalog.md); test country/state/municipality choices, leading-zero postal lookup, editable preload, unknown codes, caching/304, and absence of bulk postal listing | Backend implementation; isolated-DB integration passed (L5), verified (L7); paired browser review pending |
| 13 | `feat/geo-vacancy` (stacked on `feat/geo-catalog`) | `feat/geo-vacancy-ui` (stacked on `feat/geo-location-field-ui`; browser check together with row 12) | G2: structured vacancy location + optional MX postal code, explicit remote scope, mode-dependent readiness, public projection/read shapes; migration 00031 | Apply 00031 after G1 catalog import; [contract and checklist](geo-vacancy.md); select/save/clear MX geography, editable postal preload, remote anywhere/countries/order, toggle onsite/hybrid, publish/edit, public labels and legacy substring filter, migrated draft stale ETag | Backend implementation; parent-owned isolated-DB integration and browser review pending |
| 14 | `feat/geo-profiles` (stacked on `feat/geo-vacancy`) | `feat/geo-profiles-ui` (stacked on `feat/geo-vacancy-ui`) | G3: candidate full-replacement location without postal; optional company location with MX postal, tri-state owner PATCH and expanded public/editor reads; migration 00032 | Apply 00032 after imported G1/G2; [contract and test checklist](geo-profiles.md); save/reload/clear candidate and company geography, reject inconsistent parents/postal, verify whole-object replacement and stale-tab editor data; new §19 snapshots temporarily keep city null until G4 | Backend implementation; parent-owned isolated-DB integration and browser review pending |

Per branch, before merging after approval: merge into `main` locally (no PR), keep the
frontend tree from the frontend merge and the backend tree from the backend branch,
and the user pushes.

Housekeeping awaiting the user: the git stash `p1-rest` (backup from splitting the P1
commits, fully committed since) can be dropped once P1 is approved.

Open decisions awaiting the user:

- Reversal of a mistaken candidate onboarding (support/admin tool or none) — design §11.3.
- AWS console checks for candidate sign-up — design §11.4 (self sign-up with email
  verification, sign-out URL `http://localhost:3000/candidato/login`).
- Cut-5 follow-ups (L56): test coverage added — existing hire/departure rows in
  `TestMigration00024ExistingMovementCatalogAndGuardedDown`; Placement race in
  `TestDiscardMoveRecoveryPlacementForcedOneWinner`. Planner-flake hardening (L52):
  `TestMigration00014UpCreatesDraftListIndexUsedByTheListOrder` now disables sequential
  and bitmap scans transaction-locally, retaining the index/no-sort assertions.
- Cut-6 follow-ups (L65): test coverage added — catalog removal vs move/discard in
  `TestSubstateRemovalRacingMoveDiscardBothOrderings`; pre-existing discarded row and exact
  restored CHECK equality in `TestMigration00026ExistingRowsShapesAndGuardedDown`;
  authorization in `TestSubstateOwnerPrincipalNonprincipalDBMatrix`.
- Delivery-fulfillment follow-ups (L69): test coverage added —
  `TestFulfillmentRecoverySoleFirstAttainment`,
  `TestFulfillmentSubstateOnlyHistoryNeverCountsAsReached`,
  `TestFulfillmentMissingConfigRollsBackTrigger`,
  `TestFulfillmentCrossingMixedApplyMoveEditExactlyOnce`, and
  `TestFulfillmentStatusPreviewLiveGateDBMatrix`.
- Cut-7 follow-ups (L78): test coverage added — every prior history row and non-null
  active substate in `TestColumnsSuccessfulEditsPreserveEveryHistoryRowAndActiveSubstate`;
  recovery ordering in `TestColumnRecoveryReassignedSeveralRetiredStagesOrderedByPositionThenID`;
  exact UUIDs in `TestColumnIDsExactLaterAndInterleavedIdlessOrdinals`;
  preview gates in `TestColumnsPreviewInheritedLiveGateDBMatrix`;
  ordinary recovery audit in `TestColumnsOrdinaryRecoveryAuditsOverrideFalse`;
  fulfilled cutoff removal in `TestColumnsCutoffRemovalRejectedAfterFulfillment`.
- §19 follow-up (L80): test coverage added —
  `TestFilterDataPopulatedSnapshotsNeverReachRequestLogsOrAuditMetadata` captures real
  request-completion logs and audit metadata with populated profile/answer snapshots.
  All DB-backed follow-up coverage above still awaits the parent's isolated-database run;
  compilation/skips are not evidence of passing database behavior.
- Note for the morning review: the profile filters read the candidate's own profile at apply
  time; candidates who never completed their profile show «Sin dato».
