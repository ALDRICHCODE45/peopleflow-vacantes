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
- T4 — E3 — in-app off at creation in fan-out and scheduler, `InsertNotification` → `:execrows` — worker — pending
- T5 — E4 — config loader, email eligibility, delivery creation with coalescing upsert in both creation paths — worker — pending
- T6 — E5 — `Mailer` port, `log`/`smtp` adapters, Mailpit in compose, templates with the S10 copy, headers, dates, path map — worker — pending
- T7 — E6 — sender loop (claim/lease, re-check/skip, fenced finalize, backoff, throttle), start/stop in `main.go` — worker — pending
- T8 — E7 — unsubscribe token, public GET/POST, per-IP limit, `unsubscribe_link_invalid` — worker — pending
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
