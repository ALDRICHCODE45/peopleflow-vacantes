# Modern choice and file controls (frontend)

Replace raw native-looking radios, selection checkboxes and file inputs across the app with PeopleFlow patterns, and
write the rule in the design system. Design first (canvas), then implementation in reviewable slices starting with
Documentos.

## Specs

- **S1** User: «algo que no me gusta nada es ocupar los checkboxes asi en "crudo" para seleccionar algo, no me gusta nada
  de nada (y eso tal vez hay que ponerlo en el system design), yo creo que seria mucho mejor otras opciones de ui
  modernas» → choices (single and multiple selection) use modern patterns instead of bare radio/checkbox rows.
- **S2** User: «tambien algo que no me gusta nada son los inputs de tipo imagen que se ven asi, no tienen estilo, son
  genericos, en las paginas del gobierno se ven asi, pero en pf no» → file inputs use a styled PeopleFlow control, never
  the browser's «Browse… No file selected.».
- **S3** The rule goes into `design/system.md` (component rules).
- **S4** Scope: the whole app (user: «Toda la app (Recomendado)»), in reviewable slices starting with Documentos.
- **S5** Design first: «Sí, 2–3 variantes primero» on the canvas before implementation.

## Tasks

| ID | Specs | Task | Commit |
| --- | --- | --- | --- |
| T1 | S1, S2, S4 | Audit every bare radio, selection checkbox and file input in frontend/src | |
| T2 | S1, S2, S5 | Design 2–3 variants (`design/choice-and-file-controls/`) | |
| T3 | S3 | Design system rule after the user picks | |
| T4 | S1, S2, S4 | Implementation slices (Documentos first, then the audit list) | |
| T5 | S1–S4 | Browser check, full suite, merge to main | |

## Log

- **L1** (2026-11-23) User, with a screenshot of the «Subir documento» dialog (radio «La vacante / Una persona candidata»
  and native file input «Browse… No file selected.»), verbatim: «Mira: la verdad, algo que no me gusta nada es ocupar los
  checkboxes asi en "crudo" para seleccionar algo, no me gusta nada de nada (y eso tal vez hay que ponerlo en el system
  design), yo creo que seria mucho mejor otras opciones de ui modernas, tambien algo que no me gusta nada son los inputs de
  tipo imagen que se ven asi, no tienen estilo, son genericos, en las paginas del gobierno se ven asi, pero en pf no, me
  sigues?» Then: «Toda la app (Recomendado)» and «Sí, 2–3 variantes primero».
- **L2** (2026-11-23) T2: tres direcciones en `design/choice-and-file-controls/` (1440×900 y 390×844, claro y oscuro), cada
  una con elección única, múltiple, archivo (vacío, arrastrando, elegido, subiendo, errores, compacta, cola) y dos
  pantallas reales («Subir documento» y «¿A quién reemplaza?»): `01-tarjetas-seleccionables-y-dropzone.html`,
  `02-segmentado-chips-y-franja.html` y `03-lista-con-palomita-y-tarjeta.html`. Ninguna elegida todavía; las otras
  quedan como alternativas hasta que la persona decida (T3 y T4 esperan esa elección).
