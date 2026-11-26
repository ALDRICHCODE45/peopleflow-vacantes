# Autorrevisión · design/notifications (T1 · S1–S7)

Fecha: 2026-11-26. Seis artboards HTML autocontenidos (CSS, JS y SVG en línea; sin URLs externas ni fuentes remotas), interactivos,
en claro y oscuro. Revisados en Chromium con Playwright y `@axe-core/playwright` de `frontend/node_modules`. Capturas en
`/tmp/notif-design/shots/` (fuera del repo).

## Qué se ejecutó de verdad

| Comprobación | Alcance | Resultado final |
|---|---|---|
| Render headless y errores de JS | 6 artboards × todos sus estados (51) × claro y oscuro, viewport 1440 × 900 | 0 errores en consola |
| axe-core (wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, incluido contraste) | las 102 corridas (51 estados × 2 temas), página completa | 0 violaciones. Al principio: 6 de `color-contrast` en 04 (la clase `.dot` del punto de no leída pisaba el `Badge dot`); corregido renombrándola a `.udot` |
| Desborde horizontal | scroll horizontal de la página; elementos fuera de cada marco (1440 y 390); elementos cortados por un ancestro `overflow:hidden`; texto recortado | 0. La revisión visual encontró antes tres defectos que el script no veía (texto `sr-only` visible dentro del control segmentado de correo, el badge «Tu ajuste» cortado a 390, el chevrón de la lista de fondo saltando de renglón a 390); se corrigieron y se amplió el script |
| Foco visible | Tab desde los estados del artboard hacia el marco (28 pulsaciones por artboard y tema; 18–23 dentro del marco) | todos los elementos enfocados pintan contorno de 2 px `--primary-text` (en `ChoiceList`, el contorno va en la fila) |
| Movimiento reducido | `reducedMotion: reduce`, 51 estados en claro | 0 animaciones ni transiciones activas (esqueleto sin pulso, chevrón e interruptor sin transición) |
| Flujos con clic y teclado (script de Playwright) | 01: abrir con la campana (foco a «No leídas»), Escape cierra y devuelve el foco a la campana, marcar una (contador 6 → 5), marcar todo (→ «todo leído», foco en «Deshacer») y deshacer; 02: 40 Tab con la hoja abierta no salen de ella, filtro por tipo crea su chip, Escape devuelve el foco; 03: ↓ mueve a la siguiente fila y Enter la abre en el detalle; 05: «Restablecer» abre el diálogo con el foco en «Cancelar», Escape vuelve al botón; 06: «Editar» abre la hoja con el foco en «Aviso activo», Escape vuelve a «Editar» | pasan. Al principio el diálogo de 05 y la hoja de 06 dejaban el foco en el disparador; corregido |
| Revisión visual | capturas de cada estado en claro y oscuro, más recortes a página completa de 05 y 06 | ver «Corregido tras la revisión visual» |

### Corregido tras la revisión visual

- 03: la fila seleccionada seguía con punto de no leída y el contador no bajaba; ahora seleccionar marca leída y el punto no se pinta sobre la barra de selección.
- 01–04: la línea de metadatos repetía la vacante que ya dice el título y crecía a 3 líneas; se dejó tiempo + destino.
- 05: la barra «Cambios sin guardar» no tenía superficie (faltaba la receta `.tbbar.stk` del artboard de Configuración); el texto `sr-only` del control segmentado era visible; «Tu ajuste» ahora dice solo lo que difiere.
- 06: la columna «Aviso» quedaba en ~150 px; se acortó el texto de correo de la tabla, «Editar» pasó a botón de icono con nombre accesible y se quitó el badge «Operativa» de cada fila (ruido).
- Teléfono: la migaja «Configuración / Notificaciones» pasa a flecha de regreso (como `SiteHeader` en móvil).

## Autorrevisión de UX (composition-and-feedback, adaptive-interfaces)

| Criterio | Cómo se cumple |
|---|---|
| Jerarquía | título de página 24/600, secciones 18/600, título de notificación 14/500 (600 si no leída), resumen 14 muted, metadatos 12 muted |
| No leída sin depender del color | punto + negrita + texto `sr-only` «No leída.»; el contador de la campana va también en el nombre accesible («Notificaciones, 6 sin leer») |
| Urgencia | por vencer = badge `review` con la hora («Vence mañana, 12:00»); vencida = badge `danger` «Vencida»; siempre con palabra e icono |
| Un contenedor por trabajo | una tarjeta por lista; días como encabezados fijos, sin tarjetas por fila; «Requiere atención» (02) es una franja tintada, no una tarjeta anidada |
| Estados | carga (esqueleto con la forma de las filas, sin números inventados), primera vez (qué llegará + preferencias), «Estás al día» (No leídas vacía), sin resultados con filtros nombrados y «Limpiar filtros», error con «Reintentar» y la aclaración de que no se marcó nada |
| Acciones reversibles | «Marcar todo como leído» deja «Deshacer»; marcar una deja la fila en su lugar hasta cerrar el panel (no salta la lista) |
| Motivo visible de lo que no se puede cambiar | 05: candado + «Obligatoria» + razón en la fila; «Desactivada por tu empresa» con la razón; «Solo en la app» cuando el correo no se permite. 06: la hoja explica por qué una obligatoria no se apaga |
| Objetivos | botones e interruptores ≥ 40 px (44 px en los pies del teléfono); la palomita «Marcar como leída» es de 40 × 40 con nombre accesible |
| Teléfono | 390 px sin desborde; la bandeja ocupa la pantalla; tablas de 05 y 06 pasan a tarjetas por aviso; la matriz por rol se elige con un segmentado |

## Autorrevisión del sistema (design/system.md)

- **Colores usados:** solo tokens: `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--primary-foreground`,
  `--primary-text`, `--secondary`/`--muted`/`--accent`, `--muted-foreground`, `--border`/`--input`, `--destructive`, `--status-info`,
  `--status-review`, `--status-success`, `--status-danger`, `--sidebar`, `--sidebar-accent`, `--ring`, y `--sel`/`--on-sel`/`--edge`
  (tokens de selección), en claro y oscuro con los valores del sistema. Los 12 hex del archivo son exactamente los valores de esos tokens;
  `oklch()` solo aparece en las dos líneas de definición de tokens. Tintes por `color-mix` de un token (10–12 %, como `Badge` semántico).
  Sombras de Tailwind con negro al 10 % y el telón `bg-black/30`, como el artboard elegido de Configuración.
- **Familias:** pila del sistema (`system-ui, -apple-system, "Segoe UI", Roboto`) como respaldo de canvas de Inter. Monoespaciada
  solo en la línea de estado del artboard (rutas de destino), fuera del producto.
- **Componentes:** `Tabs` (lista `bg-muted` 14 px, activo sobre `--background`, conteo en pastilla que se tiñe de primario), `Badge`
  (`review`, `danger`, `info`, `neutral`, con punto para estados de postulación), `Button` (18 px, 40/44 px), `Switch`, `ChoiceList`
  (barra de 3 px, marca final, fila entera como objetivo, motivo de deshabilitado en la fila), control segmentado, `Sheet` flotante,
  `Drawer` en el teléfono, `AlertDialog`, `Empty` (tile de 40 px con el icono del tema, título, descripción, una acción), esqueleto,
  toast sobre `--popover`, tarjeta de 24 px, avatar 32/24 px, filas `divide-y`, chips removibles de 40 px (receta del registro de auditoría).

### Desviaciones (para decidir)

1. **Popover de 420 px** (01, 04 escritorio). El `Popover` del sistema mide 288 px; una notificación con título de vacante largo no cabe.
   Mismo tipo de excepción que los paneles de filtro del registro de auditoría (360–460 px); habría que registrarla si se elige.
2. **Hoja de 460 px** (02) y de 448 px (06, `.sheet.wide` del artboard de Configuración); el `Sheet` del sistema es `sm:max-w-sm` (384 px).
3. **Contador sobre la campana**: pastilla de 18 px `--primary` con `--primary-foreground` y anillo de 2 px del fondo. No existe en el sistema
   (el `Badge` es de 20 px y rectangular); es un patrón nuevo.
4. **Fila de notificación** (tile de icono 36 px `rounded-xl` teñido por tipo + punto de 6 px + palomita de 40 px): composición nueva sobre `Item`;
   el tile teñido por tipo reutiliza los tonos de estado (`info` para asignaciones, `success` para pruebas completadas, `review`/`danger`
   para entregas) fuera de un `Badge`.
5. **Encabezados de día fijos** (`position: sticky`) dentro de un panel con scroll: no hay precedente en el sistema.
6. **Franja «Requiere atención»** (02): tinte `--status-review` al 6 % sobre `--popover`; el sistema reserva el tono revisión para badges.
7. **Pastillas de destinatario** (06, `rounded-full`, 12/500, primario al 9 % para Responsable/Equipo): siguen la receta de «Reason chip» del
   espacio del candidato, aplicada aquí en la empresa.
8. **Marca**: el artboard pinta «people*flow*» como texto (cursiva del sistema); el producto usa la imagen del wordmark.
9. **Celdas de matriz con `select` nativo** (06) con la piel de `Select` (relleno `input/50`, 18 px); en producto sería el `Select` de shadcn.
10. **«Tu ajuste»** usa la variante `accent` del `Badge` (primario al 12 %, borde al 40 %, texto `--foreground`) con texto que puede ocupar dos líneas
    (el `Badge` del sistema es de una línea, `h-5`).

## Iteración L5 (2026-11-26): filtros para 02 (07–09) y correcciones en 05 y 06

Cambios: tres artboards nuevos con la hoja de 02 (mismo contenido, estados y comportamiento: «Requiere atención» fija,
agrupación, marcar leída / todo con «Deshacer», primera vez, carga, error, campana en reposo; ahora con un segundo marco de
teléfono a 390 en cada estado) y tres diseños de filtro distintos. 02 no se tocó. En 05 solo cambia la fila «Prueba pendiente
del candidato» (y la descripción del estado Reposo). En 06: stakeholders de solo lectura y fuera de los equipos, y «Prueba
psicométrica pendiente» encendida por defecto.

| Artboard | Filtro | Filas de control a 460 px y a 390 px | Conteo y reinicio |
|---|---|---|---|
| 07 | Botón «Filtrar» con contador → panel no modal con casillas de Tipo y Vacante (búsqueda de vacante, conteo por opción) | 1 (pestañas + «Filtrar») | línea «2 de 10 · Postulaciones · Analista de Nómina» + «Limpiar»; con varios valores se resume («2 tipos · 2 vacantes»); «Limpiar» y «Ver N notificaciones» en el panel |
| 08 | Segmentado de opción única Todo · Candidatos · Entregas · Vacantes + botón de vacante (maletín) que abre un combobox con búsqueda | 1 (las pestañas suben al renglón del título) | misma línea; el maletín se tiñe con un punto y su nombre accesible dice la vacante |
| 09 | Ninguno visible: buscador combobox que entiende vacante, candidato y tipo (sin acentos), con filtros rápidos por tipo dentro de su lista | 1 (pestañas + buscador) | misma línea; la × del campo borra el texto, «Limpiar» borra todo |

### Qué se ejecutó de verdad (Chromium + Playwright + `@axe-core/playwright` de `frontend/node_modules`)

| Comprobación | Alcance | Resultado |
|---|---|---|
| axe (wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) | 05 (6 estados), 06 (9), 07–09 (13 cada uno) × claro y oscuro = 108 corridas, página completa con los dos marcos | 0 violaciones |
| Desborde horizontal | scroll de la página; elementos fuera de cada marco de 1440 y de 390; cortes por `overflow:hidden`; texto recortado | 0 |
| Movimiento reducido | `reducedMotion: reduce`, los 54 estados en claro | 0 animaciones o transiciones activas |
| Foco visible | 28 Tab desde los estados del artboard, claro y oscuro (16–23 dentro del marco) | todos con contorno de 2 px `--primary-text`; la opción activa de los combobox (foco en el campo, `aria-activedescendant`) se pinta con el mismo contorno |
| Errores de JS | todos los estados | 0 |
| Flujos con teclado (script) | 07: abrir «Filtrar» (foco en la 1.ª casilla), Espacio filtra (3 de 10), buscar «nóm» deja 1 vacante, Esc cierra el panel y vuelve a «Filtrar» (nombre «Filtrar1, 1 filtro activo»), «Limpiar» vuelve a 10, otro Esc cierra la hoja con foco en la campana. 08: ← → en el segmentado aplican (2 de 10 · Entregas); el maletín abre el combobox, «nom» + Enter elige y devuelve el foco al botón («Vacante: Analista de Nómina»); `aria-activedescendant` apunta a la opción activa; Esc cierra el panel. 09: ↓ abre la lista, Enter marca «Entregas» sin cerrarla, escribir «supervisor» filtra (1 de 10), ↓ + Enter elige la vacante y cierra la lista, Esc cierra la hoja. 06: Mariana no recibe nada por defecto; activar «Prueba completada» para Stakeholder le da 1 aviso «Solo en la app» y la barra de cambios; el selector de Stakeholder solo ofrece «Solo en la app» y «Apagado» | pasan |
| Revisión visual | capturas de cada estado en claro y oscuro (`/tmp/notif-design/shots/07-*`, `08-*`, `09-*`, `05-*`, `06-*`) | corregido: en la matriz por rol de 06 el texto «En la app y por correo» quedaba cortado dentro del select (ya pasaba antes de este cambio); se repartieron los anchos de columna (Dueño 200, Reclutador 224, Stakeholder 172). La pastilla de stakeholders en la tabla de reglas se acortó a «Stakeholders» (el detalle va en la matriz y en la nota) |

### Autorrevisión de UX

- Jerarquía y calma: ninguno de los tres pinta chips de filtro; lo activo es una línea de texto de 13 px bajo la fila de control,
  solo cuando hay filtros. A 390 px esa línea puede ocupar dos renglones de texto (no controles).
- Estados: sin resultados conserva los criterios, los nombra y ofrece «Limpiar filtros»; carga y primera vez no muestran conteos;
  el error dice que no se marcó nada.
- Teclado y lector: 07 usa casillas nativas en `fieldset` con leyenda; 08 un `radiogroup` con foco itinerante y un combobox con
  `aria-activedescendant`; 09 un combobox con `listbox` multiselección y grupos con nombre. Cada artboard trae su tabla
  «Teclado y lector de pantalla». Escape cierra primero el panel o la lista y después la hoja.
- 06: el Stakeholder no aparece en ningún texto de «Equipo de la vacante»; no se puede elegir por nombre en «Personas
  específicas» (opción deshabilitada con el motivo); las filas de equipo dicen «No aplica · no forma parte de equipos»; la vista
  previa explica por qué no le llega cada aviso.

### Autorrevisión del sistema (design/system.md)

- Colores: los mismos 12 hex de los tokens y `oklch()` solo en las dos líneas de definición, en los cinco archivos; tintes por
  `color-mix` de tokens; sombras negras al 10–16 % (60 % en el panel oscuro, para separarlo de la hoja).
- Familias: la pila del sistema; monoespaciada solo en `kbd` de la tabla de teclado del artboard (fuera del producto).

### Desviaciones nuevas (para decidir)

11. **Panel flotante dentro de la hoja** (07–09, 320–340 px, o el ancho de la fila en 09): `Popover` del sistema (288 px) sobre un `Sheet`;
    en el teléfono ocupa el ancho de la hoja menos 24 px.
12. **Combobox con lista** (08, 09): no existe en el sistema; se dibujó con las filas de `ChoiceList` compactas (40 px) y la marca final
    redonda o cuadrada.
13. **Segmentado de cuatro opciones a todo el ancho** (08): el `seg` del sistema es `inline-flex`; aquí ocupa la fila con `flex:1`.
14. **ChoiceList compacta** (07): filas de 44 px en lugar de 56 px dentro del panel.
