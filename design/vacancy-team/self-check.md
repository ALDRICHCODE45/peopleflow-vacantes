# Vacancy team · self-check de T2

Propuestas HTML, no implementación de producto. Ninguna dirección elegida.

## Fuentes leídas

- `design/system.md` completo: tokens y anatomía de estados.
- `docs/frontend-ui-design-rules.md` completo.
- `design/checklist-config/02-lista-y-detalle.html` completo.
- `odd/tasks/vacancy-team.md` completo, incluido Log L1–L5.
- `docs/product/next-three-features.md` completo, con §1 como fuente de producto.
- Contrato completo, solo lectura en el worktree hermano: `/Users/aldrich_code45/Desktop/workspace/peopleflow-vacantes/docs/contracts/vacancy-team-v1.md`.
- Fuentes de contexto: `frontend/src/features/employer-vacancies/vacancy-config/{shell,delivery-module}.tsx`, `frontend/src/features/employer-team/{team-workspace,team-page}.tsx`, `frontend/src/features/pipeline-movement/{board,disposition-dialog}.tsx`, `frontend/src/app/(empresa)/empresa/vacantes/page.tsx`.

## Self-check de tokens · realizado por artboard

Paleta base B, copiada de los tokens claros de `design/system.md`:

| Token | Valor |
| --- | --- |
| background | `#F7F5FB` |
| foreground | `#1A1626` |
| card | `#FFFFFF` |
| muted | `#F1EEF7` |
| muted-foreground | `#6B6480` |
| border | `#E4DFF0` |
| primary | `oklch(0.491 0.27 292.581)` |
| primary-foreground | `oklch(0.969 0.016 293.756)` |

Variantes semánticas tomadas del mismo sistema: success `oklch(0.46 0.13 152)`, review `oklch(0.47 0.12 70)`, danger `oklch(0.45 0.2 25)`, destructive `oklch(0.577 0.245 27.325)`.

| Artboard | Colores declarados y comparados | Familias comparadas | Resultado |
| --- | --- | --- | --- |
| 01 | B + success + danger | system-ui, -apple-system, Segoe UI, sans-serif | Coinciden; danger reservado, sin uso actual. |
| 02 | B + success | Misma pila de sistema | Coinciden; success reservado. |
| 03 | B + success | Misma pila de sistema | Coinciden; success reservado. |
| 04 | B + danger | Misma pila de sistema | Coinciden. |
| 05 | B + success + review + danger | Misma pila de sistema | Coinciden. |
| 06 | B + review + danger | Misma pila de sistema | Coinciden; review reservado. |
| 07 | B + destructive + danger | Misma pila de sistema | Coinciden. |

`transparent`, `currentColor`, `inherit` y mezclas de esos tokens no agregan colores nuevos. Sombras usan la receta de candidate card, no una paleta propia. Radio base .625rem y multiplicadores .8 / 1 / 1.4 / 1.8 del sistema. Sin fuentes remotas: la pila de sistema es el fallback permitido para canvas.

## Cobertura y estructura

| Artboard | Specs | Comprobación estática |
| --- | --- | --- |
| 01 | S1–S5 | Configuración list/detail; modo, fuente del plazo, picker, acciones owner y notas can del colaborador; tramos con funciones y snapshot; vacío de colaboradores, historia, nada seleccionado, carga y error. |
| 02 | S1–S5 | Pipeline + franja + Sheet flotante; mismo dominio, historia progresiva, overlay, foco y Escape; marco móvil; vacío, carga y error dentro del panel. |
| 03 | S1–S5 | Página con equipo compartido + timeline; variante con responsable; funciones continuas, cambio de modo, reasignación/snapshot, vacío, carga y error. |
| 04 | S3–S5 | Picker de empresa, cinco motivos, Otro con nota, fecha opcional solo para nuevo tramo, salir por defecto / seguir, snapshot sin candidatos. Target activo conserva tramo y plazo. |
| 05 | S6 | Variantes mover/descartar, razones independientes, tres estados del crédito, tres clases de receptores, corrección owner confirmable, créditos anteriores, vacío y carga. |
| 06 | S5 | Fecha anterior/nueva, cuatro motivos, Otro con nota, efecto sobre plazos heredados, sin cambiar tramos cerrados. Carga, validación y conflicto. |
| 07 | S7–S8 | Preview, persona para todas o por vacante, resumen con nombres elegidos y confirmación de operación atómica; team_access_ended, historial propio sin candidatos, vacíos/carga y marco móvil. |

No se diseña un equipo real de cero personas: contradice la invariante de 1..N. Los vacíos de equipo significan «sin colaboradores» o «solo tú», no la ausencia del responsable obligatorio. Un historial sin cambios tiene su estado explícito; los pickers usan la excepción compacta «Sin coincidencias». La lectura de tramos propios no promete acceso a un exmiembro de la empresa.

## Composición y límites del HTML

La excepción de canvas autocontenido usa HTML semántico y CSS inline, no React ni imports de shadcn. Mapa de implementación posterior (no autoriza instalar ni modificar primitives):

| Superficie | Primitive previsto / patrón local leído |
| --- | --- |
| Tarjetas, lista/detalle | Card/Header/Title/Description/Action/Content/Footer; referencia checklist 02 y vacancy-config/shell. |
| Menús de persona | DropdownMenu; referencias team-workspace y disposition-dialog. En canvas se usa disclosure nativo details/summary. |
| Panel lateral | Sheet flotante, encabezado y footer fijos, un cuerpo scrolleable; patrón §13.3/§17. |
| Diálogos sensibles | ConfirmActionDialog, media → título/descripción → detalles → footer; referencias board/disposition-dialog/team-page. Dialog nativo en HTML aporta foco modal, Escape y backdrop. |
| Vacíos | StateCard/SectionEmpty con icono de tema, título, descripción, acción útil. |
| Cargas | Skeleton por contexto; los rectángulos de HTML muestran su ubicación, no una espera artificial. |
| Formularios | Field + Select/Input/Textarea; Calendar de negocio con datos del servidor al implementar. |

Los botones finales de escritura son intencionalmente inertes: no backend, storage, solicitudes ni éxitos simulados. Solo funcionan navegación entre artboards, disclosures, selección de dirección/estado, apertura/cierre y pasos de baja. `data-can` documenta el permiso del contrato; **no** es una implementación de autorización. Las vistas owner y notas de colaborador se muestran como escenarios, no como inferencia de roles en producto.

## Evidencia observada y pendiente

- Escritura de los siete HTML: herramienta informó HTML clean en 01 inicialmente y en las ediciones de 01, 02, 03 y 07; no sustituye revisión en navegador.
- Escritura de `design.json`: herramienta informó JSON clean.
- Inspección estática de colores/fuentes: solo la paleta y pila documentadas arriba; no referencias externas en HTML.
- `git diff --check`: sin salida (antes del Log y del cierre final; repetido al cierre).
- Sin RED/GREEN: propuestas visuales pasivas, no cambios de comportamiento de producto. No hay runner de navegador autorizado/provisto para estos artboards.
- **Pendiente**: revisión renderizada a 1440, móvil, scroll, foco y contraste medido; modo oscuro no propuesto ni verificado. No afirmar validación visual ni axe.
- **Herramienta ausente**: esta sesión no expone `gentle_design`; no se pudo ejecutar el gate `list` (incluida detección de fuentes obsoletas) ni `open`. El padre debe ejecutar `gentle_design` action `open`, slug `vacancy-team`, y reportar su URL. No se inventa una URL ni se inicia un servidor alternativo.
- Pregunta de producto pendiente: ninguna. Decisión pendiente del usuario: elegir 01, 02 o 03; 04–07 son flujos complementarios a cualquiera de ellas.
