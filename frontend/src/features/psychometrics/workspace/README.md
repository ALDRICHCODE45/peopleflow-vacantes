# Candidate account assessments (T11)

`/candidato/postulaciones` and the dashboard load `/v2/me/assessments` through `loadWorkspaceAssessmentsAction` after client mount (with the installed Spinner while pending), never during Server Component render: session refresh writes cookies. The action runs on the server, preserving the backend's latest-only ordering. The live applications workspace joins `application_id` to the real application id, with vacancy identity checked as well. Manual-intake invitations (`application_id: null`) render separately. Pagination and application search remain local to the existing live applications workspace.

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

Read/error states use the shared StateCard. No new dependencies or primitives. Browser comparison at mobile/desktop, dark mode, and against the backend remains pending; jsdom cannot establish visual fidelity.
