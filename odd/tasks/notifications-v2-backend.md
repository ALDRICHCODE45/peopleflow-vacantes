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

## Tasks

- T1 — S1–S9 — contract `docs/contracts/notifications-v2.md` (Draft) for frontend review — worker (docs) — drafted (uncommitted)
- T2+ — implementation slices from the agreed contract — pending

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
