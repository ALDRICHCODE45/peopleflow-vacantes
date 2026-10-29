# Evaluaciones en el espacio del candidato

Propuesta para T11, S11 (acceso por cuenta) y S12. D7 se conserva: no hay puntajes, bandas, ajuste ni reporte para Mariana. No es implementación de endpoints ni una modificación de las pantallas aprobadas.

## Direcciones

| Archivo | Título | Tradeoff |
|---|---|---|
| `01-en-la-postulacion.html` | En la postulación | Contexto junto al proceso; menor descubrimiento si no se abre Postulaciones. |
| `02-bandeja-de-pendientes.html` | Bandeja de pendientes | Siguiente paso visible en Dashboard; evaluación separada del contexto completo de la postulación. |
| `03-en-la-postulacion-movil.html` | En la postulación · Móvil | CTA a ancho completo; historial bajo disclosure y scroll. |

01 y 02: viewport 1440 × 900. 03: viewport 390 × 844. El contenido largo conserva scroll natural: el aviso no se resume ni se recorta para que quepa en una captura.

**Ubicación recomendada para elegir:** 01, conservando el vínculo entre postulación, empresa y evaluación. La móvil desarrolla esa hipótesis; no representa una aprobación humana.

## Recorrido local

- «Responder evaluación» abre dentro del mismo shell el consentimiento de flows/02. La casilla requerida permite pasar al ejemplo aprobado de flows/03: pregunta 17, cinco opciones «Me describe…», 16 de 63 respondidas.
- No se sustituye el aviso por un resumen. Se conserva su texto completo, retención de 12 meses, ARCO con la empresa, decisión humana y condición de revisión legal pendiente.
- En este boceto, «Anterior» y «Siguiente», tema, «Ver vacante» y destinos sin artboard son placeholders habilitados e inertes. No se simulan guardados, envíos ni resultados. La transición consentimiento → pregunta es solo navegación de vista; no administra las 63 preguntas ni representa un consentimiento persistido.
- Volver mantiene el shell. En móvil, el botón de menú abre un diálogo de navegación con la cuenta de Mariana y los mismos grupos; Escape y «Cerrar menú» lo cierran.
- 01 y 03 permiten buscar por puesto/empresa. Los registros cerrados no tienen controles de respuesta o de resultados. En móvil, «Evaluaciones anteriores» revela las invitaciones expirada y revocada; en desktop está expandido para comparar estados.
- En 02, «Revisar pendiente» lleva a la sección Evaluaciones. Solo la invitación pendiente ofrece «Responder evaluación»; finalizada, expirada y revocada son filas de solo lectura. No se ofrece una ruta de escritura para ellas.

## Integración posterior (no implementada)

- Leer la lista con `GET /v2/me/assessments`; asociar por participación, no por título de vacante. El historial de ejemplo contiene invitaciones antiguas cerradas y una activa para Gerente de Operaciones, nunca dos activas ni un retake tras finalizar.
- Leer y responder por `/v2/me/assessments/{iid}` y sus endpoints de consentimiento/items/answers/finish. No emitir ni canjear un token, no usar la cookie del flujo público y no generar enlaces públicos desde el área privada (L29–L32).
- `created` → Pendiente; `in_progress` → En curso / «Continuar evaluación», con avance del servidor; `finished` → Finalizada; `expired` → Expirada; `revoked` → Revocada. Estos tres últimos permanecen visibles sin responder ni mostrar resultados.
- Si la invitación vence durante el flujo, dejar de escribir y mostrar el estado neutral «Ya no está disponible» dentro del shell mediante StateCard, con retorno a la ubicación de origen; no culpar a la persona ni decir que se perdió toda su postulación. Los ejemplos de lista ya usan esa frase.
- La cabecera del candidato mantiene las migas; no se usa el texto público «No necesitas crear una cuenta». La navegación Vacantes sigue dentro del shell (§14.7).
- Al implementar se reutilizan Card/Header/Title/Description/Action/Content/Footer, Item, Badge, Button, InputGroup, Progress, Field/Checkbox y StateCard instalados, no los elementos HTML del boceto como nuevos componentes de producto.

## Self-check del sistema

Colores usados (todos de `design/system.md`, tema claro):

| Rol CSS | Valor |
|---|---|
| background | `#F7F5FB` |
| foreground | `#1A1626` |
| card | `#FFFFFF` |
| primary | `oklch(0.491 0.27 292.581)` |
| primary-foreground | `oklch(0.969 0.016 293.756)` |
| muted | `#F1EEF7` |
| muted-foreground | `#6B6480` |
| border | `#E4DFF0` |
| info (01–02) | `oklch(0.45 0.16 250)` = status-info |
| success | `oklch(0.46 0.13 152)` = status-success |

Los tintes usan `color-mix` con esos tokens y transparencia; sombra de card 4% foreground + anillo 50% border, como el sistema. Sin tono café ni token review. Radios 8/10/14 px y medallones circulares. Tipografía única: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`; fallback del sistema autorizado para el canvas, sin descargar Inter. Títulos 24/600, secciones 16/600, cuerpo 14, metadatos 12–13. Foco visible, estados con texto además de color, controles independientes de al menos 40 px, opciones de 56 px; sin animación y con regla de movimiento reducido.

Los tres HTML y el manifiesto recibieron validación sintáctica automática al escribirlos. La revisión de tokens es estática, no una afirmación de contraste medido en navegador. No se ejecutó captura visual ni prueba de teclado en navegador; siguen pendientes la revisión a tamaño real, overflow, contraste computado y estados del menú móvil. Solo tema claro en este encargo; el botón de tema no simula un oscuro sin validar.

## Preguntas abiertas y handoff

- Elegir 01 (recomendada) o 02. 03 sigue 01 y deberá adaptarse si se elige 02.
- Revisión legal D9 del aviso sigue pendiente; no es un bloqueo para comparar estas ubicaciones ni una autorización de lanzamiento.
- El padre puede agregar al Log de `odd/tasks/psychometric-tests.md`: «T11 diseño: design/psychometric-candidate-workspace/, 01 En la postulación, 02 Bandeja de pendientes y 03 móvil de 01; S11 cuenta + S12; elección pendiente». No se editó ese archivo porque está fuera del alcance autorizado.

No se llamó `gentle_design`, no se abrió canvas, no se hicieron commits y no se tocaron los artboards validados ni código de frontend. Comentarios resueltos: ninguno. Abrir los HTML directamente; el padre puede abrir el canvas después si lo solicita.
