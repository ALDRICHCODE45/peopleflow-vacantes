# Pendientes de revisión en el navegador (frontend)

Lo que el usuario tiene que probar cuando vuelva a su máquina. Mientras tanto se sigue
implementando sobre ramas apiladas: **nada de esta lista está integrado en `main`**.
Se prueba en orden y se integra de arriba hacia abajo.

Cómo levantar todo: `docs/employer-manual-test.md` (secciones 1 a 3). En cada ítem,
el backend va en su rama indicada, con `make db-migrate`.


> **2026-10-19:** el usuario aprobó los ítems 1–5 («Sí, integrar los 5 ítems a main»): filtros del tablero, confirmaciones, Sheet de subestados, corte 7 y filtros por respuestas y perfil. Integrados al `main` local (fd637db) junto con las filas 10–11 del backend; el push lo hace el usuario.

> **2026-10-19:** el usuario aprobó la barra de filtros en una sola fila («aprovado, me gusta. merge por favor»), integrada al `main` local por fast-forward (fe5c39d).

> **2026-10-20:** el usuario aprobó integrar el stack de geografía y el formulario de vacante rediseñado (ítems 1–6, filas 12–16 del backend): «pero eso ya lo revisaste tu no? y la mayoria tambien ya lo revise. adelante, integrar todo y yo hago push.» Revisado antes en Chromium por el agente (QA de empresa y candidato, con los arreglos 564ea9b, 8bb9ca5, 60137af, c565f7c, 4ffcd4d y 3e2c28f). Integrado al `main` local por fast-forward (81a4f83); el push lo hace el usuario. En la base local hay que correr, desde `backend/`, `make db-migrate` (00030–00033) y `DATABASE_URL=<la de backend/.env> make geo-import`. Pendientes menores postergados por el usuario: filtros Estado/Municipio del tablero con una postulación nueva, URLs de cierre de sesión en Cognito y dos tests inestables con la suite completa.

> **2026-10-21:** el usuario aprobó el ciclo de vida de la vacante y los conteos de la lista (filas 17–18): «Si hermano, adelante. merge y yo hago push.» Verificado antes por el agente en Chromium (claro, oscuro y móvil) contra el backend real. Integrado al `main` local por fast-forward desde `integrate/vacancy-lifecycle`; el push lo hace el usuario. Suites: frontend tsc OK y 6128/6128; backend build/vet/test OK y `-race` de integración en verde. En la base local: `make db-migrate` (00034). Pendientes menores postergados: ver como candidato «Vacante cerrada», filtros Estado/Municipio del tablero con una postulación nueva, URLs de cierre de sesión en Cognito, usuario de ejemplo en el menú lateral («Tomás Ríos · Nexo Labs») y un test inestable con la suite completa (draft-save-flow).

> **2026-10-21:** el usuario aprobó el filtro de salario en la búsqueda pública (SAL-5…SAL-8): «2. Si, por favor.» Verificado antes por el agente en Chromium contra el backend real (escritorio, celular, claro y oscuro) y auditado contra `docs/frontend-ui-design-rules.md`; arreglos 51cf893 (chip dentro de «Filtros activos», moneda con código, listas que no cortan opciones largas). Integrado al `main` local por fast-forward desde `integrate/public-salary-filters` (backend `feat/public-salary-filters` acd89d8, sin migración); el push lo hace el usuario.

1. **Motivo de cierre, fecha de publicación y CV obligatorio (corte A)** — frontend `feat/intake-prep-ui`, backend `feat/intake-prep` (4848e8a, migración 00035). Guía: paso 84 de `docs/employer-manual-test.md`. Revisado por el agente en Chromium contra el backend real (claro, oscuro y celular) con 7 arreglos de diseño; ver L10 en `odd/tasks/recruiter-manual-intake-ui.md`.

Cuando el usuario pruebe un ítem, sus comentarios se anotan en el documento de la
feature (`odd/tasks/…`) y el ítem sale de esta lista al integrarse.

> Ítems 1–9 aprobados por el usuario el 2026-10-18 («todo esta bien, me gusta, aprobado») e integrados en `main` local por fast-forward (d5cce32). Problema conocido: «Crear cuenta» de candidato cae en el login de Cognito (pendiente).
