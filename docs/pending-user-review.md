# Pendientes de revisión en el navegador (frontend)

Lo que el usuario tiene que probar cuando vuelva a su máquina. Mientras tanto se sigue
implementando sobre ramas apiladas: **nada de esta lista está integrado en `main`**.
Se prueba en orden y se integra de arriba hacia abajo.

Cómo levantar todo: `docs/employer-manual-test.md` (secciones 1 a 3). En cada ítem,
el backend va en su rama indicada, con `make db-migrate`.

| # | Feature | Rama frontend | Rama backend | Pasos de la guía | Qué mirar especialmente |
| --- | --- | --- | --- | --- | --- |
| 1 | Publicación P1: «Solicitud», «Publicar», faltantes, confirmación, vacante «Activa» | `feat/vacancy-publication-ui` (sobre `main`) | `feat/vacancy-publication` (migraciones 00018, 00019) | 29–33 | El diálogo de «Publicar» (faltantes agrupados con «Completar», resumen), la fila «Activa» y el tablero vacío; claro/oscuro; probar con un borrador de prueba porque publicar no se deshace. También el footer compacto del editor de borradores (paso 4). |
| 2 | Publicación P2a: sitio público con vacantes publicadas, detalle con formato, aviso de vacante publicada incompleta | `feat/vacancy-public-ui` (sobre el ítem 1) | `feat/vacancy-public` (migración 00020) | 34–36 | Decisiones visuales a revisar: texto del encabezado de /vacantes; etiquetas visibles en la búsqueda; cuatro filtros rápidos; nota de exclusión del catálogo anterior; tarjetas unificadas con grilla de datos, fecha y salario (sin extracto de descripción porque v2 no lo trae); avatar de empresa con ícono; se quitaron conteos, «verificada», fechas relativas y datos inventados; detalle con secciones Requisitos/Beneficios y riel lateral solo si hay salario o acción; **sin botón «Postularme» en vacantes publicadas hasta P2b** (en vez de «Disponible pronto»). |

Cuando el usuario pruebe un ítem, sus comentarios se anotan en el documento de la
feature (`odd/tasks/…`) y el ítem sale de esta lista al integrarse.
