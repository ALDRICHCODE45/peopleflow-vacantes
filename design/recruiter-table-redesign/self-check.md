# Autorrevisión · design/recruiter-table-redesign (T1 · S1)

Fecha: 2026-11-24. Sin herramientas del canvas: los tres artboards son HTML autocontenido (CSS, JS y SVG en línea, sin URL externas) con los seis reclutadores de Grupo Altavista (periodo «27 ago 2026 – 24 nov 2026») y se revisaron en Chromium (Playwright de `frontend/node_modules`). Los artboards se generan desde fuentes fuera del repo; el HTML es el entregable y se edita directo.

## Qué se ejecutó de verdad

| Comprobación | Alcance | Resultado |
|---|---|---|
| Render headless | 3 artboards × 1440×900 y 390×844 × claro y oscuro × 11–13 estados cada uno, página completa (sin límite de alto) | sin errores de JS |
| axe-core 4.13 (WCAG 2.0/2.1/2.2 A y AA, con contraste) sobre el marco del artboard | 144 corridas (dueño) + 72 (stakeholder, claro) | 0 violaciones al final. Al principio: `target-size` (enlaces de cifra de 17–19 px de alto, WCAG 2.2 AA), `listitem` (los chips: `ul role="group"`), `scrollable-region-focusable` (cuerpo de hoja con desplazamiento), todos corregidos |
| Desbordes y recortes | texto con `overflow:hidden`/`ellipsis`, contenido que sale de su caja, elementos fuera del marco | 0 (no hay `line-clamp` ni puntos suspensivos: nada se corta; las tablas que se desplazan lo dicen con una región enfocable) |
| Objetivos táctiles | controles < 40 px (salvo casillas dentro de filas de elección, que son toda la fila, y enlaces de cifra en línea, que miden ≥ 24 px de alto) | 0 |
| Flujos con clic y teclado | 57 comprobaciones en 1440 y 390: ordenar por encabezado / selector, ocultar columna y restablecer, abrir y cerrar paneles con Esc y devolver el foco al botón, rango personalizado > 366 días con error, fila → ficha → volver (el foco regresa a esa fila), diálogo con trampa de foco, Esc en ayuda cierra solo la ayuda, pestañas de grupo con flechas, elegir/quitar para comparar (máx. 3), lado a lado, reintentar | todas pasan |
| Revisión visual | capturas de cada estado en claro y oscuro (`/tmp/design-shots-rt/`, fuera del repo) | ver el informe de la tarea |

Fallos encontrados y corregidos en la revisión visual: orden mostrado como «undefined»; encabezado de segunda fila pegado con el desfase equivocado; tarjeta de la tabla aplastada por el flex de la página; columnas recortadas a 1440 (anchos rebalanceados; ocho columnas caben sin desplazamiento; guion blando como respaldo si la fuente es más ancha); desglose de placements partido a mitad de frase; encabezados inertes en escritorio (`data-on` usado por dos cosas); barra de herramientas móvil demasiado alta; panel de columnas con las dos primeras filas colapsadas y la fila «Reclutador» sin su palomita; cajón tapado por las celdas fijas; enlaces de cifra de 17 px; bandeja de comparación que ocupaba 40 % del móvil; ruta de migas que se partía en móvil; «suficientes» partido por la mitad en la tabla móvil.

## Autorrevisión de UX (browse-and-compare, composition-and-feedback, adaptive-interfaces)

| Criterio | 01 Página propia | 02 Diálogo ancho | 03 Tarjetas y comparar |
|---|---|---|---|
| Representación según la tarea (comparar varios atributos) | tabla con encabezados agrupados; la fila es la persona | la misma tabla de hoy, con espacio | tarjetas con estructura común + matriz lado a lado para 2–3 |
| Identificador, valor clave y acción siempre visibles | nombre (con «N como responsable» / «Ex miembro») fijo a la izquierda, chevron fijo a la derecha | ídem; en móvil el nombre queda fijo y el grupo cambia con pestañas | nombre y chevron en el encabezado de cada tarjeta; «Comparar» al pie |
| Nada esencial detrás de hover | los encabezados ordenables son botones; las definiciones, un botón | ídem | ídem |
| Orden con etiqueta y estado | «Orden: …» en una línea de resultado (`role="status"`) y `aria-sort` | ídem | selector con nombre «Orden» y la misma línea |
| Filtros junto a los resultados, con conteo y chips quitables | receta «Filter bar with chips»: botón Proceso (con conteo) · separador · periodo segmentado · vista al final; chips con «Quitar» y «Limpiar filtros»; «6 personas…» | filtros heredados del tablero como chips quitables; periodo del tablero en el subtítulo | ídem 01 |
| Qué cubre cada columna | hoja «Qué mide cada columna» (definiciones v1 tal cual) | popover de 460 px (pantalla completa en móvil) | «Qué mide cada métrica» en hoja/cajón |
| Columnas a elección | `ChoiceList` múltiple por grupo, «Seleccionar todo» con conteo, fila fija «Reclutador» con su motivo, «Restablecer vista» | ídem, lista plana en el orden de hoy | «Métricas visibles», mismas reglas |
| Cero ≠ sin datos | «0 recibidas» y «0 nuevas» son ceros; «Sin datos suficientes» y «0 de 0» donde no hubo muestra | ídem | ídem |
| Estados | con datos, ordenada, columnas, ayuda, filtro de proceso (con la nota de qué columnas no cambian), periodo personalizado inválido, sin resultados (conserva y nombra los filtros), sin actividad, cargando (encabezados reales sobre esqueleto), error (qué falló, que nada cambió, «Reintentar»; conserva orden y columnas), ficha | ídem sin «periodo personalizado» (el periodo es del tablero) | ídem más «eligiendo» y «lado a lado» |
| Navegación fila → ficha y vuelta | nombre, chevron y fila; migas «‹ Métricas › Desempeño por reclutador › Persona»; volver conserva orden y columnas y devuelve el foco a la fila | el diálogo se cierra al navegar; volver lleva al tablero (no reabre el diálogo) | volver conserva orden, métricas y personas elegidas |
| Móvil sin panear cifras clave | fichas por persona con tres grupos y barra de entregas | pantalla completa, nombre fijo y un grupo de ≤ 3 columnas a la vez (pestañas con flechas) | tarjetas apiladas; la comparación se apila métrica por métrica con el nombre completo |
| Foco y teclado | foco al abrir paneles, Tab contenido, Esc cierra y devuelve el foco; región de la tabla enfocable | trampa de foco, Esc cierra el diálogo y devuelve el foco a «Ver tabla completa» | ídem; la bandeja anuncia «N de 3 elegidas» |
| Dueño y stakeholder | misma pantalla; el stakeholder solo cambia en la barra lateral (solo «Métricas») y en «Solo lectura»; un reclutador sigue con «Métricas restringidas» | ídem | ídem |

## Autorrevisión del sistema (design/system.md)

- **Colores usados:** solo tokens, en claro y oscuro (`--background`, `--foreground`, `--card`, `--popover`, `--primary`/`--primary-foreground`/`--primary-text`, `--muted`/`--secondary`/`--accent`, `--muted-foreground`, `--border`/`--input`, `--destructive`, `--brand-decorative-strong`, `--status-*`, `--sidebar*`, `--selection`, `--control-edge`, `--pf-tone-on-time`/`late`/`none`, `--pf-tint-base`); cero hex u `oklch()` fuera de las definiciones de tokens. `rgb(0 0 0 / .1|.3)` solo en sombras y velo (`shadow-*`, `bg-black/30`).
- **Paleta de entregas (regla 9):** a tiempo `--pf-tone-on-time`, tarde `--pf-tone-late`, vencida `--destructive`; cada barra lleva sus palabras y conteos (nunca solo color).
- **Familias:** pila del sistema como respaldo de Inter; sin mono.
- **Reglas aplicadas:** encabezado 24/600 con una frase de contexto y frescura en 12 muted (reglas 2 y 10), periodo como control segmentado (regla 11), receta «Filter bar with chips», tabla completa detrás de «Ver todos» (regla 12), ≥ 40 px de objetivo, cifras `tabular-nums` alineadas a la derecha, toda cifra que cuenta registros es un enlace con nombre accesible y un 0 no lo es (regla 16), estados con `SectionEmpty` (regla 15), móvil apilado en orden de lectura (regla 14), `ChoiceList` para elegir columnas, `Switch`/`Checkbox` no usados.
- **Desviaciones (para decidir antes de implementar):**
  1. **Celdas de la tabla que se parten** (01 y 02; hasta 3–4 líneas en Placements): `system.md` dice «Table … sin saltos de línea» y la tabla actual trunca con tooltip. Es lo que pide S1 (leer sin cortar); mismo criterio que la excepción de la tabla de Auditoría, que aquí habría que extender a esta tabla.
  2. **Encabezados agrupados** (`colgroup`: Carga de trabajo · Entrega de candidatos · Contratación) y **orden de columnas distinto** al de hoy en 01 (02 conserva el actual): patrón nuevo, sale de las secciones de la ficha.
  3. **Diálogo de 1392 × 852** (02): el `Dialog` del sistema mide 448 px; título 18/600 en vez de 16/500. Popover de 460 px como en la excepción de Auditoría.
  4. **Pantalla completa en móvil con pestañas de grupo y columna fija** (02) y **fichas con tres grupos** (01/03): patrones nuevos para una tabla de ocho columnas; la regla 14 dice «nombre + la cifra que importa + chevron», aquí el usuario pidió ver todas las columnas.
  5. **Tarjeta de persona, bandeja fija de comparación y botón «Comparar» con `aria-pressed`** (03): patrones nuevos; la selección usa el anillo y la marca de `--selection` y el foco su contorno propio. «Métricas visibles» / «Qué mide cada métrica» renombran «Columnas» / «Qué mide cada columna» porque no hay columnas.
  6. **«Entregas a tiempo» muestra porcentaje y «N de M»** (la tarjeta del tablero ya lo hace; la hoja actual solo mostraba el conteo). El orden por esa columna usaría el porcentaje (hoy `sorting.ts` ordena por el conteo `on_time`).
  7. **Guion blando (`&shy;`) en encabezados** como respaldo si la fuente real es más ancha que la de la captura.
  8. **Filtros heredados** (`Cliente o área`, `Reclutador`) solo se muestran como chips; en estas páginas solo se puede elegir «Proceso» y el periodo.
