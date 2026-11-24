# Overnight audit D — company administration and oversight (2026-11-24)

Production :3000 vs dev :8080, owner/recruiter/stakeholder; screenshots `/tmp/audit-D/shots/`. Metrics, dashboard, audit
log filters, stakeholder gating and sign-out are solid.

| id | sev | where | finding | fix |
| --- | --- | --- | --- | --- |
| D1 | blocker | Configuración (`employer-settings/settings-workspace.tsx:79-97,136-141`) | Reclutamiento/Notificaciones switches not persisted; 2FA and «Cambiar contraseña» do nothing | frontend now (disable + «Próximamente»), backend later |
| D2 | major | Equipo | no way to invite a recruiter (only stakeholders) | backend + frontend |
| D3 | major | Configuración → Sitio | publishing needs a logo; company name/industry/logo not editable anywhere (dead end) | backend + frontend |
| D4 | major | Equipo 390 (`stakeholder-invitations/invitations-card.tsx:112-120`) | stakeholder card header overflows | frontend |
| D5 | major | Equipo as recruiter (`employer-team/members-model.ts:21-27`) | «Carga» counts only the viewer's drafts | backend/frontend |
| D6 | major | `/empresa/mi-historial`, unknown `/empresa/*` | Next default English 404, empty sidebar | frontend `not-found.tsx` |
| D7 | major | login | «Ingresar con Cognito»; managed login English, unbranded, offers sign-up | frontend copy; Cognito branding is AWS (on hold) |
| D8 | major | talent visibility mode (`talent-base-visibility-section.tsx:164-171`) | bare radio cards next to ChoiceList | frontend |
| D9 | minor | invitations copy | «Solo ve Métricas» but stakeholders also see Vacantes/Documentos | frontend |
| D10 | minor | invitation accept (`accept-page.tsx:107-108`) | same-company member told «otra empresa» | frontend (+ backend reason) |
| D11 | minor | pending invitations | rows have no recipient/note | backend + frontend |
| D12 | minor | Equipo KPIs | stakeholder not counted; «Dueño»/«Propietario»/«owner» mixed | frontend |
| D13 | minor | «Tu empresa» (`company-section.tsx:152`) | «Registra tu empresa» shown to a registered company | frontend |
| D14 | minor | talent visibility | unsaved changes lost silently | frontend |
| D15 | minor | Auditoría | CSV export enabled without dates then errors; no row detail; «Sin etiqueta»; English CSV headers | frontend + backend |
| D16 | minor | site editor (`careers-site-editor.tsx:243`) | «Aún no está publicado» on a published site; contradictory badges; label overlaps lock | frontend |
| D17 | minor a11y | metrics pipeline badges (`pipeline-section.tsx:102`) | 3.98:1 contrast | design-system |
| D18 | minor | restricted states | three different «no access» layouts; «owner» in copy | frontend |
| D19 | polish | user menu | no «Mi cuenta» | product decision |
| D20 | polish | stakeholder Vacantes | capped tab counts; no way back from Documentos | frontend + backend |
| D21 | product | stakeholder | no read-only pipeline/progress view; no requester catalog screen | product decision |

Data: 2 stakeholder invitation links (revoked), 1 audit CSV export. Site draft palette changed by another audit
(«Fotográfica» → «Centrada», unpublished).
