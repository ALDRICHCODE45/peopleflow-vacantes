# Notifications stage 2 — frontend answer to the backend contract (draft for approval)

Source: backend `docs/contracts/notifications-v2.md` (Draft, branch `feat/notifications-v2-backend`), Q3, Q4 and
§Templates. Decisions: `odd/tasks/notifications-system.md` L17–L18. Mexican Spanish, «tú». No candidate or member names
(L18). Variables in `{{…}}` are the contract's.

## Contract fixes

1. §Preferences default table says `off (Q1)` for the three candidate types, while D2 and Resolved Q1 say email is
   **on** by default for them. Make the table say `on (Q1)`.
2. «Open questions» still lists Q1, Q2, Q6–Q10 although §Resolved closes them; keep only the open ones (Q3, Q4, Q11).
3. `vacancy_unassigned` can have `link: null` (v1 D19). Say which `app_url` T13 uses then; proposal: the member
   dashboard `/empresa`.
4. Unsubscribe paths (Q4): the landing (GET, a page) and the one-click target (POST from mail providers) need two paths,
   because a Next page and a route handler cannot share one. See the path map below.

## Q3 — path map (`APP_BASE_URL` + path)

| Descriptor | Path |
| --- | --- |
| `vacancy {job_id}` | `/empresa/vacantes/{job_id}/pipeline` |
| `vacancy_candidates {job_id}` | `/empresa/vacantes/{job_id}/pipeline` |
| `participation {job_id, participation_id}` | `/empresa/vacantes/{job_id}/pipeline?candidato={participation_id}` |
| `vacancy_delivery {job_id}` | `/empresa/vacantes/{job_id}/configuracion/entrega` |
| `application {job_id, participation_id}` | `/candidato/postulaciones?postulacion={participation_id}` |
| `assessment {invitation_id}` | `/candidato/evaluaciones/{invitation_id}` |
| member preferences | `/empresa/configuracion/notificaciones` |
| candidate preferences | `/candidato/configuracion/notificaciones` |
| unsubscribe landing (`unsubscribe_url`) | `/notificaciones/baja?token={token}` |
| one-click (`NOTIFICATIONS_UNSUBSCRIBE_URL`) | `/api/notificaciones/baja` (`?token={token}` appended by the backend) |

## Q4 — one-click origin

Frontend origin (one public domain in emails). `/api/notificaciones/baja` is a route handler that accepts only POST,
forwards the token and the body to `POST /v2/notifications/unsubscribe` and answers 200 / the backend's status, with no
cookies, session or same-origin check (mail providers post cross-site). The landing page only calls the backend GET and
confirms through a server action, so a link scanner's GET never unsubscribes anyone. Both paths get `no-store` and
`Referrer-Policy: no-referrer`.

## Templates

| # | Subject | Heading | Body line | Button |
| --- | --- | --- | --- | --- |
| T1 | Nueva postulación en {{job_title}} | Nueva postulación en {{job_title}} | Recibiste una postulación nueva el {{date_local}}. | Ver candidatos |
| T2 | {{count}} postulaciones nuevas en {{job_title}} | {{count}} postulaciones nuevas en {{job_title}} | Llegaron {{count}} postulaciones nuevas el {{date_local}}. | Ver candidatos |
| T3 | Prueba psicométrica completada en {{job_title}} | Prueba psicométrica completada | Un candidato de {{job_title}} terminó su prueba psicométrica. | Ver resultado |
| T4 | {{count}} pruebas psicométricas completadas en {{job_title}} | {{count}} pruebas psicométricas completadas | {{count}} candidatos de {{job_title}} terminaron su prueba psicométrica. | Ver candidatos |
| T5 | Prueba psicométrica pendiente en {{job_title}} | Prueba psicométrica pendiente | Se envió una prueba psicométrica a un candidato de {{job_title}} y aún no la responde. | Ver candidato |
| T6 | {{count}} pruebas psicométricas pendientes en {{job_title}} | {{count}} pruebas psicométricas pendientes | Se enviaron {{count}} pruebas psicométricas a candidatos de {{job_title}} y aún no las responden. | Ver candidatos |
| T7 | La entrega de {{job_title}} vence pronto | La entrega vence pronto | La fecha compromiso de {{job_title}} es el {{commitment_date_local}}. | Ver entrega |
| T8 🔒 | La entrega de {{job_title}} está vencida | La entrega está vencida | La fecha compromiso de {{job_title}} era el {{commitment_date_local}}. | Ver entrega |
| T9 | Tu fecha límite en {{job_title}} se acerca | Tu fecha límite se acerca | Como {{function}} de {{job_title}}, tu entrega vence el {{commitment_date_local}}. | Ver entrega |
| T10 🔒 | Venció tu fecha límite en {{job_title}} | Venció tu fecha límite | Tu entrega como {{function}} de {{job_title}} era el {{commitment_date_local}}. | Ver entrega |
| T11 🔒 | Te asignaron {{job_title}} | Te asignaron una vacante | Ahora eres responsable de {{job_title}} en {{company_name}}. | Abrir vacante |
| T12 🔒 | Ahora eres responsable de {{job_title}} | Te reasignaron una vacante | Ahora eres responsable de {{job_title}}. Motivo: {{reason}}. | Abrir vacante |
| T13 🔒 | Ya no eres responsable de {{job_title}} | Se reasignó una vacante | Otra persona quedó a cargo de {{job_title}}. Motivo: {{reason}}. | Ir a PeopleFlow |
| T14 🔒 | Te agregaron al equipo de {{job_title}} | Te agregaron a un equipo | Formas parte del equipo de {{job_title}} como {{function}}. | Abrir vacante |
| T15 | Tu postulación a {{job_title}} cambió de estado | Tu postulación ahora está «{{status}}» | {{company_name}} actualizó tu proceso para {{job_title}}. | Ver postulación |
| T16 | {{company_name}} te dejó un mensaje | Tienes un mensaje sobre tu postulación | {{company_name}} te escribió sobre {{job_title}}. Por privacidad no lo incluimos aquí; léelo en PeopleFlow. | Leer mensaje |
| T17 | Tienes una prueba psicométrica pendiente | Tienes una prueba pendiente | {{company_name}} te envió una prueba psicométrica para {{job_title}}. | Empezar prueba |

Footers:

- **F1** (non-mandatory): «Recibes este correo porque este aviso está activado en tus preferencias.» — links «Mis
  preferencias» (`preferences_url`) · «Dejar de recibir este tipo de correo» (`unsubscribe_url`).
- **F2** (mandatory): «Este aviso es obligatorio y no se puede desactivar.» — link «Mis preferencias»
  (`preferences_url`).

Enum labels:

- `function`: responsible «responsable», collaborator «colaborador», member «integrante».
- `reason`: workload «carga de trabajo», recruiter_departure «salida del reclutador», performance «desempeño»,
  client_request «solicitud del cliente», other «otro motivo».
- `status`: submitted «Enviada», in_process «En proceso», closed «Cerrada».
- `job_title` null → «una vacante»; `company_name` null → «una empresa».
