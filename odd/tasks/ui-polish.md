# UI polish pass (frontend)
Presentation-only redesign pass, starting with the pipeline board and the candidate sheet, then the rest of the app; no backend or contract changes.
Branch feat/ui-polish stacked on feat/pipeline-discard-ui (c5886f1). Rules: docs/frontend-ui-design-rules.md (§14 added in this pass).

## Specs
- S1. User request (L1): «la ui es y debe ser algo que este SUMAMENTE PULIDO, a nivel de ux/ui debe estar todo pensado» — identify the differences against the references, design the plan, add what is needed to the system design and continue.
- S2. User decisions (L2): «Inter en todo» (Clash Display only for the landing); v0: «Yo genero el v0 pero tu me das el prompt … el prompt debe tener las reglas de diseno necesarias, la paleta de colores, las reglas de ux/ui y todo lo que consideres que debe saber v0»; scope «Solo presentación».

## Tasks
- T1 [done] S1,S2 | parent | Typography: Inter for app headings; Clash Display landing-only; rules §14. | commit: ceed4b6
- T2 [done] S2 | parent | v0 prompt for board + candidate sheet. | commit: (this doc commit)
- T3 [pending] S1 | parent/writer | Board redesign from the v0 reference (header with compact coverage, columns, cards, empty columns). | commit: -
- T4 [pending] S1 | parent/writer | Candidate sheet redesign (identity header, tabs, label/value grid, file card, timeline). | commit: -
- T5 [pending] S1 | parent | Pass over the remaining screens, one reviewable delivery each. | commit: -

## Log
- L1. User (2026-10-17): asked to polish the UI starting with the kanban board; compared our board and candidate sheet with two kanban references and their production recruiting sheet; dislikes the display heading font inside the app; asked whether v0 is worth using.
- L2. Answers: Inter everywhere in the app; user generates in v0 from a prompt we write; presentation only.
- L3. Diagnosis — board: coverage shows «0 de 1» next to «Cobertura completa alcanzada» (historic milestone read as current); first column clipped at the left edge; column name repeated as a badge; four identical tall empty states; card name wraps to 3 lines, no initials avatar, «cv» lowercase without type, persistent «Candidato descartado» notice inside the card; no toolbar; stacked page header with a loose gear. Sheet: no identity header (actions at the bottom, two close affordances); one long scroll without tabs; prose instead of a label/value grid; CV as an underlined link; flat history without timeline marks or actors; «Etapa: Descartados» plus a duplicate badge; Clash Display section titles.
- L4. Parent: full frontend suite exposed stack regressions outside the focused runs — requestPath guard did not list the cut-4 recruiter CV boundary (registered with the same server-only/no-store/redirect-error guards) and the applications route test still expected «Postulación enviada» (now «Enviada»); fixed in cdf1008. Remaining full-suite failures pass alone (known timeouts: benefits-section, local-draft-form; board focus restore and cv-workspace pass alone).
