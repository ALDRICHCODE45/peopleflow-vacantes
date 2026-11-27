# Notifications stage 2 backend — email channel and personal preferences

Branch `feat/notifications-v2-backend` (worktree `peopleflow-vacantes-notif`, from main 0bfb8c09). Builds on stage 1
(`docs/contracts/notifications-v1.md`, merged e6b2d501). Contract first (`docs/contracts/notifications-v2.md`), then slices.

## Specs

- **S1** Scope (user, frontend L17): «email + preferencias personales. El resumen (digest) queda para la etapa 3.»
- **S2** Defaults (user, L17): «Correo de eventos operativos (postulaciones, pruebas completadas): apagado por defecto hasta
  que la persona lo active. Los obligatorios (entregas vencidas, asignación, reasignación y desasignación) llegan siempre por
  correo.»
- **S3** Candidates (user, L17): «Candidatos: solo los que tienen cuenta, respetando sus preferencias.»
- **S4** Bursts (user, L18): «un mail por grupo con ventana de coalescencia de 10 min.»
- **S5** In-app off (user, L18): «Las operativas también se pueden apagar en la app; las obligatorias nunca.»
- **S6** Content (user, L18): «El mail lleva lo mínimo y un link, sin nombres de candidatos.»
- **S7** Frontend decisions (L18): «Preferencias por empresa (company_id en la clave, NULL para el candidato).» «Plantillas de
  mail en el backend; el copy en español te lo paso yo.» «Mailpit en el compose de dev, detrás de un puerto Mailer con
  adapter de log/Mailpit. SES queda para cuando se libere AWS; no toques nada de AWS.» «Baja con un clic (RFC 8058) con
  token HMAC y exp largo.» «Los obligatorios no llevan baja por tipo, solo el link a «Mis preferencias».» «Tabla de
  supresión diseñada ya; la ingesta de bounces llega con SES.»
- **S8** Contract request (frontend): «Proponé el contrato notifications-v2.md, con el mismo estilo que v1. Que incluya:
  GET y PUT de preferencias para miembro (/v2/me/company/notifications/preferences) y candidato
  (/v2/me/notifications/preferences), con el catálogo de tipos × canales, defaults y bloqueos (mandatory_locked) incluidos en
  la respuesta, para que el frontend no los duplique. El endpoint público de baja. El efecto del in-app apagado: no se crea la
  fila, o se crea oculta. Elegí y justificá. La lista de plantillas que necesitan copy.»
- **S9** Constraint (user, 2026-11-22): «nadie TOQUE NADA DE AWS TODAVIA».
- **S10** Copy, labels, fallbacks and path map: see L5 (verbatim).

## Tasks

- T1 — S1–S10 — contract `docs/contracts/notifications-v2.md` — worker (docs) — agreed
- T2 — E1 — migration 00069, domain defaults/effective preference/locked rule, `AND n.in_app` in the scoped inbox statements + guard test — worker — done (uncommitted, L7)
- T3 — E2 — preferences store + GET/PUT handlers for both trees, `notification_preference_locked`, routes — worker — done (uncommitted, L9)
- T4 — E3 — in-app off at creation in fan-out and scheduler, `InsertNotification` → `:execrows` — worker — done (uncommitted, L11)
- T5 — E4 — config loader, email eligibility, delivery creation with coalescing upsert in both creation paths — worker — done (uncommitted, L12)
- T6 — E5 — `Mailer` port, `log`/`smtp` adapters, Mailpit in compose, templates with the S10 copy, headers, dates, path map — worker — done (uncommitted, L14)
- T7 — E6 — sender loop (claim/lease, re-check/skip, fenced finalize, backoff, throttle), start/stop in `main.go` — worker — pending
- T8 — E7 — unsubscribe token, public GET/POST, per-IP limit, `unsubscribe_link_invalid` — worker — done (uncommitted, L16)
- T9 — E8 — purge of terminal deliveries, follow-up note in `docs/decision-email-provider.md` — worker — pending

## Log

- **L1** 2026-11-26, frontend request (verbatim, seq 8): «Decisiones para la etapa 2 (L18 en el feature del frontend):
  Usuario: Ráfagas: un mail por grupo con ventana de coalescencia de 10 min. Las operativas también se pueden apagar en la
  app; las obligatorias nunca. El mail lleva lo mínimo y un link, sin nombres de candidatos. Mías: Preferencias por empresa
  (company_id en la clave, NULL para el candidato). Plantillas de mail en el backend; el copy en español te lo paso yo.
  Mailpit en el compose de dev, detrás de un puerto Mailer con adapter de log/Mailpit. SES queda para cuando se libere AWS;
  no toques nada de AWS. Baja con un clic (RFC 8058) con token HMAC y exp largo. Los obligatorios no llevan baja por tipo,
  solo el link a «Mis preferencias». Tabla de supresión diseñada ya; la ingesta de bounces llega con SES. Proponé el
  contrato notifications-v2.md, con el mismo estilo que v1. […] Avisame cuando esté en Draft para revisarlo.»
- **L2** 2026-11-26, backend intake sent before L1: no email code/config/templates exist; SES decided but not implemented
  (docs/decision-email-provider.md); archguard forbids `outbox`/`worker` paths (internal/tools/archguard/archguard.go:250-282)
  so delivery is DB-backed and in-process like the stage-1 fan-out; no HMAC helper exists; domain status contradictory
  (decision doc «Pendiente» vs ROADMAP.md:251 «ya comprado»).
- **L3** 2026-11-26, T1 drafted (uncommitted): `docs/contracts/notifications-v2.md`, Status Draft — pending frontend
  review, D1–D23. Preferences: sparse explicit override rows `notification_preferences(user_id, company_id NULL for
  candidates, type, channel ∈ in_app|email, enabled, source)`, `UNIQUE NULLS NOT DISTINCT`, mandatory types refused by
  a DB CHECK and by the API (`422 notification_preference_locked`, new); defaults from kind in code (mandatory on+locked;
  operational in_app on / email off; informative same as operational); GET returns the caller's full catalog with
  `default`/`enabled`/`mandatory_locked` + `email_deliverable`; PUT partial, atomic, idempotent, upserts every entry,
  returns the catalog; not audited (personal, not company data; `source`+`updated_at` kept). In-app off: **row created
  hidden** (`notifications.in_app = false`, creation-time snapshot, never resurfaced) — keeps v1 D21 dedupe as the only
  exactly-once record (scheduler re-runs every 15 min), gives email a real anchor for groups/links/resolution, counters
  stay index-only (unread index rebuilt with `AND in_app`); cost = predicate in ten scoped inbox statements + guard
  test. Email: `notification_email_deliveries` created in the fan-out/scheduler tx only for inserted rows
  (`InsertNotification` → `:execrows`) when mailer ≠ off, email pref on, user live with email, address not in
  `email_suppressions`; coalescing per (recipient, group_key) for the 3 grouped types with a fixed 10-min window (opens
  at the first eligible row with no `pending` delivery, closes when the sender claims it; partial unique index on
  `pending`), singles/mandatory immediate; sender loop in every instance (5 s, 20/tick, claim+lease in short tx, send
  outside tx, fenced finalize, retry 1 min·2^(n−1) cap 1 h ×8, permanent → failed, per-instance throttle default 1/s,
  at-least-once on crash); skip at send when gone/no address/suppressed/pref off/all resolved/(non-mandatory) all read;
  Mailer port `off|log|smtp` (`ses` reserved), Mailpit in backend/docker-compose.yml; address never copied. Content
  minimal (no candidate/actor names, no free text), MX dates, deep link via frontend path map; RFC 8058 headers only on
  non-mandatory, mandatory footer links only «Mis preferencias». Unsubscribe: stateless HMAC-SHA256 token
  `<kid>.<payload>.<mac>` {v,u,c,t,x}, 365 d, key list with rotation, hmac.Equal, uniform `422
  unsubscribe_link_invalid` (new); public GET (no mutation) + POST (one-click/landing) on `/v2/notifications/unsubscribe`,
  per-IP limit; effect = upsert email off, never mandatory. 17 type templates + 2 footers need copy. Slices E1–E8.
  Deviation from decision-email-provider.md (queue/Fargate) flagged. Open questions Q1–Q11: Q1 candidate email defaults
  (S2 literal = off; recommend on), Q2 vacancy title in emails (recommend include), Q3 frontend path map, Q4 public
  origin for the one-click POST (recommend frontend origin pass-through), Q5 per-instance throttle, Q6 skip if already
  read (recommend yes), Q7 hide preferences page for stakeholders, Q8 midnight split, Q9 365-day links, Q10 update
  decision doc, Q11 sender domain.
- **L4** 2026-11-26, user answers: Q1 «Encendido por defecto (Recomendado)» (candidate email on by default); Q2 «Sí, con el
  título (Recomendado)»; Q6 «Sí, se cancela (Recomendado)»; Q7 «Ocultarla hasta la etapa 3 (Recomendado)». Parent accepts
  Q5/Q8/Q9/Q10 as recommended; Q3/Q4 go to the frontend; Q11 (sender domain) deferred to the SES work (S9). Contract
  updated; next: frontend review.
- **L5** 2026-11-26, frontend review of the contract, approved by the user (verbatim; spec source for the copy, S10):
  «Correcciones:
  1. En la tabla de defaults de §Preferences los 3 tipos del candidato dicen «off (Q1)», pero D2 y Q1 resuelta dicen on. Que diga «on (Q1)».
  2. En «Open questions» siguen Q1, Q2 y Q6–Q10, que ya están resueltas. Que queden solo Q3, Q4 y Q11 (y Q3 y Q4 se cierran con esto).
  3. T13 vacancy_unassigned puede venir con link null. En ese caso app_url = APP_BASE_URL + /empresa.
  4. La landing y el one-click van en paths distintos, porque en Next una page y un route handler no pueden compartir path.

  Q3, mapa de paths:
  - vacancy y vacancy_candidates → /empresa/vacantes/{job_id}/pipeline
  - participation → /empresa/vacantes/{job_id}/pipeline?candidato={participation_id}
  - vacancy_delivery → /empresa/vacantes/{job_id}/configuracion/entrega
  - application → /candidato/postulaciones?postulacion={participation_id}
  - assessment → /candidato/evaluaciones/{invitation_id}
  - preferencias del miembro → /empresa/configuracion/notificaciones
  - preferencias del candidato → /candidato/configuracion/notificaciones
  - unsubscribe_url → /notificaciones/baja?token={token}
  - NOTIFICATIONS_UNSUBSCRIBE_URL → APP_BASE_URL + /api/notificaciones/baja (vos le sumás ?token=)

  Q4: origen del frontend. /api/notificaciones/baja acepta solo POST y reenvía token y body a POST /v2/notifications/unsubscribe, sin cookies, sin sesión y sin chequeo de mismo origen. La landing usa tu GET y confirma con una server action.

  Copy (asunto | encabezado | línea | botón):
  T1 Nueva postulación en {{job_title}} | Nueva postulación en {{job_title}} | Recibiste una postulación nueva el {{date_local}}. | Ver candidatos
  T2 {{count}} postulaciones nuevas en {{job_title}} | igual | Llegaron {{count}} postulaciones nuevas el {{date_local}}. | Ver candidatos
  T3 Prueba psicométrica completada en {{job_title}} | Prueba psicométrica completada | Un candidato de {{job_title}} terminó su prueba psicométrica. | Ver resultado
  T4 {{count}} pruebas psicométricas completadas en {{job_title}} | {{count}} pruebas psicométricas completadas | {{count}} candidatos de {{job_title}} terminaron su prueba psicométrica. | Ver candidatos
  T5 Prueba psicométrica pendiente en {{job_title}} | Prueba psicométrica pendiente | Se envió una prueba psicométrica a un candidato de {{job_title}} y aún no la responde. | Ver candidato
  T6 {{count}} pruebas psicométricas pendientes en {{job_title}} | {{count}} pruebas psicométricas pendientes | Se enviaron {{count}} pruebas psicométricas a candidatos de {{job_title}} y aún no las responden. | Ver candidatos
  T7 La entrega de {{job_title}} vence pronto | La entrega vence pronto | La fecha compromiso de {{job_title}} es el {{commitment_date_local}}. | Ver entrega
  T8 La entrega de {{job_title}} está vencida | La entrega está vencida | La fecha compromiso de {{job_title}} era el {{commitment_date_local}}. | Ver entrega
  T9 Tu fecha límite en {{job_title}} se acerca | Tu fecha límite se acerca | Como {{function}} de {{job_title}}, tu entrega vence el {{commitment_date_local}}. | Ver entrega
  T10 Venció tu fecha límite en {{job_title}} | Venció tu fecha límite | Tu entrega como {{function}} de {{job_title}} era el {{commitment_date_local}}. | Ver entrega
  T11 Te asignaron {{job_title}} | Te asignaron una vacante | Ahora eres responsable de {{job_title}} en {{company_name}}. | Abrir vacante
  T12 Ahora eres responsable de {{job_title}} | Te reasignaron una vacante | Ahora eres responsable de {{job_title}}. Motivo: {{reason}}. | Abrir vacante
  T13 Ya no eres responsable de {{job_title}} | Se reasignó una vacante | {{job_title}} ahora está a cargo de otra persona. Motivo: {{reason}}. | Ir a PeopleFlow
  T14 Te agregaron al equipo de {{job_title}} | Te agregaron a un equipo | Formas parte del equipo de {{job_title}} como {{function}}. | Abrir vacante
  T15 Tu postulación a {{job_title}} cambió de estado | Tu postulación ahora está «{{status}}» | {{company_name}} actualizó tu proceso para {{job_title}}. | Ver postulación
  T16 {{company_name}} te dejó un mensaje | Tienes un mensaje sobre tu postulación | {{company_name}} te escribió sobre {{job_title}}. Por privacidad no lo incluimos aquí; léelo en PeopleFlow. | Leer mensaje
  T17 Tienes una prueba psicométrica pendiente | Tienes una prueba pendiente | {{company_name}} te envió una prueba psicométrica para {{job_title}}. | Empezar prueba
  F1: «Recibes este correo porque este aviso está activado en tus preferencias.», con los links «Mis preferencias» · «Dejar de recibir este tipo de correo».
  F2: «Este aviso es obligatorio y no se puede desactivar.», con el link «Mis preferencias».
  Etiquetas:
  - function: responsable / colaborador / integrante
  - reason: carga de trabajo / salida del reclutador / desempeño / solicitud del cliente / otro motivo
  - status: Enviada / En proceso / Cerrada
  Fallbacks: job_title null → «una vacante»; company_name null → «una empresa».»
  Applied to the contract: corrections 1–4, Resolved questions Q1–Q11 (Q3 path map, Q4 frontend-origin pass-through,
  Q11 deferred to SES), §Templates with the verbatim copy; Status Agreed.
- **L6** 2026-11-26, contract Agreed (parent commit). Technical gaps owned by the backend, decided by the parent: candidate
  items with a null link (no participation / invalid invitation) use app_url = APP_BASE_URL + /candidato/postulaciones
  (apply in E5); the per-IP unsubscribe limit behind the frontend pass-through is designed in E7 (trusted forwarded client
  IP, as the existing TRUSTED_PROXY_CIDRS / requestmeta pattern). T13 lowercase start with the fallback kept verbatim.
- **L7** 2026-11-26, T2/E1 implemented (uncommitted, worktree only). `db/migrations/00069_notifications_email.sql`
  exactly as §Data model (3 tables, `notifications.in_app` default true + `email_delivery_id` ON DELETE SET NULL, unread
  index rebuilt with `AND in_app`; Down restores the stage-1 index, drops the columns, then the tables). Domain
  `notifications/domain/preferences.go`: `Channel` (`in_app`, `email`), kind default table, `DefaultPreference` (candidate
  types email on, Q1), `Locked` (mandatory), `EffectivePreference(type, channel, override *bool)` (locked → always on,
  else row, else default), `OverridableTypes` (mirrors the CHECK). `AND <alias>.in_app` added to the ten scope filters
  in nine statements of `db/queries/notifications.sql` (attention, groups + lateral latest, member samples, unread count,
  read, unread, read-all, both facets); sqlc regenerated (`internal/db`). Guard `inbox/inapp_guard_test.go`: every
  statement with `<alias>.recipient_kind =` must carry `AND <alias>.in_app` (`= true` accepted, `= false`/`IS …`/commented
  out/wrong alias/unqualified rejected; empty exemption list reserved for the E6 sender). RED observed: domain build
  failure (undefined `Channel`, `DefaultPreference`, …); guard listed exactly 10 missing predicates; capture migration
  test build failure (`domain.Channels`/`OverridableTypes`); `TestNotificationsHidden_*` failed with `column "in_app"
  does not exist`. GREEN: `make test-integration PKG=./internal/features/notifications/...` ok (5 packages, 67
  top-level tests incl. `TestMigration00069NotificationsEmail` and the 00068 Down/Up), `make test-integration
  PKG=./cmd/api/ RUN='^TestNotifications'` ok (15 tests incl. 2 new `TestNotificationsHidden_*`, member + candidate:
  hidden rows absent from list/latest/sample/attention/counts/facets, untouched by read/unread/read-all/undo),
  `make test PKG='./internal/features/notifications/... ./cmd/api/ ./internal/tools/archguard/'` ok, `go tool sqlc diff`
  clean. Mutation check: dropping `AND x.in_app` (lateral latest) fails both the guard and the member hidden test
  (latest = the hidden row); restored. Test DB: disposable container `peopleflow-notif-test2` (tmpfs, loopback), DSN in
  `/tmp/pf-notif-test2-dsn` (0600), left running for later slices.
- **L8** 2026-11-26, frontend correction (verbatim): «Cambio el body de T13 por: «Otra persona quedó a cargo de {{job_title}}. Motivo: {{reason}}.». Así el fallback «una vacante» nunca abre la oración.» Applied to the contract in b0a2efaa; supersedes the T13 line of L5.
- **L9** 2026-11-26, T3/E2 implemented (uncommitted, worktree only; catalog code `notification_preference_locked` added by
  the parent in 7ff33ef4, `internal/shared/httpjson/notification_errors.go`). Package
  `internal/features/notifications/preferences`: `Build` renders the caller tree's catalog from the domain table only
  (`TreeTypes(kind)` × `domain.Channels()`, `DefaultPreference`/`EffectivePreference`, overrides on locked or foreign
  pairs ignored); `ParsePut` (strict JSON, objects only; 1–28 entries; `preferences` required/empty/too_many,
  `preferences[i].type|channel|enabled` required/invalid — a type of the other tree is invalid —, `preferences[i]`
  duplicate; all failures of the list together, in entry order; only a fully valid list is checked for locked types →
  `LockedError{types}` once each in table order); `Store` (GET in one read-only RR snapshot; PUT = one upsert per entry
  `source='settings', updated_at=now()` + catalog read-back in one tx); `Handler` GET/PUT with a 16 KiB body cap. Scope
  resolvers moved out of the inbox handler as exported `inbox.MemberScope` / `inbox.CandidateScope(lookup)` and shared
  by both features (same gates, same errors). Queries `ListNotificationPreferences`, `GetNotificationEmailDeliverable`
  (live ∧ non-empty ∧ `lower(btrim(email))` not suppressed; address/reason never leave SQL), `UpsertNotificationPreference`
  (sqlc cannot type a multi-array `unnest`, so one statement per entry inside the tx). Routes `Get`/`Put` on
  `/v2/me/company/notifications/preferences` (member group) and `/v2/me/notifications/preferences` (candidate group),
  the 4 added to `TestRouteTopology_ExactRegistrations`. Review advisories on 00069 (in place, unreleased):
  `notification_email_deliveries.recipient_user_id` / `company_id` `ON DELETE CASCADE`; `type` CHECK = the 14 values of
  `notifications.type`; `CHECK ((status = 'retry') = (next_attempt_at IS NOT NULL))` and `CHECK ((status = 'sending') =
  (lease_until IS NOT NULL))` — the §Sender model allows it, E6 must clear `next_attempt_at` in the claim and
  `lease_until` in every finalize. Guard `inbox/inapp_guard_test.go`: block comments stripped; each `<alias>.recipient_kind
  =` occurrence needs `AND <alias>.in_app` in its own query scope (innermost parentheses, literals ignored). RED observed:
  the 5 HTTP tests got `404 page not found`; preferences unit tests failed to build (undefined `ParsePut`, `Build`, …);
  migration test `want SQLSTATE 23514, got <nil>` (unknown delivery type) and, with only the user FK reverted, `DELETE FROM
  users … violates foreign key constraint notification_email_deliveries_recipient_user_id_fkey`; guard: 5 new cases failed
  (block comment ×2, same alias in a second scope, predicate only nested, predicate only outer). Mutation: reusing alias
  `n` in the lateral `latest` of `ListNotificationGroups` without its own `in_app` (passes the old guard) fails the new
  one; restored byte-identical. GREEN: `make test-integration PKG=./internal/features/notifications/...` ok (6 packages,
  74 top-level tests), `make test-integration PKG=./cmd/api/ RUN='^TestNotifications'` ok (20 tests, 5 new
  `TestNotificationsPreferences_*`: member catalog/partial/idempotent/explicit default-valued rows/unsubscribe row
  rewritten as settings; candidate catalog email on + `email_deliverable` false while the normalized address is
  suppressed, both trees; 422 locked with nothing written incl. the whole 22-pair tree; 25 validation cases with nothing
  written; isolation colleague/owner/outsider/other candidate, stakeholder member catalog + PUT (D23), company-keyed
  rows across a membership move, member vs candidate, gates 401/403 forbidden/wrong_role/account_required/
  company_inactive; 0 audit rows), `make test PKG='./internal/features/notifications/... ./cmd/api/
  ./internal/tools/archguard/'` ok, `go tool sqlc diff` clean. Not reachable through HTTP: an empty stored address (the
  gates refuse a user whose email is not a valid address), so that branch of `GetNotificationEmailDeliverable` is
  defensive only; no test forces a DB failure mid-PUT (atomicity rests on the single tx; validation and 422 never touch
  the DB).
- **L10** 2026-11-26, E1+E2 independently verified (all 5 items pass; integration 74/0/0, TestNotifications* 20/20, unit 118 ok,
  sqlc clean). Native review of E1 `review-4520d90ae9417a62` approved; its advisories fixed in E2 (5b1ccdd1). Contract
  §Data model synced (delivery FKs cascade, type CHECK, retry/sending timer CHECKs) and the 28-entry limit wording fixed.
  Follow-ups: guard only fires on `<alias>.recipient_kind =`; preferences PUT has its own strict decoder (duplicate keys
  inside an entry: last wins); down test checks the index loosely. Next: E3.
- **L11** 2026-11-26, T4/E3 implemented (uncommitted, worktree only). `InsertNotification` → `:execrows` and both inserts
  take `in_app` (`sqlc.arg('in_app')::boolean`); new `ListNotificationPreferenceOverrides :many` (one channel, `user_id =
  ANY`, `type = ANY`, `company_id IS NULL OR = ANY`; over-fetches at most the cross product, exact match in Go); sqlc
  regenerated. Domain `domain/overrides.go`: `PreferenceKey{User, Company (uuid.Nil = candidate, company_id NULL), Type}`,
  `Overrides.Effective` = `EffectivePreference` of the exact key (mandatory always on, even facing a row),
  `NewOverrideLookup` (distinct users / non-NULL companies / overridable types; `Empty()` ⇒ no read when every type is
  mandatory). Fan-out: one override read per event in the claiming tx after `Plan`, before the inserts (new step
  `preferences`); `insert` returns `inserted bool` (affected rows = 1) and the loop marks the E4 hook (delivery decision
  only for inserted rows). Scheduler: the date rule now collects every item first, one override read per run in the run
  tx (step `preferences`), then inserts in the same order; `insert` returns the affected rows with the hook comment;
  `Result` counts unchanged. RED observed: domain build failure (undefined `NewOverrides`, `PreferenceKey`, …),
  fanout/schedule build failures (`insert` arity); then, with the new signatures but `in_app` hard-wired true,
  `TestFanOutWritesInAppFromThePreferenceAtCreation` (application: owner row visible) and
  `TestScheduleInAppOffCreatesAHiddenDeduplicatedRow` (first run due soon: owner row visible) failed, the affected-rows
  and mandatory tests passed. GREEN: 6 new integration tests + 2 unit tests — fan-out: owner off in this company →
  hidden, recruiter off only in another company → visible, explicit on → visible, candidate off with company NULL →
  hidden; re-processing with the channel back on keeps the old rows hidden, a new event after re-enabling is visible;
  mandatory `vacancy_reassigned`/`vacancy_unassigned` with override rows (type CHECK dropped in the disposable DB) →
  visible; `insert` true then false on conflict, in_app written. Scheduler: owner off on `delivery_due_soon` → hidden,
  recruiter off on `assignment_deadline_due_soon` → hidden, recruiter's other-company row ignored, overdue visible;
  second run `Result{}` with no re-created row; re-enabling + third run `Result{}` and rows still hidden; mandatory
  `delivery_overdue` with a row → visible; scheduled `insert` 1 then 0. Mutation: `Overrides.Effective` returning the raw
  row fails the unit test (2 mandatory cases); the integration mandatory tests still pass because the lookup never
  fetches locked types (second guard); restored. Validation: `make test-integration
  PKG=./internal/features/notifications/...` ok (6 packages, 82 top-level PASS, 0 FAIL, 0 SKIP), `make test-integration
  PKG=./cmd/api/ RUN='^TestNotifications'` ok (20 PASS), `make test PKG='./internal/features/notifications/... ./cmd/api/
  ./internal/tools/archguard/'` ok, `go tool sqlc diff` clean. The override read helper is duplicated (~25 lines) in
  `fanout/process.go` and `schedule/run.go` (each package owns its tx; domain stays DB-free).
- **L12** 2026-11-26, T5/E4 implemented (uncommitted, worktree only). Config `internal/runtime/config/notifications_email.go`:
  `NotificationsEmailConfig{Mailer}` (to be extended by E5–E7), `NOTIFICATIONS_MAILER` = `off` (default, also when
  unset) | `log` | `smtp`; `ses` refused as reserved, anything else (case, padding included) refused; static messages, no
  value echoed; `Enabled()` false for the zero value. `main.go` loads it after the other runtime configs, logs only the
  mailer kind, and passes `Enabled()` to `newNotificationFanOut` / `newNotificationScheduler` →
  `Processor.WithEmailDeliveries` / `Runner.WithEmailDeliveries` (off by default, so existing callers are unchanged). Only
  `NOTIFICATIONS_MAILER` is loaded: the keys required when mailer ≠ off (`…_EMAIL_FROM`, `…_UNSUBSCRIBE_*`,
  `APP_BASE_URL`, SMTP host/port, max-per-second) are left to the slices that consume them, so with `log`/`smtp` E4 only
  queues `pending` deliveries (no sender until E6). Domain `domain/email.go`: `Coalesced(type)` = the three grouped types
  (D10). New package `internal/features/notifications/emaildelivery` (`Create(ctx, q, rows)`, shared by both paths, no
  address ever read): one email-channel override read (`ListNotificationPreferenceOverrides`, skipped when every type is
  mandatory) → rows with the effective email preference on → one `ListNotificationEmailDeliverableUsers` (new: ids of
  live users with non-empty address whose `lower(btrim(email))` is not in `email_suppressions`) → per eligible row in
  order `UpsertCoalescedNotificationEmailDelivery` (contract SQL, `send_after = now() + 10 min`, conflict only bumps
  `updated_at`, returns the open id) or `InsertImmediateNotificationEmailDelivery` (`send_after = now()`), then
  `LinkNotificationEmailDelivery :execrows` (`… AND email_delivery_id IS NULL`, ≠ 1 row → error). Fan-out: inserted rows
  are collected and `Create` runs after the insert loop, before the mark (new step `email`); scheduler: `insert` now
  returns `(id, n, err)`, rows with `n == 1` are collected and `Create` runs before the resolve (step `email`). A failure
  fails the event's / run's tx. Deviation (shape only): §Creation step 1 describes one combined read before the insert;
  E3 already reads `in_app` before the inserts, and the email reads run after them, batched, for inserted rows only (a
  fully deduplicated re-run reads nothing). RED observed: build failures (undefined `LoadNotificationsEmailConfig`,
  `NotificationsMailer`, `Coalesced`, `WithEmailDeliveries`); then with no-op `WithEmailDeliveries` stubs, 7 integration
  tests failed with zero deliveries (`TestFanOutEmailEligibilityAtCreation`, `…MandatoryEmailNeedsADeliverableAddress`,
  `…CoalescesABurstIntoOneWindow`, `…WindowCloseRaceWithAConcurrentClaim`, `TestScheduleCreatesImmediateDeliveries`,
  `…SuppressedAddressGetsNoDelivery`) while both mailer-off tests passed. GREEN, new tests: config table (off default,
  log/smtp, ses reserved, case/padding/unknown refused, no value leaked, nil lookup, zero value off); domain coalesced set
  and email-channel resolution (member operational off, candidate on Q1, mandatory on facing a row, other company
  ignored); fan-out matrix (owner email on + in_app off → hidden row with a 10-min window delivery; recruiter default off
  and on only in another company → none; candidate default on → immediate, kind candidate, company NULL, group = the row's
  `n:<id>`; psychometric_pending default off → none), mailer off → none, mandatory `vacancy_reassigned` with an email-off
  row (CHECK dropped) → immediate, suppressed normalized address (`'  Owner.Suppressed@Example.TEST '` vs
  `owner.suppressed@example.test`) → none even mandatory, blank address → none while the in-app row exists, lifting the
  suppression applies to the next event; burst of 3 → one pending delivery linking 3 rows, a 4th in a later tx joins it
  with `send_after` unchanged, re-processing all 4 → deliveries identical and events processed with 0 attempts, after the
  window leaves `pending` → a new pending delivery with the same group linking only the new row; race: a claim
  (`pending → sending`) held in an open tx, a concurrent tick observed waiting on a `Lock` in `pg_stat_activity`, claim
  committed → the tick inserts a second delivery (old stays `sending` with its rows), claim rolled back → the row joins
  the open window. Scheduler: overdue → immediate deliveries for owner and recruiter (an email-off row on the mandatory
  type ignored), due-soon only for the owner with email on and in_app off (hidden row mailed), stakeholder never, second
  run `Result{}` with deliveries unchanged; suppressed owner → nothing even for `delivery_overdue`,
  `assignment_deadline_due_soon` with email on → immediate; mailer off → none. Mutations (each restored byte-identical,
  sqlc regenerated): deciding email for deduplicated rows fails the re-processing assertion (`attempts:1 processed:false`);
  a sliding window (`send_after` bumped on conflict) fails the burst test; dropping the deliverability filter fails the
  suppression/blank-address tests (fan-out and scheduler); dropping `n == 1` in the scheduler fails with `notification
  not linkable to its email delivery`. Validation: `make test-integration PKG=./internal/features/notifications/...` ok
  (6 packages, 92 top-level PASS, 0 FAIL, 0 SKIP), `make test-integration PKG=./cmd/api/ RUN='^TestNotifications'` ok
  (20 PASS), `make test PKG='./internal/features/notifications/... ./internal/runtime/... ./cmd/api/
  ./internal/tools/archguard/'` ok, `go tool sqlc diff` clean. Not covered: a soft-deleted user as recipient (not
  tested; the deliverability query filters `deleted_at IS NULL`); the override read is now in three places (fan-out
  and scheduler in_app, `emaildelivery` email). Scratch logs left in `backend/internal/features/notifications/.e4-logs/`
  (untracked, to delete before committing).
- **L13** 2026-11-26, E4 committed (58e86742). Native review `review-72a3d51eac3589a6` approved. Parent decisions on its
  advisories: (1) an email-side failure must not roll back in-app rows or the whole scheduler run — in E6 wrap
  emaildelivery.Create in a savepoint: on error roll back only the email part, keep the in-app rows, log step `email` with
  SQLSTATE distinctly, and leave no delivery (the notification simply gets no email); test by breaking the deliveries table in
  the disposable DB. This refines D8 ("same tx") to "same tx, isolated by a savepoint"; update the contract in E6.
  (2) `NOTIFICATIONS_MAILER=log|smtp` before the sender exists only queues rows: acceptable because the branch is not
  released before E6; E6 must make startup refuse a non-off mailer without the required keys. (3) Add a soft-deleted
  recipient test in E6.
- **L14** 2026-11-26, T6/E5 implemented (uncommitted, worktree only; no sender loop — E6). New package
  `internal/features/notifications/email`: `Message` (to, from, subject, text, HTML, `MessageID` =
  `<delivery_id@sender domain>`, `Headers`, plus value-free metadata delivery id / type / template), `Mailer` port,
  `ErrPermanent`; `TokenSigner.Sign(domain.PreferenceKey)` seam for the E7 HMAC token (tests use a fake; tokens must
  match `[A-Za-z0-9_.-]{1,512}`); `NewRenderer(Settings{From, AppBaseURL, UnsubscribeURL}, signer)` and
  `Render(View) (Message, error)` — `View` = delivery id, type, address (read by E6 at send time), user, company
  (`uuid.Nil` = candidate), count, the group's link descriptor (inbox rule, computed by E6), job title / company name
  (nil or blank → «una vacante» / «una empresa»), group day (instant → its America/Mexico_City day), commitment date
  (DATE → own components, never shifted), function / reason / status codes. 17 templates T1–T17 in a code table with the
  verbatim §Templates copy (T13 body per L8), parsed as `text/template` with `missingkey=error`; embedded layouts
  `templates/layout.txt.tmpl` (text) and `layout.html.tmpl` (`html/template`, contextual escaping); F1/F2 by
  `domain.Locked`; label maps (unknown code → render error, so free text never reaches a mail); control characters in
  title/company collapse to one space; path map table (`linkPath` + fixed paths), `app_url` = APP_BASE_URL + path,
  null link → `/empresa` (T13) or `/candidato/postulaciones` (candidate types, L6), any other null/mismatched link or
  missing id → error; grouped types: participation link (count 1) → `.one`, vacancy_candidates → `.many`. Headers:
  `Auto-Submitted: auto-generated` always; `List-Unsubscribe: <NOTIFICATIONS_UNSUBSCRIBE_URL?token=…>` +
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` and the landing link `/notificaciones/baja?token=…` only for
  non-mandatory types (the signer is never called for mandatory ones). Adapters: `email/logmail` (one line: delivery_id,
  type, template, has_unsubscribe; nothing else) and `email/smtpmail` (net/smtp over a ctx-bounded dial, no auth/TLS,
  multipart/alternative quoted-printable, RFC 2047 subject, CR/LF and reserved header names refused; SMTP 5xx / invalid
  address → `ErrPermanent`, 4xx / network / timeout → transient; errors never carry server text or addresses; provider
  id = Message-ID). `cmd/api/notifications_email.go`: `newNotificationMailer(cfg, logger)` (off → nil) for E6. Config:
  `NotificationsEmailConfig` + `From` (net/mail, one address with domain, header form), `AppBaseURL` (http(s) origin, no
  path/query/fragment/credentials, trailing slash trimmed), `UnsubscribeURL` (absolute, no query/fragment/credentials),
  `SMTPHost`/`SMTPPort` (smtp only); with mailer ≠ off the first three are required, smtp needs host/port and is refused
  when `APP_ENV=production`, https required in production for both URLs; mailer off ignores every other key; static
  errors naming the key, no value echoed. So startup now refuses `log|smtp` without the E5 keys (L13 item 2, E5 part;
  `NOTIFICATIONS_UNSUBSCRIBE_KEYS` stays with E7, `…_MAX_PER_SECOND` with E6). Compose: `mailpit` service
  `axllent/mailpit:v1.21.8`, `127.0.0.1:1025` / `127.0.0.1:8025`, no volume (not started here). RED observed: build
  failures (undefined `TokenSigner`, `Renderer`, `View`, `Link`, …; config fields); then with only the struct fields
  added, `TestLoadNotificationsEmailConfigParsesTheE5Keys` and 27 subcases of `…RejectsInvalidE5Keys` failed. GREEN:
  `make test PKG='./internal/features/notifications/... ./internal/runtime/config/ ./cmd/api/
  ./internal/tools/archguard/'` ok (13 packages, 307 top-level PASS, 0 FAIL, 0 SKIP; 29 new top-level tests: email 15
  incl. 17 per-template goldens and 2 full literal goldens, logmail 3, smtpmail 6 against an in-process loopback
  `net/textproto` server, config 4, cmd/api 1), `go vet ./...` clean. Mutations (each restored byte-identical): T13 body
  back to the L5 text, unsubscribe headers on every type, no control-character cleaning, instant date not converted to
  Mexico City, SMTP 5xx treated as transient, candidate null link → `/empresa` — each fails its test. Deviations:
  `Message` carries three metadata fields beyond the §Mailer sketch (for the log adapter); https-in-production also
  applied to APP_BASE_URL; the renderer takes the link descriptor from the caller (E6 should export the inbox `linkFor`
  rule rather than duplicate it). Not done: the backend example env file (outside the surface) lacks the new keys; the
  Mailpit tag was not pulled. Scratch logs in `backend/internal/features/notifications/.e5-logs/` (untracked, delete
  before committing).
- **L15** 2026-11-26, E3+E4 independently verified (6/6 pass; integration 92/0/0; window-close race reasoned correct under
  READ COMMITTED). Follow-ups for E6: soft-deleted recipient test; race-test lock probe scoped to the fan-out connection;
  override-read helper duplicated 3×. E5 committed by the parent (config keys, email package, Mailpit compose).
- **L16** 2026-11-26, T8/E7 implemented (uncommitted, worktree only; no sender — E6). New package
  `internal/features/notifications/unsubscribe`: `Signer` (`NewSigner(keys, now)`; satisfies `email.TokenSigner`) issues
  `<kid>.<payload>.<mac>` exactly as §Unsubscribe (payload compact JSON `{"v":1,"u","c"|null,"t","x"}`, base64url no
  padding, `mac` = base64url(HMAC-SHA256(key, "pf-notif-unsub:v1:" + kid + "." + payload)), expiry now + 365 d; first key
  signs, every key verifies); `Sign` refuses mandatory types, a wrong tree (member type ⇔ company), nil user, unknown
  type; `Verify` in contract order — ≤ 512 chars and `[A-Za-z0-9_.-]`, three parts, unknown kid MAC-checked against a
  per-process random decoy key, `hmac.Equal` over the MAC text (so a change in the MAC's padding bits also fails), then
  strict payload (every key required, no unknown/duplicate keys, no trailing data, `v = 1`, `x > now`, uuids non-nil, `t`
  non-mandatory of the tree implied by `c`) — every failure returns exactly `ErrInvalid`; a nil `*Signer` (mailer off)
  verifies and signs nothing; `Key`/`Signer` render redacted under fmt, slog and JSON. `Store`: `Target` (one statement,
  no write) and `TurnOff` (tx: same check + upsert); a key is served only when the user is live and of the tree's
  `user_type` (`recruiter` / `candidate`) and, for members, the company exists and is not soft-deleted — else
  `ErrNoTarget`, answered like any invalid token. Queries `GetNotificationUnsubscribeTarget` (user_type, company name,
  email override; nothing else about the user) and `UnsubscribeNotificationEmail` (upsert `email = false, source =
  'unsubscribe'`, `DO UPDATE … WHERE enabled`: a row already off — settings or unsubscribe — is untouched, so repeats change
  nothing); sqlc regenerated. `Handler` GET (effective value via `EffectivePreference`, never writes) / POST (body read
  up to 1 KiB and ignored → over the cap `413 payload_too_large` before the token check), exactly one `token` query value,
  200 body `{type, channel:"email", enabled, company:{id,name}|null}`; invalid → `422 unsubscribe_link_invalid` via the
  catalog (identical bytes, no data); store error → 500 with the code class only (no token/user/company logged).
  `Privacy` middleware (`Cache-Control: no-store`, `Referrer-Policy: no-referrer`). `Limiter`: fixed window 60 / 10 min
  per IP per instance (`DefaultLimits`), keyed on requestmeta's resolved client IP (BFF-attested `X-PF-Client-IP` with the
  proxy secret, else peer / TRUSTED_PROXY_CIDRS forwarded client — L6), IPv6 /64, missing meta → one `unknown` bucket,
  rejections consume nothing, full key table (100 000) fails closed, `429 rate_limited` + `Retry-After` via
  `httpjson.WriteRateLimited`. Catalog: `CodeUnsubscribeLinkInvalid` (422, "unsubscribe link invalid") in
  `httpjson/notification_errors.go`. Config: `NOTIFICATIONS_UNSUBSCRIBE_KEYS` → `NotificationsEmailConfig.UnsubscribeKeys`
  (required when mailer ≠ off; comma list `kid:base64key`, std/URL base64 padded or not, spaces around entries trimmed,
  kid `[a-z0-9]{1,16}` distinct, key ≥ 32 bytes; static error naming the key; redacted under fmt/slog/JSON; mailer off
  ignores it like every other key). Router: public group `unsubscribe.Privacy` + limiter, `Get`/`Post
  /v2/notifications/unsubscribe` outside every auth gate (added to `TestRouteTopology_ExactRegistrations`); nil deps fail
  closed (default limiter; a handler without keys refuses every token without touching the DB). `main.go`:
  `notificationUnsubscribeSigner` from config (`cmd/api/notifications_unsubscribe.go`, nil when off; startup fails on
  invalid keys), passed to the handler and available for E6's renderer; no sender started. RED observed: unit build
  failures (undefined `Signer`, `Key`, `Limiter`, `Target`, `CodeUnsubscribeLinkInvalid`, `UnsubscribeKeys`); the 5
  `TestNotificationsUnsubscribe_*` got `404 page not found` with the deps wired but no routes; topology test drifted
  with the 2 routes in `want`; `TestUnsubscribeKeysAreNeverPrinted` (after fixing a test bug that lowercased the output)
  caught slog's JSON handler marshalling the config with the key bytes in base64 → `MarshalJSON` added;
  `TestKeysAreNeverPrinted` failed vet (`%s` on a non-Stringer `*Signer`). GREEN: unit — token 11 (round trip both trees
  with the contract formula recomputed independently, expiry at x−1 s / x / later, every single-char mutation, other key
  under the same kid, swapped payload, truncated/extended MAC, unknown/invalid kid, rotation old verifies/new signs/
  dropped refuses, length/charset, 24 payload rules, `Sign` refusals, key validation, nil signer, redaction), limiter 5
  (fixed window + Retry-After, IPv6 /64, BFF-attested vs forged header vs trusted/untrusted XFF, unknown bucket + key cap
  + zero limits), handler 5 (GET no writes + defaults, POST one-click/empty/{}/ignored/exactly 1 KiB, 1 KiB+1 → 413, 12
  invalid causes × both methods identical bytes, nil verifier, 500); config 3; httpjson 1; cmd/api 1. Integration (5
  `TestNotificationsUnsubscribe_*`): member GET default/after settings-on without changing rows, POST one-click with
  another user's Bearer acts on the token's user only, row `(company, application_received, email, false,
  unsubscribe)`, in_app row untouched, repeats (one-click / empty / `{}`) change nothing, preferences catalog shows it, a
  settings-off row stays `settings`, 0 audit rows; candidate token company NULL (GET on by Q1, POST row company NULL,
  catalog); foreign company token writes only that company's key; 19 invalid causes × GET/POST (missing/empty/two
  tokens, malformed, 513 chars, bad MAC, unknown kid, other key, expired, mandatory ×2, wrong tree ×2, unknown user,
  soft-deleted user, member token for a candidate account and vice versa, unknown and soft-deleted company) → identical
  422 bytes, nothing written; 1025-byte body → 413; PUT/DELETE/PATCH → 405; 60 mixed requests from one BFF client then
  429 (also for an invalid token), another BFF client 200, forged `X-PF-Client-IP` without the secret shares the peer's
  bucket. Mutations (each restored byte-identical; generated SQL edited in place for the SQL ones): unknown kid MAC'd with
  the current key and no `known` guard, MAC never compared, `x >= now` accepted, mandatory types eligible, duplicate JSON
  keys allowed, GET calling `TurnOff`, duplicated `token` accepted, limiter ignoring requestmeta, key `String`/`Format`
  leaking, no `MarshalJSON`, short keys accepted, `Signer` without `Format`, store without either `user_type` check,
  upsert without `WHERE enabled`, soft-deleted company accepted — each fails its test. Survivors, equivalent by design:
  the decoy key and the `known` guard each alone (redundant guards; together killed). Validation: `make test
  PKG='./internal/features/notifications/... ./internal/runtime/config/ ./internal/shared/httpjson/ ./cmd/api/
  ./internal/tools/archguard/'` ok (14 packages, 406 top-level PASS, 0 FAIL, 0 SKIP); `make test-integration
  PKG=./internal/features/notifications/...` ok (10 packages, 137 PASS, 0 FAIL, 0 SKIP); `make test-integration
  PKG=./cmd/api/ RUN='^TestNotifications'` ok (25 PASS); `go tool sqlc diff` clean; `go vet ./...` clean. Decisions /
  deviations: (1) the limiter lives in the feature, not `internal/runtime/ratelimit` (outside the slice's surface and
  token-path specific; it keys on `clientip.Resolve` only, while behind the BFF the client is requestmeta's attested IP);
  (2) membership is not re-checked — the row is keyed by the token's company (D1) — but the company must exist and not be
  soft-deleted; (3) with the mailer off the keys are ignored (consistent with the other keys), so links already sent stop
  working while the mailer is off; (4) the one-click pass-through must forward `X-PF-Proxy-Secret` + `X-PF-Client-IP` (or
  arrive through a TRUSTED_PROXY_CIDRS proxy), otherwise every one-click shares the Next server's 60 / 10 min budget —
  frontend to confirm; (5) a race where the user/company is hard-deleted between the check and the upsert surfaces as a
  500 (FK), not 422. Contract unchanged (outside the surface): §Unsubscribe could note (2), (4) and the 413 order.
  Scratch logs and a throwaway probe in `backend/internal/features/notifications/.e7-logs/` (untracked, delete before
  committing).
