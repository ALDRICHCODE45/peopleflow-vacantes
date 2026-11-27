# Notifications (company inbox, stage 1)

Contract: backend `docs/contracts/notifications-v1.md`, agreed at commit 80a5ce80 (read side N4: list + unread count;
writes and facets N5, backend 89a63897).
Spec and decisions: `odd/tasks/notifications-system.md` (S6, L10–L13).

- `model.ts` — Zod decoders and types: the 14 known types, grouped item, link (unknown kind → `null`), page,
  unread count, mark result, facets, error envelope and `NotificationFailure`. Objects strip unknown fields; `type`
  stays an open string (also in facets).
- `client.ts` (server only) — `listNotifications` (`GET /v2/me/company/notifications`, `state`, `types`, `job_ids`,
  `cursor`, `limit` 1–50, default 20), `getUnreadCount` (`…/unread-count`), `markRead` / `markUnread`
  (`POST …/read` / `…/unread`), `markAllRead` (`POST …/read-all`) and `getFacets` (`GET …/facets?state=unread|all`).
  Input is validated before any request. POSTs send JSON with the Bearer token, `redirect: "error"`, expect `200`.
- `failure.ts` — maps client failures to reasons; only status and allowlisted codes cross, never the backend message.
- `actions.ts` — server actions with the session token; no token → `unauthenticated` without a request.
- `use-unread-count.ts` — bell counter hook.

Polling rule: read on mount, every 30 s (`POLL_INTERVAL_MS`) while the tab is visible, paused while hidden, read
immediately when the tab becomes visible or the window gets focus. A failed read keeps the last value; `unauthenticated`
or `forbidden` stops polling; stale responses are ignored. The inbox can push a fresher value with `set(n)`.

## Read / unread / read-all / facets (T3.5)

- `markReadAction(target)` — `target` is exactly one of `{ groupKeys }` (1–100) or `{ ids }` (1–200); sent as
  `{group_keys}` / `{ids}`.
- `markUnreadAction(target)` — same, plus `{ markedAt }` sent as `{marked_at}`: «Deshacer» passes the `marked_at` of the
  mark it reverts and the backend reverts exactly that batch.
- `markAllReadAction({ types?, jobIds?, before? })` — sent as `{types, job_ids, before}`; an empty list is omitted, never
  sent (the backend refuses it); `{}` marks everything up to now. Attention items are included.
- All three answer `{affected_notifications, affected_groups, marked_at, unread_count, unread_notifications}`; the inbox
  can push `unread_count` into the bell with `set(n)`.
- `getFacetsAction(state = "unread")` — `{state, types[{type, count}], jobs[{job_id, title|null, count}] ≤ 50, jobs_total}`;
  ignores other filters.

Failure reasons for writes:

- `validation_error` (with `fields[{field, code}]`) — a body refused locally before any request (no selection → `body
  required`; two selections or an unknown key → `body invalid`; `markedAt` on read → `marked_at not_allowed`; empty list →
  `empty`; over the limit → `too_many`; malformed group key, UUID, type or timestamp → `invalid`), or the backend's 400
  `validation_error`. Local fields mirror the backend's names (`body`, `group_keys`, `ids`, `marked_at`, `types`,
  `job_ids`, `before`) and codes (`required`, `invalid`, `not_allowed`, `empty`, `too_many`), sorted by field; backend
  fields outside those sets are dropped. Group keys follow D11: `n:<uuid>` or
  `applications|psychometrics|psychometrics_pending:<job uuid>:<YYYY-MM-DD>` (a real date); the nil UUID is refused.
- `invalid_filter` — an unknown facets `state` (local) or the backend's 400 `invalid_filter`.
- 413 `payload_too_large` and 400 `invalid_request` → `unrecognized_response`: a locally validated body stays far below
  the 64 KiB cap and only carries contract keys, so either answer is a contract break, not a user error.
- 401 → `unauthenticated`, 403 → `forbidden`, 5xx → `server_error`, network/timeout → `no_response`, as for reads.

## UI (`ui/`, `copy.ts`)

- `NotificationBell` sits in the company `SiteHeader` right slot, before the theme toggle; it polls `useUnreadCount()`
  and opens the inbox sheet (design 07 on the 02 sheet base). Every page read or mark pushes `unread_count` into it.
- `notification-inbox.tsx` wires tabs («No leídas» default, «Todas»), the pinned «Requiere atención» section (first page
  only), day sections in America/Mexico_City, «Cargar más» (cursor; `invalid_cursor` reloads page 1) and the states.
- Marks (`use-inbox-marks.ts`): «Marcar como leída» marks one group and keeps the row visible as read until the tab,
  filters or sheet change; opening a row marks its group without delaying navigation; «Marcar todo como leído» sends the
  active filters and `before` = the newest `latest_at` shown (server clock; browser time only for an empty list), then
  offers «Deshacer» through `markUnreadAction({markedAt})`.
- «Filtrar» (`inbox-filter.tsx`): type groups and vacancies with counts from `getFacetsAction` for the current tab,
  applied immediately, at most 20 vacancies. Filter tests use `ui/test-popover.tsx` because the real Base UI popover
  hangs `user.click` in jsdom (same convention as audit-log).
- `copy.ts` is the only place with wording and links per type (contract D24); unknown types read «Nueva notificación».

## Candidate inbox (T3.6)

Contract L14: `GET /v2/me/notifications`, `…/unread-count`, `…/facets`, `POST …/read`, `…/unread`, `…/read-all`, behind
the `/v2/me/applications` gate, same shapes as members. Items carry `company {id, name}` (null when the vacancy can no
longer be resolved; absent on member items); actor null, sample `[]`, attention `[]` / `attention_total` 0; link is
`application` or `assessment`, null when the candidate no longer participates.

- Scope is a closed enum (`NOTIFICATION_SCOPES`: `company` | `candidate`) that `client.ts` maps to a fixed base path;
  any other value is refused before a request. The browser never picks it: `actions.ts` exports a separate fixed set
  per scope (`listCandidateNotificationsAction`, `getCandidateUnreadCountAction`, `markCandidateReadAction`,
  `markCandidateUnreadAction`, `markAllCandidateReadAction`, `getCandidateFacetsAction`), each setting its own scope
  after the caller's input, so a smuggled `scope` key is overwritten.
- 403 `account_required` (no candidate account) / `wrong_role` (company user) → `forbidden`: empty inbox, polling stops.
- UI: `NotificationBell scope="candidate"` provides `NotificationScopeContext` (`ui/scope.tsx`), which picks the action
  set for `useInboxPages`, `useInboxMarks` and the filter. `useUnreadCount(scope)` takes it as an argument.
  `CandidateNotificationBell` mounts it in `CandidateHeader` before the theme toggle, only for a signed-in candidate.
- Candidate inbox = the same sheet without «Filtrar» (design 04 shows no filter), without «Requiere atención» and
  without sample sublists; rows name the company (subtitle or title, per type in `copy.ts`).
- Contract Q4: marking `candidate_message_received` read does not mark the message read; that stays
  `PUT /v2/me/applications/{id}/message-read`, independent.
- T4.3: candidate status rows carry the application status badge of design 04 («Enviada» info, «En proceso» review,
  «Cerrada» neutral; same words as `applicationBadge`), shown only when the row has no urgency badge. The pending-test
  due-date badge of design 04 is not built: the payload has no due date.

## «Mis preferencias» (T4.2, T4.4)

Contract: backend `docs/contracts/notifications-v2.md` (agreed 07bd4d5a), E2 usable locally (L21).

- `getPreferencesAction()` / `updatePreferencesAction(entries, catalog?)` on `/v2/me/company/notifications/preferences`
  (member gate: owner/recruiter/stakeholder) and `getCandidatePreferencesAction()` /
  `updateCandidatePreferencesAction(entries, catalog?)` on `/v2/me/notifications/preferences`; fixed scope per action as for
  the inbox. `client.ts` gains `getPreferences` / `updatePreferences` (`call` now takes `method: "PUT"`), so no new client
  file and no `requestPath` allowlist change.
- GET `{channels, email_deliverable, items[{type, kind, channels{in_app|email: {default, enabled, mandatory_locked}}}]}`:
  members 11 types, candidates 3, both channels each. `type` and `kind` stay open strings; an unknown type is kept and
  shown as «Otro aviso» under «Otros avisos». Mandatory = both channels on and locked; operational = in-app on, email off
  (candidates: email on); nothing is informative yet.
- PUT `{preferences[{type, channel, enabled}]}`, 1–28, atomic, idempotent, answers the full catalog. Checked locally in
  the backend's order and names before any request: `preferences` required|empty|too_many,
  `preferences[i].type|channel|enabled` required|invalid, `preferences[i]` invalid (not an object) | duplicate
  (type, channel). Each entry is rebuilt from the three keys only. `catalog` is the GET answer the entries came from
  (decoded again on the server, ignored if malformed): an entry on a pair it marks `mandatory_locked` is refused as
  `preference_locked` with `lockedTypes` and nothing is sent.
- Failures: 422 `notification_preference_locked` (allowlisted) → `preference_locked` with `lockedTypes` = `data.types`
  (snake_case names only); 400 `validation_error` → `validation_error` with the preference fields above (others dropped;
  `duplicate` joins the codes); 400 `invalid_request` / 413 → `unrecognized_response`; 401, 403 (`forbidden`,
  `company_inactive`, `account_required`, `wrong_role`), 5xx and network as for the inbox.

UI (`ui/notification-preferences.tsx`, design 05):

- Pages `/empresa/configuracion/notificaciones` and `/candidato/configuracion/notificaciones` (crumb «Configuración»).
  Stakeholders: the route is outside `stakeholderRoute`'s allowlist, so the `(empresa)` `EmployerGuard` shows the existing
  «Sección no disponible» before the page mounts (contract Q7) — no redirect, no request.
- Groups: the inbox filter groups for members (Postulaciones, Entregas, Vacantes y equipo, Pruebas), «Tus postulaciones»
  for candidates. Each row: name, one line, switches «En la app» and «Correo» (accessible name «<aviso> <canal>»).
  Locked pairs render on and disabled with the «Obligatoria» badge (per channel from the response; one locked channel
  reads «Obligatoria en la app» / «Obligatoria por correo»). A row with every channel off warns «Con esto no te llegará este
  aviso por ningún medio.»; member rows that differ from the default carry «Tu ajuste · recomendado: …».
- Save: design 05's save bar — «N cambios sin guardar», «Descartar», «Guardar cambios». Saving sends only the changed
  unlocked pairs and renders the PUT answer («Preferencias guardadas»). A failed save keeps the choices for a retry and
  «Descartar» rolls back to the last saved catalog; a 422 lock re-reads the catalog. «Restablecer recomendados» puts every
  unlocked pair back to its `default` in the draft (then save). `email_deliverable: false` shows «No podemos entregar
  correos a tu cuenta…» (no address). Not built from design 05: «Resumen diario», the digest hour and the address line
  (stage 3 / not in the API), the company «Restablecer a lo que define tu empresa» dialog and «Desactivada por tu empresa»
  (no owner rules until stage 3).
- T4.4: the inbox footer always shows «Preferencias» (ghost link, closes the sheet) and the first-use state shows design
  07's «Elegir qué me llega», both to `preferencesHref(scope)`; hidden for a stakeholder (`useCompanyMembershipState`).
  Configuración links to the page: company «Preferencias › Notificaciones» (not for stakeholders) and the candidate
  «Notificaciones › Mis preferencias» row, replacing the inert «Próximamente» switches.

## Email unsubscribe (contract v2 E7, Q3/Q4, L23)

Both paths live on the frontend origin, carry no session, cookie or Authorization, and forward the proxy secret and the
client IP (`X-PF-Proxy-Secret`, `X-PF-Client-IP`, plus the user agent) from `auditForwardHeaders` in
`lib/audit/forward.ts` — the global fetch wrapper only decorates authenticated calls, so `client.ts` adds them itself.

- `client.ts`: `getUnsubscribe({token, incoming})` (`GET /v2/notifications/unsubscribe?token=`, never mutates) and
  `postUnsubscribe({token, incoming, body, contentType})` (same URL, raw body ≤ 1 KiB, default content type
  `application/x-www-form-urlencoded`). Both answer `{type, channel: "email", enabled, company {id, name} | null}`
  (`unsubscribeStateSchema`). A token outside 1–512 characters of `[A-Za-z0-9_.-]` (`isUnsubscribeTokenShape`) is
  refused as an invalid link and a body over 1 KiB as the backend's 413, both without a request. This is the client's
  one direct `fetch` (raw body and Retry-After are beyond the shared JSON transport), listed in `requestPath.test.ts`.
- `failure.ts`: 422 `unsubscribe_link_invalid` (or a malformed token) → `unsubscribe_link_invalid`; 429 → `rate_limited`
  with `retryAfter` only when it is delta seconds or an IMF date; both codes are allowlisted. 413 stays
  `unrecognized_response` with `reference.status` 413.
- One-click target `app/api/notificaciones/baja/route.ts` (RFC 8058, mail providers POST cross-site): POST only, other
  methods 405 (`Allow: POST`); no Origin or `sec-fetch-site` check. Answers 200 `{ok: true}`, 422
  `{code: "unsubscribe_link_invalid"}`, 429 `{code: "rate_limited"}` with Retry-After, 413
  `{code: "payload_too_large"}` (oversized bodies never reach the API), 502 `{code: "unavailable"}` for 5xx / network;
  never the token or the backend body. Every answer: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`.
- Landing `/notificaciones/baja?token=` (`ui/unsubscribe-page.tsx` server side, `ui/unsubscribe-landing.tsx` client,
  wording in `unsubscribe-copy.ts`): the GET shows «Dejar de recibir por correo: {tipo}» (+ « de {empresa}») with the
  «Mis preferencias» type titles; «Dejar de recibir» runs an inline Server Action (token kept in the encrypted closure)
  that sends the one-click body to the backend POST. Outcomes: success «Listo. Ya no recibirás este tipo de correo.»,
  already off «Ya no recibes este tipo de correo.» (both link «Ajustar mis preferencias» to the company page when the
  link has a company, otherwise the candidate page), invalid «Este enlace ya no es válido.» with both preferences links,
  429 «Demasiados intentos. Inténtalo en unos minutos.», 5xx / network a generic «Reintentar» (page refresh, still GET).
  A failed confirm keeps the button for a retry. `middleware.ts` sends the page with no-referrer and no-store.
- Production requirement: `AUDIT_PROXY_SECRET` (and the right `AUDIT_TRUSTED_PROXY_HOPS`) must be set; without the
  secret no client IP reaches the backend and its per-IP invalid-token limiter would see the BFF address for everyone.
  With several instances, set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` so the landing's confirm action works across them.
