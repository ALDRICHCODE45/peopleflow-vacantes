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
| T3.1 | S6 | Company API client + types for GET list / unread-count, unread-count polling (~30 s + on focus); inline | |
| T3.2 | S6 | Bell with unread counter in the company shell; opens the inbox sheet; inline | |
| T3.3 | S6 | Inbox side sheet (design 07): attention, grouped items, copy per type, link mapping (L10), cursor paging, empty/error; inline | |
| T3.4 | S6 | Pipeline board opens one candidate from `?candidato=<participation_id>` (link kind `participation`); inline | |
| T3.5 | S6 | Read / unread with exact undo / read-all / type+vacancy filter (needs backend N5) | |
| T3.6 | S2, S6 | Candidate bell + inbox on `/v2/me/notifications` (needs backend N6) | |

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
