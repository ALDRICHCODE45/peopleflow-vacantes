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
| T2 | S1–S6 | Backend contract proposal (events, recipients, inbox API, preferences) with the backend session | |
| T3 | S5–S6 | Stage 1 implementation (bell + inbox + stage-1 events) | |

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
