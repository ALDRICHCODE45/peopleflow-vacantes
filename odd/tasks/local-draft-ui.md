# Local private draft UI
Add a small local-only editor on the approved T3f model, separate from legacy vacancy creation.
No network persistence, authentication or backend work is included.

## Specs
- S1. User: "Bien, adelante." Then selected the recommended approach: "Lo que recomiendes esta bien hermano." Accepted recommendation: enlace «Nuevo borrador» en Vacantes to `/empresa/vacantes/borradores/nuevo`, preserving the existing creation link.
- S2. Proposed and accepted first unit: "Primero título, ubicación y modalidad, preservando los otros 14 campos."
- S3. "Validar al pulsar «Validar borrador», sin alterar el texto mientras escribís."
- S4. "Aviso explícito: solo local; al salir se pierden los cambios. Sin guardar ni llamar al backend."
- S5. Preserve the approved model/schema source, legacy creation flow and unrelated changes. No commits, staging, dependencies, backend, login/BFF, storage, services or publication in this unit. User owns manual browser verification; no agent service/browser launch.

## Tasks
- U1 [done] S1-S5 | route: bounded worker | Local component/page/entry link implemented; 37 focused, 740 drafts, 2698 full tests and typecheck/lint reported PASS | commit: not authorized.
- U2 [done] S1-S5 | route: independent verifier | Source and 37 focused tests PASS; six hashes unchanged. Manual browser acceptance handed to user, not claimed verified. Native assessment unavailable due untracked scope; no native review closure claimed | commit: not authorized.

## Log
- L5. User: "Lei tu pregunta, pero realmente creo que se pierde mucho tiempo en ese tipo de pruebas, eso lo podemos dejar para mi?? es decir, levanto el servidor, ingreso, lo reviso y te digo?? porque de verdad, he pasado con otros agentes dias y dias en esas pruebas que pudieron haberse resuelto en minutos revisandolas yo mismo. que opinas?"
- L6. Independent verifier muyi7f49-3-mypd: S1-S5 PASS, 37 tests observed, all six candidate hashes match, no material defect. Qualifications: preservation fixture populates six rather than all14 untouched fields (source spread supports preservation); submit event not real keyboard proof; Select adapter does not verify real popup/focus; no browser/visual evidence; page/link no prior RED. Native assessment unassessable due undeclared untracked; no review started or closure claimed. Manual acceptance delegated to user, not an agent blocker requiring more automation.
- L1. User: "Bien, adelante."
- L2. First read-only explorer failed cleanup confirmation; no cleanup or process termination performed. User: "lanzalo otra vez,". Second explorer completed; its report mentions CodeGraph init despite read-only scope. This does not authorize further index/scratch writes.
- L3. Parent recommended separate route with entry link and explicit local validation, no keystroke normalization or additional model abstraction. User: "Lo que recomiendes esta bien hermano."
- L4. Allowed source paths: new frontend/src/features/jobs/drafts/ui/local-draft-form.tsx and local-draft-form.test.tsx; new frontend/src/app/(empresa)/empresa/vacantes/borradores/nuevo/page.tsx and page.test.tsx; existing frontend/src/app/(empresa)/empresa/vacantes/page.tsx and page.test.tsx for additive link and regression tests. Reuse shared primitives and approved schemas/model unchanged. Keep raw strings separate from last valid complete model; explicit validation is atomic for three controls, invalid input remains visible and cannot report a valid current snapshot. Any edit invalidates previous success feedback. Page-local only, no persistence, no fake loading/saving. Tests may provide valid initial model to prove preservation of populated untouched fields; no seeded production fixture or visible test payload required.
