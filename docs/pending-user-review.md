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

> **2026-10-21:** el usuario aprobó integrar todo el stack (ítems 1–3: motivo de cierre y CV obligatorio, ingreso manual de candidatos, perfil armonizado H1–H5): «Si hermano, adelante, coordina con el frontend para verificar que no haga falta ninguna prueba de nada, para que los dos hagan merge de todo, borren los worktrees que crearon (excepto este y el del agente del frontend) y yo pueda hacer push.» Verificado antes por el agente en Chromium contra cada binario del backend (claro, oscuro y celular), con los ajustes de marco, navbar y perfil que pediste. Merge `446bf21` (backend `feat/profile-harmonization` e242591 + frontend `feat/profile-harmonization-ui` 7868c18), llevado a `main` local por fast-forward; el push lo hace el usuario. Suites sobre ese commit: frontend vitest 6477/6477, tsc OK y `next build` OK (con `NEXTAUTH_URL` https: en producción la guardia de `src/lib/auth/env.ts` rechaza `http://localhost`); backend build, vet, archguard, `go test ./...` e integración `-race` en verde (solo las 2 pruebas de entorno conocidas que necesitan su propia base con CREATEDB). En la base local: `make db-migrate` (00035–00043). Pendientes menores postergados: usuario de ejemplo en el menú lateral de empresa («Tomás Ríos · Nexo Labs»), filas de ejemplo mezcladas en la lista de vacantes autenticada, teléfono del perfil orgánico sin validar y la tarjeta «Habilidades» del perfil (etiqueta repetida, sin ayuda).

1. **Pendientes menores** (paso 87 de `docs/employer-manual-test.md`): frontend
   `feat/frontend-followups`, backend `fix/profile-phone-validation`. Cuenta real en el menú de
   empresa, lista de vacantes sin filas de ejemplo, teléfono E.164 en el perfil, tarjeta
   «Habilidades», combobox de idioma/ubicación que ya no queda vacío y avatar legible en oscuro.

2. **Equipo real y candidatos de mi organización** (paso 88 de `docs/employer-manual-test.md`):
   frontend `feat/team-and-org-candidates-ui`, backend `feat/org-candidates`. Incluye el acceso
   de empresa (sin sesión va al login y vuelve a la página pedida) y el arreglo del aviso de
   error tras un ingreso correcto con Cognito.

**Cognito (S3):** resuelto en código el acceso de «Crear cuenta» al formulario de
registro, conservando la transacción NextAuth y sus parámetros. Pendiente de
verificación real en el navegador. **Acción del usuario en la consola de AWS:**
agregar las dos Allowed sign-out URLs y habilitar self sign-up si no lo está;
seguir el paso 89 de `docs/employer-manual-test.md` y comprobar registro y cierre
de sesión de candidato y empresa.

Pendientes postergados que siguen abiertos: invitar miembros por correo (no hay endpoint); el backend permite degradar o quitar al último dueño (la UI lo evita); el dashboard de empresa
(«Vacantes activas») y el respaldo del tablero todavía usan vacantes de ejemplo; el teléfono del
formulario de postulación heredado sigue como texto libre (5–30 caracteres) hasta tener el
control de lada; filtros Estado/Municipio del tablero con una postulación nueva; ver como
candidato «Vacante cerrada»; un test inestable con la suite completa (draft-save-flow).

Cuando el usuario pruebe un ítem, sus comentarios se anotan en el documento de la
feature (`odd/tasks/…`) y el ítem sale de esta lista al integrarse.

> Ítems 1–9 aprobados por el usuario el 2026-10-18 («todo esta bien, me gusta, aprobado») e integrados en `main` local por fast-forward (d5cce32). El problema de «Crear cuenta» de candidato quedó resuelto en código (S3); la configuración de Cognito y la comprobación real están en el paso 89 de `docs/employer-manual-test.md`.
