# G4 — apply country gate and frozen profile geography

Branch `feat/geo-apply`, stacked on `feat/geo-profiles`. Apply migration **00033**
after G1–G3 and catalog import. Design authority: geography §20.6/§20.8/§20.9,
pipeline §19 (including read-only §19.2b).

## Apply gate

The request and success/replay bodies are unchanged; no client country override.
Inside the apply transaction, after vacancy lookup and idempotency replay/conflict,
read the candidate's **current** profile. Only the **published public projection's**
`work_mode=remote` + `remote_scope_kind=countries` enables the gate. Mutable draft
fields never substitute for the scope the candidate saw.

The scope is read in a **fresh statement after the draft lock is held**, and after
replay. SaveV2/publication lock the draft before writing the projection; holding
that lock excludes further projection saves. Reading scope in the lock-acquiring
join is unsafe under READ COMMITTED: after waiting, EvalPlanQual can refresh the
locked draft while retaining the unlocked projection's old values. No additional
projection lock or change to the writer's lock order is introduced.

Before questionnaire revision, screening answers, CV availability and duplicate
checks:

| Current country | Status/code |
| --- | --- |
| Missing profile or null country | 422 `applicant_country_required` |
| Not in published countries | 422 `applicant_country_not_allowed` |
| In published countries | Continue existing checks |

Both errors have exactly `{error,code,data}`; `data` is exactly
`{"allowed":["CO","MX"]}` with ISO codes in **scope order**, not names or sorted.
Ask the candidate to complete/update their profile country, then retry. No profile
country is required for anywhere, onsite or hybrid vacancies. Earlier successful
idempotency replays remain the original 201 even after profile/scope changes;
conflicting payloads remain 409. Existing vacancy/auth gates still precede replay.

The profile read supplies the immutable snapshot too: country/state/municipality
codes or null, plus the existing skills/years/education allowlist. Rejected applies
create no participation, snapshot, intake, idempotency or audit, and leave delivery
and coverage counters, fulfillment snapshots and coverage milestones unchanged. No country/profile
data enters candidate/public responses or audit metadata. Board/detail expose
expanded frozen locations only; mutations never do. See
[board filters and frontend migration](board-filter-data.md) and
[apply API](vacancy-applications.md).

## Browser checklist

1. Remote countries CO/MX: no profile country → required; US → not allowed;
   confirm allowed list order. Complete country MX and apply successfully.
2. Change country to US, replay the original key/body → same success. A new key
   gets the country error before duplicate, screening or CV errors.
3. Anywhere/onsite/hybrid: apply without country (existing screening/CV rules remain).
4. Apply with MX/Jalisco/Guadalajara; change profile to another country. Board and
   detail retain Guadalajara/Jalisco, expanded references and null postal code.
5. Old snapshots show «Sin dato» location after 00033. Use state/municipality
   multi-selects, OR within/AND across. Mutations retain immutable board filter data
   client-side; no new fields appear in their responses.

## Test map / evidence boundary

- Unit: `TestApplicantCountryGate`, `TestApplicantCountryCatalog`, `TestApplyTransport`:
  all modes/outcomes, ordered data, additive shared codes, exact error wire.
- DB: `TestGeoApplyPublishedCountryGateAndNoWrites`: all outcomes, published-vs-draft
  source, gate precedence over revision/answers/CV and zero effects on rejection.
- DB: `TestGeoApplyReplayBeforeCurrentCountryGateAndDuplicate`: replay before changed
  country/scope, conflict before gate, gate before duplicate, snapshot/effects unchanged.
- DB: `TestGeoApplyCountryScopeAfterWaitingForDraftSave`: forced draft-lock wait,
  tightening anywhere/MX → CO and relaxing CO → anywhere/MX, committed-scope
  decisions and allowed lists, no effects on rejection. Parent observed all four
  failing against the old implementation; post-fix DB GREEN remains parent-owned.
- DB: `TestGeoApplyCountryRejectionPreservesPopulatedDeliveryAndCoverage`: rejected
  applies preserve computed counters and full existing fulfillment/milestone rows
  (including a nonzero fulfilled/covered fixture). Existing G4 no-write/replay tests
  also compare these expanded effects.
- DB: `TestGeoSnapshotCurrentCodesAndExpandedBoardDetailWire`: immutable code snapshot,
  exact expanded wire, labels, null postal, board/detail parity and replay.
- Migration tests cover 00033 up/down, SQL NULL and strict shape rejection.

Run focused tests, sqlc generation, full unit/closure/architecture/drift suite and
both vet modes. Parent owns DB execution with `-tags=integration` against an existing
isolated loopback `draft_test`; no DB created here. Compile-only evidence is not
SQL/transaction execution evidence. Risk: 00033 deliberately discards old city
values; down deliberately discards structured location, as authorized by S8.
