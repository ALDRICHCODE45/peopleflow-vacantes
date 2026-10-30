# Competencias claras

C1 · S1–S4 de `odd/tasks/psychometric-competency-clarity.md`. Solo diseño: sin cambios al producto, IDs, contenido versionado o datos. Nombres y textos pendientes de aprobación.

| Tablero | Tamaño real | Qué revisar |
|---|---|---|
| `01-configuracion.html` | 1440 × 1508 | Lista maestra y detalle elegidos; siete nombres, ayuda independiente por fila, en el encabezado, cuatro campos y Confirmar perfil. |
| `02-ficha-candidato.html` | 1440 × 1250 | Ficha compacta de 560 px para el reclutador; siete bandas sin puntajes ni decisión automática. |
| `03-nombres.html` | 1440 × 1150 | Texto final propuesto de cada popover, antes → propuesta y una alternativa por nombre. Mesa editorial, no UI del producto. |

## Interacción

Los tableros 01 y 02 inician con un popover abierto **solo como ejemplo solicitado**. Al cerrarlo, no queda ninguna descripción de competencia visible. Cada botón ⓘ tiene objetivo de 40 × 40 px, nombre accesible, `aria-expanded`, `aria-controls` y `aria-haspopup`. Clic o Enter abre; otro botón sustituye la ayuda; Escape, × y clic fuera cierran y devuelven foco al botón original. La ayuda de una fila no la selecciona. Las ayudas de campos están en `fields` dentro de `01-configuracion.html`; el texto de competencias coincide literalmente en los tres archivos.

Los controles generales son ilustrativos. Seleccionar competencias y editar requisitos permite explorar el detalle; Guardar, Confirmar e Informe no persisten ni simulan éxito. No hay conexión al producto. La guía vinculada al perfil requiere confirmación; el contrato permite una guía exploratoria sin comparación en borradores.

## Fuentes y autoevaluación visual

Shell, densidad, tipografía y radios: `design/psychometric-profile-config/03-lista-maestra-detalle.html`; ficha: estado compacto de `design/psychometric-report/03-ficha-expandible.html`. Se contrastó la captura real proporcionada. Definiciones y límites: `docs/psychometrics/bands-and-competencies-v1.md` y `docs/contracts/psychometric-tests-v1.md`.

Autoevaluación contra `design/system.md`: solo `background`, `foreground`, `card`, `popover`, `primary`, `primary-foreground`, `muted`, `muted-foreground`, `border`, `status-info` y `status-success`, con sus valores exactos y mezclas semánticas permitidas. No se agregan colores. Una familia en los tres tableros: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`, fallback de sistema permitido. Radios derivados de `.625rem`; sombras de tarjeta del sistema. Foco visible, selección delineada y movimiento reducido respetado. No se afirma una certificación de accesibilidad completa.

## Verificación reproducible

Desde la raíz, con Node 22 y Chrome ya instalados:

```sh
/Users/aldrich_code45/.nvm/versions/node/v22.23.4/bin/node design/psychometric-competency-help/checks.mjs
```

El verificador usa `chromium` de `/tmp/t12qa/lib.mjs`, sin sesiones, credenciales o servidor; captura cada página completa y un popover abierto por clic en `/tmp/t12qa/comp-help/`. Comprueba dimensiones, 27 triggers, teclado, cierre, foco, selección independiente, texto idéntico, contraste de pares de tokens y cero errores de consola/página o solicitudes externas. Es específico del entorno de revisión; no requiere instalar dependencias.

## Para aprobar

- En cada fila del tablero 03: nombre propuesto o alternativa.
- Los siete textos de competencias y las cinco ayudas de campos.
- Los nombres familiares «Trabajo en equipo» y «Trabajo bajo presión» son más amplios que las hipótesis: se propone mantener el límite explícito en la ayuda.

El padre registra el enlace en el Log de ODD y abre el canvas; esos archivos y herramientas están fuera de este encargo. Sin comentarios de canvas resueltos. Sin commit.
