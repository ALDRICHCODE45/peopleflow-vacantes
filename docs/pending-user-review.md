# Pendientes de revisión en el navegador (frontend)

Lo que el usuario tiene que probar cuando vuelva a su máquina. Mientras tanto se sigue
implementando sobre ramas apiladas: **nada de esta lista está integrado en `main`**.
Se prueba en orden y se integra de arriba hacia abajo.

Cómo levantar todo: `docs/employer-manual-test.md` (secciones 1 a 3). En cada ítem,
el backend va en su rama indicada, con `make db-migrate`.

| # | Feature | Rama frontend | Rama backend | Pasos de la guía | Qué mirar especialmente |
| --- | --- | --- | --- | --- | --- |
| 1 | Filtros del tablero en un Sheet («Columna», «Subestado», «Motivo de descarte», todos multi-select) con chips removibles, y cobertura + entrega como un solo bloque en el encabezado | `feat/pipeline-board-filters-ui` (sobre `main`) | sin cambios (usar `main`) | 70 | Decisiones a revisar: anatomía compartida de cobertura y entrega; filtros que se aplican al marcar; cantidades por opción sobre todo el tablero. |

Cuando el usuario pruebe un ítem, sus comentarios se anotan en el documento de la
feature (`odd/tasks/…`) y el ítem sale de esta lista al integrarse.

> Ítems 1–9 aprobados por el usuario el 2026-10-18 («todo esta bien, me gusta, aprobado») e integrados en `main` local por fast-forward (d5cce32). Problema conocido: «Crear cuenta» de candidato cae en el login de Cognito (pendiente).
