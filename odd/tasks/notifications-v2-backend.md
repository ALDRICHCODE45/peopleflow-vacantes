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

- T1 — S1–S9 — contract `docs/contracts/notifications-v2.md` (Draft) for frontend review — worker (docs) — pending
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
