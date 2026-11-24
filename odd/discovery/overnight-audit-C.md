# Overnight audit C — candidate and public side (2026-11-24)

Production build :3000 vs dev :8080; screenshots `/tmp/audit-C/shots/`. No candidate test account exists (only company
accounts), so logged-in candidate flows were not browser-verified (F18).

| id | sev | where | finding | fix |
| --- | --- | --- | --- | --- |
| F1 | major | `/vacantes/[id]` (`app/(candidato)/vacantes/[jobId]/page.tsx:50-57`) | no og/twitter tags, no JobPosting JSON-LD | frontend |
| F2 | major | detail share (`features/jobs/components/public-share-button.tsx:20`), careers site | copy-link only on desktop; no WhatsApp/email/LinkedIn; no share on the careers site | frontend (share menu) |
| F3 | minor | `/vacantes` | no sort, no result count | frontend + backend `sort` |
| F4 | minor | apply anonymous (`wizard.tsx:212,216`) | card titled «Datos», no «Crear cuenta» | frontend |
| F5 | major a11y | link buttons dark (`components/ui/button.tsx:19`) | «Conoce la empresa» 2.01:1 | design-system (`text-primary-text`) |
| F5b | minor a11y | listing cards (`PublicVacancyCard.tsx:40`) | «y N beneficios más» colour-only link | frontend |
| F6 | minor | apply CV/questions (`cv-picker.tsx:85`, `wizard.tsx:233`) | ToggleGroup instead of ChoiceList (rule) | frontend |
| F7 | major | `/candidato/configuracion` (`settings-workspace.tsx:174,177,186`) | notification switches not persisted, 2FA switch and «Cambiar contraseña» do nothing | product decision + backend |
| F8 | major legal | footers, candidate account | no privacy/terms/cookies pages; no account deletion or data export | product decision + backend |
| F9 | minor | `/vacantes`, `/` titles | «PeopleFlow» titles; candidate description on `/` | frontend |
| F10 | polish | listing chips | «Tiempo completo» among modality chips; no «Presencial» | frontend |
| F11 | major | `/candidatos` showcase (`EmployerLanding.tsx:891-893`) | example cards link to 404 fixture ids | frontend |
| F12 | polish | apply (`wizard.tsx:157`) | «Postulación cargada» toast on every load | frontend |
| F13 | polish | listing 390 | «Ver vacante» not full width / 44 px | frontend |
| F14 | polish | detail desktop | uneven gap/alignment under «Postularme» | frontend |
| F15 | polish | closed/paused detail | only «Ver otras vacantes»; add the company's vacancies | frontend |
| F16 | info | canonical/og:url | 127.0.0.1 vs localhost siteUrl | config |
| F17 | minor | `/vacantes` | no skip link | frontend |
| F18 | coverage | candidate side | no candidate test account | needs the user's OK + email code |
