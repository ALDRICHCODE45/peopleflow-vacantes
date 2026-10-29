# Perfil psicométrico de la vacante

`VacancyPsychometricsModule({ draftId })` loads the agreed profile and current pipeline on mount. It uses the existing psychometrics actions/model/client; the client owns the GET/PUT and opaque `If-Match` header. The pipeline's `stages` contains only current progression stages; `exit` and `retired` are never options.

- Evaluation defaults to off. Enablement and confirmation are independent.
- No relevante asks for no band, rationale or task. Switching to it clears all three values to null. Switching back to relevant initializes an empty rationale and a middle band (never assumes high). Clave and Importante require a rationale to confirm; only Clave requires a task. Drafts may remain incomplete.
- Changing requirements clears confirmation until an explicit confirmation save. Server confirmation dates are displayed in Mexico City time.
- No vacancy-to-competency inference rules exist in the content specification. Sugerir desde la vacante preserves the current draft and explains this; it never invents requirements.
- Save errors preserve input. Conflicts / missing preconditions require an explicit read. Uncertain writes offer Comprobar, never automatically replay PUT. Process-finished rejection locks writes.
- Profile changes affect future results only, not prior result/comparison snapshots.

## Official shadcn composition audit

Read references: `docs/design/shadcn-reference/`.

| Component | Official example / composition | Adaptation |
|---|---|---|
| Card | basic Header → Title, Description, Action; Content; Footer | Heading inside title; accent status in Action |
| Field | FieldSet → Legend, Description, FieldGroup → Field | Seven competency groups; justification per relevant competency is required by the wire contract, expanding the artboard's single justification |
| Select | basic Trigger → Value; Content → Group → Item | Trigger-edge popup placement; disabled band for No relevante |
| InputGroup | InputGroup → InputGroupInput | Optional addons omitted |
| Textarea | Field → Label, Textarea, Error | Relevant competency justification |
| Switch | horizontal Field → Switch, Label | Evaluation enabled |
| Checkbox | horizontal Field → Checkbox, Label | Current progression stages only |
| Badge | basic semantic variant | accent, never review |
| Button / Spinner | basic / inline-start spinner | Real pending save only |
| Skeleton | card/form placeholders | Mirrors header, seven groups, stage/expiration area and footer |

Sileo uses the global `notifyActionResult` and persistent `ActionBar` / `ActionStatus`, no local toaster.

## Verification pending

Browser comparison against `design/psychometric-flows/01-perfil-del-puesto.html`, mobile, long labels and light/dark mode remains parent-owned. Select interaction tests now run without skips using the controlled Select test boundary from `delivery-config/editor.test.tsx`. They exercise the real profile handlers and saved bodies; Base UI popup positioning and keyboard behavior still require browser verification. Removing only positioning while retaining Popup was also attempted, but Base UI requires Positioner context. Do not treat jsdom as visual approval.
