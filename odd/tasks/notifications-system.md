# Notifications system (in-app + email, company and candidates)

Real notifications for PeopleFlow: an in-app bell and inbox for company teams and candidates, email for the events that
allow it, company rules set by the owner and personal preferences within them. Delivered in stages; design first.

## Specs

- **S1** User, verbatim (L1): «estoy pensando en un sistema de notificaciones completo ... notificaciones reales robustas
  en el sistema, configurables par que lleguen por correo (hay que hablar esto tambien porque no toooodas las
  notificaciones InApp deben poder ser configuradas para llegar por correo, o al menos eso creo), yo creo que debe haber
  notificaciones InApp, algunas automaticas, algunas configurables para que lleguen por correo, algunas que se puedan
  desactivar, elegir a quien le llegue por usuario, por rol, me sigues?? quiero algo realmente usable y profesional» →
  three kinds: mandatory (can't be turned off; email always), operational (can be turned off; email configurable,
  immediate or digest), informative (in-app only); recipients by relation to the object, by role and by person.
- **S2** Audience (L2): «Empresa y candidatos (recomendado)» — one system for company teams and candidates.
- **S3** Configuration (L2): «Dueño define, persona ajusta (recomendado)» — the owner sets company rules and defaults per
  event and role; each person can turn off or change their own within them (mandatory ones excepted).
- **S4** Default recipients for vacancy events (L2): «Equipo de la vacante (recomendado)» — the responsible recruiter and
  the vacancy team; the owner can opt in.
- **S5** Delivery (L2): «Por etapas (recomendado)» — stage 1: bell + inbox + the stage-1 events; stage 2: email +
  personal preferences; stage 3: owner rules, digests and more events.
- **S6** Stage-1 events (L3), all selected by the user: «Nueva postulación + entregas por vencer/vencidas»,
  «Asignación/reasignación de vacante y equipo», «Prueba psicométrica completada / pendiente», «Candidato: cambio de
  estado y mensajes». Grouping («5 postulaciones nuevas en …»), deep link to the object, read/unread, mark all as read.
- **S7** Design first (L3): «Sí, diseños primero (recomendado)» — 2–3 directions on the canvas for the bell + inbox
  (company and candidate), the personal preferences page and the owner's rules section; the user picks before
  implementation.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1–S7 | Design directions in `design/notifications/` (writer, gentle-design) | |
| T2 | S1–S6 | Backend contract proposal (events, recipients, inbox API, preferences) with the backend session | backend 80a5ce80 (agreed, L11) |
| T3 | S5–S6 | Stage 1 implementation (bell + inbox + stage-1 events), branch `feat/notifications-ui` | |
| T3.1 | S6 | Company API client + types for GET list / unread-count, unread-count polling (~30 s + on focus); inline | 2b138bd2 |
| T3.2 | S6 | Bell with unread counter in the company shell; opens the inbox sheet; inline | aa40a4f9 |
| T3.3 | S6 | Inbox side sheet (design 07): attention, grouped items, copy per type, link mapping (L10), cursor paging, empty/error; inline | aa40a4f9 |
| T3.4 | S6 | Pipeline board opens one candidate from `?candidato=<participation_id>` (link kind `participation`); inline | e50b2cd8 |
| T3.5 | S6 | Read / unread with exact undo / read-all / type+vacancy filter (needs backend N5) | API e1ae7127; UI 26067fac |
| T3.6 | S2, S6 | Candidate bell + inbox on `/v2/me/notifications` (needs backend N6) | e3f718be |
| T4 | S1, S3, S5 | Stage 2 (email + personal preferences), branch `feat/notifications-stage2` | |
| T4.1 | S1, S3, S5 | Stage-2 backend contract with the backend session (email channel, preferences API) | |
| T4.2 | S3 | «Mis preferencias» page (design 05), company and candidate | 9ee4a313 |
| T4.3 | S6 | Candidate status and test due-date badges in inbox rows (design 04) | 212cad66 (status badge; test due date needs API) |
| T4.4 | S3 | «Preferencias» link and «Elegir qué me llega» wired to the new page | 9ee4a313 |

## Log

- **L1** (2026-11-26) User, verbatim: «Esto hay que posponerlo.. porque estoy pensando en otra cosa, estoy pensando en un
  sistema de notificaciones completo, porque ahora viendolo bien, creo que hace falta eso, notificaciones reales robustas
  en el sistema, configurables par que lleguen por correo (hay que hablar esto tambien porque no toooodas las
  notificaciones InApp deben poder ser configuradas para llegar por correo, o al menos eso creo), yo creo que debe haber
  notificaciones InApp, algunas automaticas, algunas configurables para que lleguen por correo, algunas que se puedan
  desactivar, elegir a quien le llegue por usuario, por rol, me sigues?? quiero algo realmente usable y profesional, pero
  esto anotalo para tenerlo en mente y poder hablarlo despues.»

Topics to discuss later: catalogue of events (which are in-app only, which can also go by email, which can be turned off,
which are mandatory), recipients per user and per role, user preferences vs company defaults, digests vs immediate, the
first consumer («Dejar mi CV» from the careers site, slice C), delivery infrastructure (email provider, retries, unsubscribe).
- **L2** (2026-11-26) Agent's starting point: no notification system exists (backend nothing; Configuración shows it as
  «Próximamente»), no email provider. Model proposed: event → recipient rule (by relation to the object, by role, by
  person) → channel (in-app always; email only for events that allow it, immediate or digest) → preferences (company
  rules by the owner, personal within them); three kinds: mandatory (can't be turned off, always email), operational
  (can be turned off, email configurable), informative (in-app only). User answers: «Empresa y candidatos
  (recomendado)»; «Dueño define, persona ajusta (recomendado)»; vacancy events default to «Equipo de la vacante
  (recomendado)»; delivery «Por etapas (recomendado)» — 1) bell + inbox + 5–6 key events, 2) email + preferences,
  3) owner rules, digests and more events.
- **L3** (2026-11-26) User picked all four stage-1 event groups and «Sí, diseños primero (recomendado)». Agent-owned
  technical choices: the bell refreshes every ~30 s and on tab focus at first (real-time push later); email provider
  for stage 2 proposed as Amazon SES (AWS already used for Cognito/S3), to confirm then. Docs ride on branch
  `feat/careers-hero-video` until that merges (docs only).
- **L4** (2026-11-26) T1 design directions written to `design/notifications/` (gentle-design; `design.json` links this
  feature; none chosen yet): `01-popover-desde-la-campana.html` (420 px popover from the bell; fastest, no filters),
  `02-hoja-lateral-con-filtros.html` (modal right sheet with «Requiere atención» pinned and filters by type and vacancy),
  `03-bandeja-en-dos-paneles.html` (own page /empresa/notificaciones, list + detail with the group's candidates and the
  delivery's progress; the bell is a link) — the three company bell + inbox alternatives at 1440, light and dark;
  `04-telefono-y-candidato.html` (shared by all three: full-screen inbox at 390, candidate bell at 1440 and 390);
  `05-mis-preferencias.html` (personal events × channels table, mandatory rows locked with the reason, owner-disabled rows,
  «Tu ajuste», «Restablecer a lo que define tu empresa»; candidate variant); `06-reglas-de-la-empresa.html` (owner rules per
  event, role defaults Dueño/Reclutador/Stakeholder, preview «Así le llega a Valeria»). Browser review (Chromium + axe,
  165 runs): 0 axe violations, no horizontal overflow, visible focus, reduced motion respected; deviations from
  `design/system.md` (popover 420 px, sheet 460 px, bell count pill, sticky day headers, among others) listed in
  `design/notifications/self-check.md`.
- **L5** (2026-11-26) User, verbatim: «1. me gusta mas la opcion 02. Hoja lateral con filtros pero los filtros nunca me han
  gustado asi, se ven desordenados, hay que pensar en otro diseno para los filtros. 2. me parece bien. 3. si, esta bien,
  peroo el stake holder no puede estar en el equipo de una vacante, el no puede hacer nada, el solo ve metricas,
  desempeno, reportes, vacantes, usuarios, en fin, ve tooodo pero no hace nada, no puede hacer nada. 4. encendida. Y con
  respecto a las preferencias, vamos por la 05. alguna duda?» → bell + inbox = 02 (side sheet) with a new filter design
  (options to be drawn); mandatory events fixed as drawn (owner can only add recipients); stakeholders are read-only and
  never on vacancy teams, so they get no vacancy events by default — the owner may enable events for the Stakeholder
  role, in-app only (agent's proposal, stated to the user); company-side «Prueba pendiente del candidato» ON by
  default; personal preferences = 05; 06 kept as the stage-3 basis, corrected for stakeholders.
- **L6** (2026-11-26) T1 iteration on L5 (gentle-design; 02 itself untouched): three new artboards with the 02 side sheet
  (same content, states and behaviour, plus a 390 phone frame of the sheet in every state) and three calm filter designs,
  each one row (or none) at the sheet width, with the result count and «Limpiar» in one quiet line —
  `07-hoja-lateral-boton-filtrar.html` (tabs + «Filtrar» button with a count; type and vacancy checkboxes with vacancy
  search in a small panel; calmest, but filters are one click away and active ones read as text),
  `08-hoja-lateral-barra-de-tipos.html` (single-choice segmented Todo · Candidatos · Entregas · Vacantes + vacancy icon
  button opening a combobox; tabs move to the title row; fastest type switch, but merges Postulaciones + Pruebas into
  «Candidatos», one type at a time, vacancy only visible as an icon mark), `09-hoja-lateral-buscar-y-filtrar.html` (no
  visible filters: a search combobox that understands vacancy, candidate and type names, with quick type toggles in its
  list; cleanest and scales best, but types are hidden until opened and it is the costliest to build). `06`: stakeholders
  are read-only and never on a vacancy team (removed from «Equipo de la vacante» wording, not pickable by name, team rows
  «No aplica»); the Stakeholder role receives nothing by default and the owner may enable chosen events for it, in-app only
  (no email option); «Así le llega a Mariana» shows nothing by default and explains why; new state «Stakeholder · aviso
  activado»; «Prueba psicométrica pendiente» ON by default. `05`: only the «Prueba pendiente del candidato» row changed to ON
  (in-app only). `design.json` and `self-check.md` updated. Browser review (Chromium + axe, 172 runs over 05–09): 0 axe
  violations, no overflow at 1440/390, visible focus, reduced motion respected; keyboard flows scripted and passing.
- **L7** (2026-11-26) User picked: filters «07 · Botón «Filtrar» (recomendado)» (the bell + inbox = 02 side sheet with 07's
  filter button/popover and one-line summary); stakeholder events enabled by the owner reach them «De todas las vacantes
  (recomendado)»; stakeholders «No, solo por rol (recomendado)» — never picked by name. Chosen artboards: 07 (inbox, with
  02 as the sheet base), 04 (phone + candidate), 05 (preferences); 06 is the stage-3 basis. T2 contract proposal drafted
  in `odd/tasks/notifications-system-contract.md`.
- **L8** (2026-11-26) Backend session took stage 1; mapping where each event happens, audit events in the same
  transaction (outbox hook), the existing in-process scheduler (advisory lock, used by document Reconcile) and where
  delivery deadlines live; counter-proposal of the contract to follow. Constraint: candidates added manually by a
  recruiter have no user account, so in-app candidate events only reach candidates who applied themselves (email in
  stage 2 could reach the others if they have an email — to decide then).
- **L9** (2026-11-26) Backend counter-proposal (odd/tasks/notifications-backend.md on its branch feat/notifications-backend):
  capture in the audit append (same tx) → `notification_events`; in-process dispatcher (SKIP LOCKED) → `notifications`
  with ON CONFLICT DO NOTHING; event mapping from existing audit types; 15-min scheduler (advisory lock, Mexico City
  dates) for due-soon/overdue; dedupe UNIQUE(recipient, source_event, type) and UNIQUE(recipient, type, draft,
  commitment_date); actor never self-notified; stakeholders get nothing (stage 1); manual candidates skipped; members
  only while members; texts built by the frontend from type + ids, names resolved at read time; retention 180 days.
  Frontend asked for: server-side groups (group_key per job per local day for applications/psychometrics, count, sample,
  latest_at), unread_count of groups, group read/unread (undo exact), urgency + kind per item, attention outside
  pagination, facets per type/job, stage-3-ready per-role resolver, candidate scope. Contract notifications-v1.md next.
- **L10** (2026-11-26) Frontend review of backend contract `docs/contracts/notifications-v1.md` (73355dc3, worktree
  peopleflow-vacantes-notif), approved by the user and sent: OK to shapes with fixes (14 types not 11; attention in
  §GET B includes assignment_deadline_*; attention overflow beyond 20 falls back into items) and asks (from_user /
  to_user names resolved at read time; confirm /v2/me/applications item id == participation_id or add application_id
  to the link; enumerate reassignment reason values). Link mapping: vacancy / vacancy_candidates →
  /empresa/vacantes/[jobId]/pipeline; participation → same + ?candidato=<pid> (new board param, T3);
  vacancy_delivery → /empresa/vacantes/[jobId]/configuracion/entrega; application →
  /candidato/postulaciones?postulacion=<id>; assessment → /candidato/evaluaciones/[invitation_id]. Copy for new types:
  vacancy_unassigned «Ya no eres responsable de {vacante}» / «{actor} reasignó la vacante a {to_user}. Motivo:
  {motivo}.»; assignment_deadline_due_soon «Tu fecha límite en {vacante} es {hoy|mañana}» / «Como {función}, tu
  entrega vence el {fecha}.»; assignment_deadline_overdue «Venció tu fecha límite en {vacante}» / «Tu entrega como
  {función} era el {fecha}.» Side finding: stage-config/editor.tsx:100 links to /empresa/vacantes/${draftId} (no page).
- **L11** (2026-11-26) Backend contract agreed: `docs/contracts/notifications-v1.md` commit 80a5ce80 (status «Agreed»).
  All L10 fixes taken: 14 types; attention = the 4 deadline types; only the ≤20 attention items (created_at DESC, id
  DESC) are excluded from items, the rest stay in items; vacancy_reassigned / vacancy_unassigned carry from_user /
  to_user {user_id, name} (name null if the user no longer exists); participation_id == /v2/me/applications item.id
  (no application_id); reason ∈ workload | recruiter_departure | performance | client_request | other (free note of
  other never included). T2 done. Backend started N1; it will notify when N4 is usable locally (T3 waits on it).
- **L12** (2026-11-26) Backend N4 usable locally (branch feat/notifications-backend, worktree peopleflow-vacantes-notif,
  HEAD a9e48d8a; not in main; needs migration 00068, down/up if run before it stabilized): GET
  /v2/me/company/notifications and GET …/unread-count behind the owner/recruiter/stakeholder gate. Shape notes:
  from_user / to_user are top-level fields of the item (not inside latest) and are omitted (not null) when the payload
  has no user id; single-candidate groups link `participation {job_id, participation_id}`; with a cursor, attention and
  attention_total are null; invalid filter → 400 invalid_filter with fields[] reasons invalid|too_many|duplicate;
  mismatched cursor → 400 invalid_cursor. Reference payload: backend test
  TestNotificationsRead_GroupedListShapesAndUnreadCount. Next: N5 (read/unread/read-all, facets), N6 (candidate), N7.
- **L13** (2026-11-26) Backend N5 ready locally (feat/notifications-backend 89a63897, not in main): POST
  /v2/me/company/notifications/read and …/unread with exactly one of {group_keys} (≤100), {ids} (≤200) or (unread only)
  {marked_at}; response {affected_notifications, affected_groups, marked_at, unread_count, unread_notifications};
  «Deshacer» = POST …/unread {marked_at} (reverts exactly that batch). POST …/read-all {types?, job_ids?, before?}
  (before defaults to now, includes attention, empty body ok, empty arrays → 400), same response. GET
  …/facets?state=unread|all (default unread, ignores other filters) → {state, types[{type,count}] count DESC,
  jobs[{job_id,title|null,count}] by title with untitled last, ≤50, jobs_total}. Foreign ids/group keys → 200 with 0
  affected; unread never touches resolved rows. Validation fields[] codes: required, invalid, not_allowed, empty,
  too_many; body cap 64 KiB. T3.5 unblocked. Next backend: N6 (candidate routes).
- **L14** (2026-11-26) Backend stage 1 complete (feat/notifications-backend HEAD e1f0affd; not merged, not pushed —
  user decides). N6 candidate routes behind the /v2/me/applications gate: GET /v2/me/notifications, …/unread-count,
  POST …/read, …/unread, …/read-all, GET …/facets; same shapes as members except: each item has company {id, name}
  (null when the vacancy can no longer be resolved); actor always null, sample always []; attention always [] and
  attention_total 0; link is application {job_id, participation_id} or assessment {invitation_id}, null when the
  candidate no longer participates; title from the public projection (as /v2/me/applications); no candidate account →
  403 account_required. N7 = 180-day purge command, no API change. T3.6 unblocked (frontend schema must accept
  company: null).
- **L15** (2026-11-26) Close of T3 (feat/notifications-ui HEAD 6d97448e): full Vitest suite 12591 pass + 1 fixed
  (requestPath allowlist, 6d97448e), production build ok. Independent real-browser check (Chromium, real Cognito login,
  API e1f0affd at :8081, dev data Grupo Altavista): all 9 items pass, S2 and S6 pass — bell count/aria and 30 s polling,
  448px sheet / full-screen phone, attention 3 «Vencida» + 1 «Vence hoy», 9-application group with sample, reassigned
  copy, real Base UI «Filtrar» popover (focus, Escape, facets), single mark persisted, read-all + exact undo (member
  and candidate), pipeline ?candidato= incl. client navigation, candidate inbox without attention/sample/filter. Data
  restored to the initial counts. Not checked: «Cargar más», multiple day sections, filter popover on phone, hidden-tab
  polling. Notes: the application group dated 2026-11-18 by group_key shows under «Hoy» because latest_at is the
  notification created_at (seed events fanned out today); the candidate sheet on the pipeline is modal and covers the
  bell until closed.
- **L16** (2026-11-26) Backend b1124fc1 (user request): immediate notifications take created_at = the event's
  occurred_at, so the group day and latest_at agree even with a delayed fan-out; scheduler items keep run time. Frontend
  impact: none in code. Known edge: read-all `before` (newest latest_at shown) can now also mark a row fanned out after
  the page loaded whose event occurred before that instant (fan-out lag ~2 s) — accepted.
- **L17** (2026-11-26) Stage 1 merged to main (frontend 601eec53, backend e6b2d501) and pushed by the user. Stage 2
  decisions (user): «Email + preferencias personales (recomendado)» — digests stay in stage 3; operational events:
  «Apagado hasta que lo active (recomendado)» — email off by default, mandatory ones (overdue deliveries, assignments)
  always by email; candidates: «Solo los que tienen cuenta (recomendado)».
- **L18** (2026-11-26) Backend intake for stage 2: the app sends no email today; SES (us-east-1) is decided but not
  implemented (docs/decision-email-provider.md), no domain verified, and the user's lock «nadie TOQUE NADA DE AWS
  TODAVIA» stands → stage 2 builds the email channel against a Mailer port with a log/Mailpit adapter in dev; real SES
  sending waits for AWS. Backend proposal: notification_deliveries (one row per notification × channel, created in the
  fan-out tx when preferences allow), in-process send loop (SKIP LOCKED, backoff, throttle), preferences stored as
  exceptions only (defaults from kind; mandatory cannot be turned off → 422), one-click unsubscribe (RFC 8058) with a
  signed token, suppression table designed now. User decisions: bursts — «Un correo por grupo cada 10 min
  (recomendado)»; in-app — «Sí, las operativas se pueden apagar (recomendado)»; email content — «No, solo lo mínimo y
  un link (recomendado)». Agent decisions: preferences keyed per company (company_id NULL for candidates); email
  templates live in the backend with copy supplied by the frontend; Mailpit added to dev compose; mandatory emails carry
  only the «Mis preferencias» link, no per-type unsubscribe.
- **L19** (2026-11-26) Frontend review of backend `docs/contracts/notifications-v2.md` (Draft), approved by the user and
  sent: fixes (candidate email default table must read on per Q1; drop resolved items from open questions; T13
  `app_url` fallback `/empresa` when the link is null; landing and one-click need two paths), Q3 path map, Q4 frontend
  origin with a POST-only pass-through route, and the copy for T1–T17, F1–F2 and enum labels — all in
  `odd/tasks/notifications-stage2-email-copy.md`. Candidate email on by default (Q1) recorded as the user's decision.
- **L20** (2026-11-26) Backend contract v2 Agreed (feat/notifications-v2-backend 07bd4d5a) with every L19 item. Backend
  additions: candidate items with a null link use app_url = /candidato/postulaciones; unsubscribe per-IP limit uses the
  client IP forwarded by the trusted frontend proxy (E7). T13 body changed to «Otra persona quedó a cargo de
  {{job_title}}. Motivo: {{reason}}.» so the «una vacante» fallback never starts the sentence. Backend E1 started; E2
  (preferences GET/PUT) next. T4.1 done.
- **L21** (2026-11-26) Backend E2 usable locally (feat/notifications-v2-backend 912d9554, not in main, needs migration
  00069): GET/PUT /v2/me/company/notifications/preferences (member gate) and /v2/me/notifications/preferences
  (candidate). GET {channels, email_deliverable, items[{type, kind, channels{in_app|email: {default, enabled,
  mandatory_locked}}}]} — member 11 types, candidate 3 (email default on). PUT {preferences[{type, channel, enabled}]}
  1–28 entries, atomic, idempotent, returns the full catalog. Mandatory entry → 422 notification_preference_locked
  {data:{types[]}}, nothing written. 400 validation_error fields: preferences required|empty|too_many,
  preferences[i].type|channel|enabled required|invalid, preferences[i] duplicate; null body/entry → invalid_request;
  body cap 16 KiB. in_app off has no effect until E3; no email until E4–E6. T4.2 unblocked.
- **L22** (2026-11-27) Real-browser check of «Mis preferencias» (API ff559a7f, dev DB 69, Rodrigo + Valeria): 7/8 pass
  (catalog and locks, save with exact PUT entries, reload, discard, restore defaults, inbox «Preferencias» link,
  candidate page and «En proceso» badge, no console errors). Failed: at 390 px the «N cambios sin guardar» badge
  overlapped «Descartar»; fixed in 5e89495a (text column min width so the buttons wrap below), not re-checked in a
  browser. Both accounts left at defaults. Not triggered: 422 locked, email_deliverable false. The verifier printed
  the dev test-account password once in session tool output — the user should rotate it.
- **L23** (2026-11-27) Backend E7 (unsubscribe) committed (feat/notifications-v2-backend 3c6f2180): GET
  /v2/notifications/unsubscribe?token=… → 200 {type, channel:"email", enabled (current), company {id,name}|null}, never
  mutates; POST same URL (RFC 8058 body List-Unsubscribe=One-Click, ≤1 KiB) → same shape with enabled:false,
  idempotent. Any invalid/expired/tampered/mandatory token → 422 unsubscribe_link_invalid (identical); 429
  rate_limited with Retry-After; body >1 KiB → 413; other methods → 405. The frontend route /api/notificaciones/baja
  and the landing server action must forward X-PF-Proxy-Secret and X-PF-Client-IP like the rest of the BFF
  (requestmeta) and send no cookies or session. Backend changes the limiter: per-IP counts invalid tokens only, valid
  tokens are limited per token.
- **L24** (2026-11-27) Unsubscribe slice (6f082786 + 476f8961), Risk item 2: independent verify PASS (no blocking;
  nits applied in 476f8961: content-type whitespace, production env documented), native review approved and
  acknowledged (lineage review-a8971f39da2bd509, lenses risk + resilience). Advisory follow-ups (non-blocking, later
  work): R4-route-strict-parse-after-commit — a 200 whose body fails the strict parse is reported as 502 / «No se
  cambió nada» although the email is already off (route should treat any 200 as success); R4-ambiguous-post-failure-copy
  — on timeout/network after commit the landing says «No se cambió nada» (use neutral «no sabemos si se aplicó;
  reintentar es seguro»); R4-silent-forwarding-and-failures — warn once when AUDIT_PROXY_SECRET is missing outside dev
  and log token-free lines on 502/error paths.
- **L25** (2026-11-27) L24 follow-ups done in 7779d02c: any backend 200 to the unsubscribe POST counts as done (route
  200 {ok:true}; landing success without detail when the body does not parse); unknown outcomes (timeout, network,
  5xx, unexpected) show «No pudimos confirmar si se aplicó. Volver a intentarlo es seguro.» + «Reintentar»; «No se
  cambió nada.» only for 422/429/local refusal; token-free console logs with prefix [notifications/unsubscribe] and a
  one-time warning when AUDIT_PROXY_SECRET is missing outside development/test. 368 focused tests pass. Backend stage 2
  merged to local main (622f2b94) by the backend session with the user's approval; dev DB at 69.
