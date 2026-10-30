# Candidate account assessments (T11)

`/candidato/postulaciones` and the dashboard load `/v2/me/assessments` through `loadWorkspaceAssessmentsAction` after client mount (with the installed Spinner while pending), never during Server Component render: session refresh writes cookies. The action runs on the server, preserving the backend's latest-only ordering. The live applications workspace joins `application_id` to the real application id, with vacancy identity checked as well. Manual-intake invitations (`application_id: null`) render separately. Pagination and accent-insensitive role/company search remain local to the existing live applications workspace.

## Applications inbox (R6 / S3)

«Mis postulaciones» uses compact identity rows, a selected desktop record (lg+), and a controlled full-screen Dialog below lg. Normal row/title/chip activation selects the record; a modified title click retains the public vacancy link. Closing mobile detail restores focus to the exact row or chip. Segmented filters count loaded applications only: Todas, Por atender (created/in_progress and expires_at strictly later than now), En proceso (in_process), Cerradas (closed). Search intersects the filter, not its counters. Manual-intake assessments stay separate and do not enter application counts.

The application badge reads Enviada / En proceso / Cerrada; an active application whose vacancy closed still reads Vacante cerrada. Candidate-facing messages render as plain text only for closed applications. No extra statuses, unread messages, results or endpoints were added.

Dates are deliberately limited to the real projection: applied_at → Postulaste, assessment created_at → Recibiste una evaluación, finished_at → Evaluación enviada. The deadline remains Disponible hasta in the assessment. Events sort newest first. The API exposes no application updated_at/moved_at/closed_at or assessment started_at: those events are omitted and the row honestly says «Postulada hace …», not «Actualizada». Vacancy ids are required by the current contract; the historical-no-link fallback is defensive and adds no nullable field.

The chosen artboard is composed, not copied: Card/content-only compact rows (density through --card-spacing), Avatar initials, semantic Badge, segmented ToggleGroup with Badge counters, InputGroup search, outline assessment Item with Progress and Link/buttonVariants, and Dialog Header/Title/Description → one scrolling body → Footer. The controlled modal has no Trigger because either a row or chip opens it; full-screen geometry is the chosen mobile design. Filters keep native geometry and horizontally scroll on narrow screens rather than shrink controls. Shared primitives and the route stay unchanged.

Dashboard still consumes frozen prototype application/profile fixtures. Its real `Pendientes` block is independent: assessments never enter prototype objects, metrics or messages. It disappears when no invitation is answerable. No history block is rendered (L36).

`/candidato/evaluaciones/[iid]` remains inside the candidate shell, with noindex metadata. It reuses `AssessmentFlow`, resolving the current session server-side for every read/write. Account 404s and closed writes render the neutral `Ya no está disponible`; closed invitations never load items. Scores/results are neither requested nor rendered.

Application assessment Items use a single-column grid for status → full wrapping details/date → action. This avoids the wrapped-flex column interaction with ItemHeader's `basis-full`; descriptions are not line-clamped. In-progress status includes the saved count: `En curso · n de 63` (using the invitation's actual total).

## shadcn composition audit

| Surface | Official local reference | Composition |
| --- | --- | --- |
| Pending group / standalone invitation | `card.md`, card-demo | Card → Header (Title, Description, Action where needed) → Content |
| Assessment within an application | `item.md`, item-demo | Item outline → Header (Title, Badge) → Content (Description) → Actions; no nested Card |
| Pending task | `item.md`, item-demo | ItemGroup → Item → Media, Content (Title, Description), Actions |
| Navigation | `button.md`, As Link | Link + buttonVariants, not a Button with link role |
| Status | `badge.md` + product semantic variants | accent/success/neutral; no review tone |
| Resume progress | installed Progress reused from candidate flow | answered_count / total_count, no score |

Read/error states use the shared StateCard. No new dependencies or primitives. R6 browser evidence is captured with the existing candidate session at 1440×900 and 390×844 under `/tmp/t12qa/r6/`; the mobile record opens full-screen and returns to the inbox. jsdom cannot establish visual fidelity.
