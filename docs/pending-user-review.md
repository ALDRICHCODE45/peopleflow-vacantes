# Pendientes de revisión en el navegador (frontend)

Lo que el usuario tiene que probar cuando vuelva a su máquina. Mientras tanto se sigue
implementando sobre ramas apiladas: **nada de esta lista está integrado en `main`**.
Se prueba en orden y se integra de arriba hacia abajo.

Cómo levantar todo: `docs/employer-manual-test.md` (secciones 1 a 3). En cada ítem,
el backend va en su rama indicada, con `make db-migrate`.


> **2026-10-19:** el usuario aprobó los ítems 1–5 («Sí, integrar los 5 ítems a main»): filtros del tablero, confirmaciones, Sheet de subestados, corte 7 y filtros por respuestas y perfil. Integrados al `main` local (fd637db) junto con las filas 10–11 del backend; el push lo hace el usuario.

> **2026-10-19:** el usuario aprobó la barra de filtros en una sola fila («aprovado, me gusta. merge por favor»), integrada al `main` local por fast-forward (fe5c39d).

> **Stack de geografía (ítems 1–4):** para probar todo junto, frontend en `feat/geo-search-ui` y backend en `feat/geo-search`; desde `backend/`: `make db-migrate` (00030–00033) y `DATABASE_URL=<la de backend/.env> make geo-import` (el importador no lee el `.env`). Las ubicaciones de texto de los datos de prueba desaparecen: las vacantes publicadas quedan sin ubicación hasta editarlas y las postulaciones viejas muestran «Sin dato». Pasos de la guía 76–79.

| # | Feature | Rama frontend | Rama backend | Pasos de la guía | Qué mirar especialmente |
| --- | --- | --- | --- | --- | --- |
| 1 | Ubicación estructurada: catálogo (países, estados, municipios, CP) + campo compartido + vacante (ubicación, alcance remoto, faltantes para publicar, tarjeta y detalle públicos) | `feat/geo-vacancy-ui` (sobre `main`; incluye `feat/geo-location-field-ui`) | `feat/geo-vacancy` (filas 12–13; `make db-migrate` + `DATABASE_URL=… make geo-import`) | 76 | Decisiones a revisar: CP que precarga sin bloquear; aviso al borrar el CP; textos del alcance remoto. Riesgo: tests del editor más lentos (timeouts solo con la suite completa). |
| 2 | Ubicación del candidato (perfil real conectado al backend: perfil + idiomas con un solo «Guardar perfil») y de la empresa (opcional al crear + «Editar ubicación» del dueño) | `feat/geo-profiles-ui` (sobre la rama anterior) | `feat/geo-profiles` (fila 14; `make db-migrate`) | 77 | Decisiones a revisar: avisos de guardado parcial del perfil; «Agregar/Quitar ubicación»; el perfil ya no es un prototipo local. |
| 3 | Bloqueo de postulación por país (aviso previo + error del servidor) y filtros del tablero por «Estado»/«Municipio» | `feat/geo-apply-ui` (sobre la rama anterior) | `feat/geo-apply` (fila 15; `make db-migrate`) | 78 | Decisiones a revisar: aviso antes de enviar y botón deshabilitado; municipio con su estado en el filtro. Nota: el asistente prototipo de postulación sigue accesible para vacantes legacy. |
| 4 | Búsqueda pública por «Estado», «Municipio», «Modalidad» y «Postulo desde» (reemplaza el texto «ubicación») | `feat/geo-search-ui` (sobre la rama anterior; es la punta del stack geo) | `feat/geo-search` (fila 16; punta del stack backend) | 79 | Decisiones a revisar: municipio que depende de los estados elegidos; ayuda de «Postulo desde». |
| 5 | Perfil del candidato con el diseño validado de `main` (+ crear perfil al primer guardado), campo País que filtra, calendarios con mes/año y tarjetas de estado (`StateCard` con `Empty`) para errores, prohibiciones y vacíos | `feat/geo-search-ui` (misma rama) | `feat/geo-search` | 80 | Decisiones a revisar: textos y acciones de cada tarjeta de estado; diferencias del perfil vs `main` (solo las que exige el guardado real). |
| 6 | Formulario de vacante rediseñado según v0 (navegación libre, «Lista para publicar», vista previa en vivo, barra fija de guardar/publicar, tarjetas por tema, revisión y publicación) | `feat/vacancy-form-redesign-ui` (sobre `feat/geo-search-ui`) | `feat/geo-search` | 81 | Decisiones a revisar: la vista previa en vivo (tu duda); el aviso al salir no cubre el botón «Atrás» del navegador. |

Cuando el usuario pruebe un ítem, sus comentarios se anotan en el documento de la
feature (`odd/tasks/…`) y el ítem sale de esta lista al integrarse.

> Ítems 1–9 aprobados por el usuario el 2026-10-18 («todo esta bien, me gusta, aprobado») e integrados en `main` local por fast-forward (d5cce32). Problema conocido: «Crear cuenta» de candidato cae en el login de Cognito (pendiente).
