# Recruiter manual intake and preparatory cleanup (backend)

Backend side of two stacked cuts with the frontend (`odd/tasks/recruiter-manual-intake-ui.md` on `feat/intake-prep-ui`):
(A) `feat/intake-prep` from main 4a82437 — resume/reopen date and close reason; (B) `feat/manual-intake` stacked on A.
Overnight mode: nothing to main; merge only on the user's word, push by the user.

## Specs

- **S1** (INT-17). «CV is mandatory for **organic candidate applications as well**. Remove the employer setting that permits applications without CV; it must not remain a configurable exemption.»
- **S2** (VAC-5/7, user). «La vacante reanudada conserva su fecha de publicación original; las pausas quedan en su historial.»
- **S3** (VAC-9, user). Close reason «"Cubierta", "Cancelada" u "Otro" (con texto) en el diálogo de cerrar; se ve en la lista y en el historial.» Mandatory. Rule text: «Closing requires a reason: `Cubierta`, `Cancelada` or `Otro`. `Otro` requires an explanation. `Cubierta` is allowed only when the required positions are filled.»
- **S4** (INT-1/3/6, user). «"Agregar candidato" en el tablero de la vacante; entra en la primera etapa por defecto y se puede elegir otra activa (nunca Placement).» No account, no notification, no candidate-facing entry.
- **S5** (INT-7..11, user). Required: name, education level, contact (email or telephone, both allowed), residence and CV. «País obligatorio; en México estado y municipio obligatorios, CP opcional. Teléfono con lada de país (+52 y 10 dígitos en México). Sin fecha de nacimiento (PRIV-1).» Other profile fields optional.
- **S6** (INT-14, user). «Compara con candidatos que ya pasaron por tu empresa. Avisa antes de guardar: "Usar el existente" o "Es otra persona, crear". Nunca fusiona solo y no revela cuentas de otras empresas.»
- **S7** (user). «Badge de origen en la tarjeta y en la ficha "Agregado por Ana Pérez el 21 oct"; nunca dice "postuló". Sin notificación al candidato (INT-3).» Label «Ingreso manual».
- **S8** (INT-12/16, user). Prefill from CV/LinkedIn/OCC is out of this cut.

## Tasks

- [x] T1 — S1–S3: cut-A contract with the frontend (intercom) — accepted (L3)
- [ ] T2 — S2, S3: migration 00035 (close reason columns + published_at restore, own commit), lifecycle transition/close body/coverage rule, view/history/list keys, docs — pending
- [ ] T3 — S4–S8: cut-B design and contract with the frontend — pending
- [ ] T4 — S4–S8: cut-B backend (stacked branch) — pending

## Log

- **L1.** Frontend relay (intercom 45b40dc6, 2026-10-21): user decisions verbatim in the UI task doc (S1–S10 there); proposals for close body and manual intake routes.
- **L2.** Facts: INT-17 setting does not exist in the backend (UI-only; v2 apply already requires a CV). `lifecycle.go:82` refreshes `published_at` on resume and reopen; the public projection keeps the original. Board `coverage {covered, required}` already exists for the VAC-9 «Cubierta» rule. Cut-A contract sent: keep `process` key, add `reason`/`reason_note`, 422 `close_reason_not_covered` {covered, required}, view/history/list gain reason keys, reopen also keeps the first publication date (DEL-8, REO-1), migration restores existing rows from the projection date.
- **L3.** Frontend accepted cut A in full (intercom 044622eb): reopen also keeps `published_at`; «Cubierta» disabled in UI with «Cubiertas N de M posiciones» / «Esta vacante no tiene un objetivo de posiciones»; 422 shows the same text and reloads; old closes «Sin motivo registrado».
