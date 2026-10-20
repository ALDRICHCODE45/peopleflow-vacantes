# Pendientes de revisión en el navegador (frontend)

Lo que el usuario tiene que probar cuando vuelva a su máquina. Mientras tanto se sigue
implementando sobre ramas apiladas: **nada de esta lista está integrado en `main`**.
Se prueba en orden y se integra de arriba hacia abajo.

Cómo levantar todo: `docs/employer-manual-test.md` (secciones 1 a 3). En cada ítem,
el backend va en su rama indicada, con `make db-migrate`.


> **2026-10-19:** el usuario aprobó los ítems 1–5 («Sí, integrar los 5 ítems a main»): filtros del tablero, confirmaciones, Sheet de subestados, corte 7 y filtros por respuestas y perfil. Integrados al `main` local (fd637db) junto con las filas 10–11 del backend; el push lo hace el usuario.

> **2026-10-19:** el usuario aprobó la barra de filtros en una sola fila («aprovado, me gusta. merge por favor»), integrada al `main` local por fast-forward (fe5c39d).

| # | Feature | Rama frontend | Rama backend | Pasos de la guía | Qué mirar especialmente |
| --- | --- | --- | --- | --- | --- |
| 1 | Ubicación estructurada: catálogo (países, estados, municipios, CP) + campo compartido + vacante (ubicación, alcance remoto, faltantes para publicar, tarjeta y detalle públicos) | `feat/geo-vacancy-ui` (sobre `main`; incluye `feat/geo-location-field-ui`) | `feat/geo-vacancy` (filas 12–13; `make db-migrate` + `DATABASE_URL=… make geo-import`) | 76 | Decisiones a revisar: CP que precarga sin bloquear; aviso al borrar el CP; textos del alcance remoto. Riesgo: tests del editor más lentos (timeouts solo con la suite completa). |
| 2 | Ubicación del candidato (perfil real conectado al backend: perfil + idiomas con un solo «Guardar perfil») y de la empresa (opcional al crear + «Editar ubicación» del dueño) | `feat/geo-profiles-ui` (sobre la rama anterior) | `feat/geo-profiles` (fila 14; `make db-migrate`) | 77 | Decisiones a revisar: avisos de guardado parcial del perfil; «Agregar/Quitar ubicación»; el perfil ya no es un prototipo local. |
| 3 | Bloqueo de postulación por país (aviso previo + error del servidor) y filtros del tablero por «Estado»/«Municipio» | `feat/geo-apply-ui` (sobre la rama anterior) | `feat/geo-apply` (fila 15; `make db-migrate`) | 78 | Decisiones a revisar: aviso antes de enviar y botón deshabilitado; municipio con su estado en el filtro. Nota: el asistente prototipo de postulación sigue accesible para vacantes legacy. |

Cuando el usuario pruebe un ítem, sus comentarios se anotan en el documento de la
feature (`odd/tasks/…`) y el ítem sale de esta lista al integrarse.

> Ítems 1–9 aprobados por el usuario el 2026-10-18 («todo esta bien, me gusta, aprobado») e integrados en `main` local por fast-forward (d5cce32). Problema conocido: «Crear cuenta» de candidato cae en el login de Cognito (pendiente).
