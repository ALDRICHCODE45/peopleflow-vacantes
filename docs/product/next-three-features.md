# Decisión: las próximas tres funcionalidades

Estado: **definición de producto acordada, no implementado** (2026-11-02). Fuente común para la sesión del frontend,
la del backend y los socios. Los contratos y el modelo de datos los propone la sesión del backend a partir de este
documento.

Contexto: el sistema **no está en producción**; toda la data actual es de desarrollo y **es desechable**. Se aceptan
migraciones que pierdan datos. Nada es urgente por una venta.

## Orden

| # | Funcionalidad | Tamaño | Por qué en este lugar |
| --- | --- | --- | --- |
| 1 | **Asignación de la vacante** (equipo + reasignación) | Mediana | Crea los tramos de asignación de los que dependen las métricas por reclutador. Nace con sus eventos de auditoría. |
| 1b | **Visibilidad de la Base de talento** (Q1) | Chica | Ajuste del owner; depende de los tramos de la 1. |
| 2 | **Auditoría** | Grande | Cierra el hueco comercial y empieza a acumular historia. Lo no registrado no se reconstruye. |
| 3 | **Stakeholder + métricas** | La más grande | Consume lo anterior: tramos, auditoría y datos acumulados. |

## Principio de permisos

> «las cosas que "solo pueda hacer el owner" se limiten a las acciones mas sencibles y especificas, no a cada cosa que
> consideremos "importante"»

Permisos amplios con trazabilidad: la auditoría es lo que permite quitar fricción sin perder control.

**Solo el owner:**

- Reasignar al responsable y cambiar el modo del equipo.
- Sacar a un miembro del equipo cuando la vacante no tiene responsable.
- Invitar y quitar miembros de la empresa y cambiar roles (incluido invitar stakeholders).
- Exportar la auditoría completa.
- Configuración de la empresa y eliminar la empresa (ya es así hoy).

Todo lo demás (configurar el pipeline, publicar, pausar, cerrar, mover candidatos) lo hace el equipo de la vacante,
auditado.

## 1. Asignación de la vacante

Requisito de los socios:

> «una de las cosas que nos pediran si o si, en algun momento, sera que una vacante este asignada a mas de un
> reclutador, por vacante, y que puedan trabajar en conjunto para llegar a las metas, y aqui, importa mas que nunca la
> auditoria»

### Modelo

- Cada vacante tiene un **equipo de 1 a N reclutadores**, cada uno con un **tramo de asignación**: desde cuándo, hasta
  cuándo, función y motivo. Reasignar = cerrar un tramo y abrir otro. Sumar un colaborador = abrir un tramo.
- Reemplaza al `principal_recruiter_id` actual (la data es desechable; no hace falta compatibilidad).
- **Modo elegible por vacante:**
  - **Con responsable**: un responsable + colaboradores.
  - **Equipo sin responsable**: todos iguales.

### Crédito del placement

> «si hay un responsable asignado mas colaboradores, entonces el credito directo del placemente es del responsable y
> los demas son participantes en el placement", y si no se asigno un responsable, entonces el credito es de todos»

- Se usa el **modo vigente en el momento del placement**; no se recalcula si el modo cambia después.
- Crédito compartido: cuenta 1 en la ficha de **cada** reclutador, pero **1 (no N)** en los totales de la empresa.
- Base: el placement es del reclutador asignado cuando se hizo el placement.

### Plazos y meta

- **Compromiso con el cliente**: es de la vacante. No cambia con una reasignación; renegociarlo es una acción aparte,
  con motivo y auditada.
- **Plazo del reclutador**: es de cada tramo; se define al asignar.
- **Meta de entrega compartida** a nivel vacante; se mide el aporte de cada reclutador. Las cuotas individuales quedan
  para después, opcionales.

### Quién puede qué

| Acción | Con responsable | Sin responsable |
| --- | --- | --- |
| Sumar colaborador | Responsable | Cualquier miembro del equipo |
| Sacar a otro miembro | Responsable | Owner |
| Salir por cuenta propia | Colaborador sí; el responsable **no** (el owner asigna reemplazo) | Cualquier miembro |
| Reasignar al responsable | Owner | — |
| Cambiar el modo | Owner | Owner |

### Reasignación

- **Motivo obligatorio** de una lista (carga de trabajo, baja del reclutador, desempeño, pedido del cliente, otro) y
  «otro» con nota.
- **Foto del estado** al momento del cambio: candidatos por etapa, plazo consumido, si la entrega ya se cumplió.
- Queda auditado: cuándo, quién la tenía, a quién pasó, estado previo.

### El reclutador que sale

- **Pierde el acceso** a la vacante al cerrarse su tramo. Ver a esos candidatos desde la Base de talento depende del
  ajuste de visibilidad (Q1).
- **Su trabajo queda a su nombre**: candidatos subidos, movimientos y entregas siguen en métricas y auditoría.
- Ve en su historial un **resumen sin datos de candidatos** («Vacante X, tu tramo del 1 al 12, entregaste 8»).
- Lo que dejó en curso (invitaciones psicométricas, mensajes) **sigue vigente** y pasa al equipo.

### Decisiones del 2026-11-02 sobre la propuesta del backend

Confirmación del usuario, textual: «1. estoy de acuerdo. 2. completamente de acuerdo. 3. completamente de acuerd. Si
hermano, todo lo que mencionas, me cierra completamente.»

- **Q1 — Visibilidad de la Base de talento, configurable por el owner.** En palabras del usuario: «condiero que esto
  debe de ser configurable por el owner ... que se pueda configurar la visibilidad, para "Todos los reclutadores" o
  para "ciertos usuarios" y poder elegir a esos ciertos usuarios».
  - Ajuste de empresa, solo owner, auditado: «Base de talento visible para» = «Todos los reclutadores» (por defecto,
    como hoy) o «Usuarios seleccionados» con selector de miembros.
  - El owner siempre la ve; el stakeholder (funcionalidad 3) también.
  - Un reclutador fuera de la lista sigue viendo, desde el tablero, a los candidatos de las vacantes donde tiene un
    tramo activo. Pierde la búsqueda global, el detalle fuera de una vacante, los CV de la base y la exportación de
    contactos.
  - Se entrega como **unidad chica aparte, justo después de la funcionalidad 1**.
- **Q5 — Una vacante con responsable nunca queda sin responsable** (el backend lo garantiza).
  - Quitar de la empresa a un miembro que es responsable de vacantes no terminadas se rechaza y devuelve la lista de
    esas vacantes.
  - El frontend lo convierte en un flujo «Reasignar sus vacantes a…» (una persona para todas, o por vacante), con el
    motivo «baja del reclutador» precargado. Es una sola operación: reasignaciones, cierre de tramos y baja del
    miembro, todo auditado.
  - En vacantes terminadas, el tramo solo se cierra (causa «fin de membresía») y la historia queda. Reabrir una
    vacante sin responsable exige asignarle uno antes.
- **Q6 — Salir de placement pide un motivo, y el motivo decide el crédito.**
  - Sacar a alguien de placement sigue siendo acción del equipo.
  - «Lo moví por error»: el placement nunca ocurrió y el crédito se **anula**.
  - «El candidato renunció / no se presentó / se cayó después»: el crédito **se mantiene**, marcado «placement que no
    se sostuvo».
  - El owner puede corregir después («anular / restaurar crédito»), auditado.
  - Para la funcionalidad 3: los «placements que no se sostuvieron» son la base de las métricas de garantía de
    reemplazo de agencias.

Resto de las preguntas del borrador `vacancy-team-v1`, decididas el mismo día («si hermano, voy con esas.»):

| # | Pregunta | Decisión |
| --- | --- | --- |
| Q2 | Modo al crear la vacante | Con responsable; el creador queda como responsable. |
| Q3 | ¿El owner puede estar en un equipo? | Sí, cualquier miembro de la empresa. |
| Q4 | Placement hecho por alguien fuera del equipo (p. ej. el owner) | El crédito es del equipo según el modo; quien hizo el movimiento se registra aparte. |
| Q7 | Plazo del reclutador | Opcional al asignar; si no se define, toma la fecha compromiso con el cliente. Lo cambian el responsable o el owner (sin responsable: cualquier miembro o el owner). |
| Q8 | Renegociar el compromiso con el cliente | Libre antes de publicar; después de publicar, solo renegociando con motivo de una lista (pedido del cliente, cambio de alcance, retraso interno, otro con nota). Lo hace el equipo; auditado. |
| Q9 | «Entregaste N» en un tramo | Solo los candidatos que ese reclutador movió o cargó hasta la etapa de entrega durante su tramo. |
| Q10 | El responsable anterior al reasignar | El owner elige en cada reasignación; por defecto sale de la vacante. |
| Q11 | Máximo de miembros por equipo | Sin límite en la v1. |
| Q12 | Avisos por reasignación o alta en el equipo | Ninguno en la v1. En el radar: avisos dentro de la app y, cuando exista el proveedor de correo, por correo. |

### Precisiones del backend (2026-11-02)

- El «compromiso con el cliente» ya existe: es la fecha compromiso de la configuración de entrega, y la meta
  compartida es su cantidad objetivo.
- El placement no es una entidad: es un candidato que entra a la etapa de placement. El crédito necesita su propio
  registro.
- El acceso a la vacante pasa por un único punto (owner o responsable actual); se reemplaza por «owner o miembro
  activo del equipo».

### Analítica de reasignaciones (para la funcionalidad 3)

Cuántas veces un reclutador deja vacantes, qué vacantes se reasignaron, cuántas veces, a quién y por qué.

## 2. Auditoría

> «no se podia saber que hizo cada reclutador, no se podia saber si un reclutador descargo algo, que hizo ( cosas
> sencibles), cuando las hizo, que paso despues, que descargo, cuando lo descargo, cuando inicio sesion, cuando cerro
> sesion»

Base existente: `audit_events` con ~40 tipos de eventos de escritura. Falta:

- **Lecturas sensibles**: detalle de candidato, descarga de CV, exportación de contactos (hoy solo se audita ver un
  resultado psicométrico).
- **Sesión**: inicio de sesión (Cognito o BFF de Next) y «cerró sesión» al hacer clic. Con JWT no hay un registro
  exacto de expiración; se dice así, sin prometer más.
- **Miembros y roles**: hoy no se auditan.
- **IP y navegador**: el BFF de Next reenvía la IP real del usuario (trabajo del frontend).
- **`company_id`** en cada evento, para filtrar por empresa.
- **Inmutable de verdad**: la base impide UPDATE/DELETE (hoy es solo convención); opcional, cadena de hashes.
- **Datos personales (LFPDPPP)**: IDs, no datos personales, en la metadata; política de retención definida.
- **Pantalla de auditoría**: filtros por persona, acción, fecha y vacante; exportar (solo owner) también queda auditado.

## 3. Stakeholder + métricas

**Estado (2026-11-07): implementado en ramas, sin integrar a `main`.** Contrato y catálogo de métricas con
definiciones: `docs/contracts/stakeholder-metrics-v1.md` (decisiones D1–D12 aprobadas por el usuario). Frontend en
`feat/stakeholder-metrics`, backend en `feat/stakeholder-metrics-backend`; seguimiento en
`odd/tasks/stakeholder-metrics.md`. Qué hay:

- **Rol stakeholder**: el owner crea un enlace de invitación de un solo uso (7 días) en Equipo → Stakeholders y lo
  envía por cualquier canal; quien lo acepta ve solo **Métricas**, en solo lectura y con toda la empresa. Quitarlo se
  hace desde la lista de miembros. Todo queda en la auditoría.
- **Métricas** (`/empresa/metricas`, owner y stakeholder; el reclutador ve sus números en «Mi historial»): resumen de
  la empresa por periodo (hasta 366 días) con filtros por reclutador y por cliente o área, ficha por reclutador sin
  puntaje ni ranking, series por mes y el detalle con nombres de candidatos, que se registra en la auditoría. Cada
  número abre su definición escrita.
- **Datos nuevos**: canal de origen de la postulación (portal, sitio de empleo, registro manual; lo anterior queda
  como «portal o sitio, sin distinguir») y «Fecha objetivo de cierre» opcional en la configuración de la vacante.

Probado por el agente en el navegador contra el backend real con cuentas de owner, stakeholder y reclutador.

> «ese rol que solamente va a meterse a ver metricas de la empresa ... este rol no va a poder hacer nada, porque lo
> unico que va a tener son metricas de rendimiento»

- **Solo lectura**, ve **toda la empresa** y **puede ver datos personales** de candidatos.
- Necesita su propio **tipo de usuario** y una **invitación** (hoy agregar un miembro exige una cuenta de reclutador,
  y no hay invitación por correo; ver `decision-email-provider.md`).
- **Ficha por reclutador**, no un ranking único: puntualidad, volumen, conversión a placement, reasignaciones. El
  humano compara.
- **Cada métrica lleva su definición escrita** antes de construirse. Ejemplo de por qué: hoy la fecha de cumplimiento
  de la entrega puede ser el momento en que se guardó la configuración, no el de la entrada del candidato N.

Métricas que pidió el usuario: vacantes asignadas por reclutador; cuántas concluyen en el tiempo configurado; si
entrega los candidatos en tiempo y forma, cuánto tarda y cuántos entrega; cuántas terminan en placement y cuántas
no; de dónde se postulan los candidatos; vacantes cerradas por mes; por cliente o departamento interno; qué
reclutador rinde mejor; analítica de reasignaciones.

Datos que faltan para algunas: el **canal de origen** de la postulación (hoy no se distingue el portal del sitio de
carreras) y los **tramos de asignación** (funcionalidad 1).

El catálogo de métricas con definiciones se trabaja al llegar a esta funcionalidad.
