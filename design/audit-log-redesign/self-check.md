# Autorrevisión · design/audit-log-redesign (T2 · S2 S3)

Fecha: 2026-11-24. Sin herramientas del canvas: los tres artboards son HTML autocontenido con 190 eventos generados (Grupo Altavista, hora de la Ciudad de México) y se revisaron en Chromium (Playwright de `frontend/node_modules`).

## Qué se ejecutó de verdad

| Comprobación | Alcance | Resultado |
|---|---|---|
| Render headless | 3 artboards × 1440×900 y 390×844 × claro y oscuro × 13 estados = 156 corridas, pantalla completa | sin errores de JS |
| axe-core 4.13 (WCAG 2.0/2.1/2.2 A y AA, con contraste) | las mismas 156 corridas | 0 violaciones al final (al principio: `aria-required-children` en la lista de acciones; corregido) |
| Desbordes y recortes | fuera del marco, scroll horizontal, `ellipsis`, texto cortado | 0 (los `line-clamp` de la tabla son intencionales y el texto completo está en el detalle) |
| Objetivos táctiles | < 40 px (la equis de los chips se subió de 32 a 40 px) | 0 (excepciones: ítems del control segmentado, regla del sistema) |
| Flujos con clic y teclado | buscar persona («carlos») y elegirla, ver el chip con «ex miembro» y quitarlo; abrir detalle y cerrarlo con Escape; exportar con rango inválido (366 días) y válido; paginar o «Mostrar más» | pasan en 1440 y 390 en las tres direcciones |
| Revisión visual | capturas de cada estado en claro y oscuro (`/tmp/design-shots/`, fuera del repo) | ver el informe de la tarea |

## Autorrevisión de UX (browse-and-compare, composition-and-feedback, adaptive-interfaces)

| Criterio | 01 Barra en línea | 02 Panel lateral | 03 Línea de tiempo |
|---|---|---|---|
| Búsqueda y filtros junto a los resultados, con conteo y chips quitables | barra sobre la tabla; conteo «N eventos de 190»; chips completos con «Quitar» (aria-label y título) | panel a la izquierda; chips sobre la tabla; conteo | facetas en la cabecera que se vuelven chips; conteo |
| Ningún valor de filtro recortado | los selectores solo muestran nombre y contador; el valor entero está en el chip y en la lista (que parte líneas) | cada sección muestra su valor completo (varias líneas) | la faceta activa muestra el valor entero y se parte |
| «(ex miembro)» | etiqueta «Ex miembro» en la lista y la tabla; «(ex miembro)» en el chip | ídem | ídem, en la fila y el detalle |
| Acción: agrupada, con búsqueda | 75 acciones por categoría, búsqueda, «Elegir todas», conteo | ídem dentro del panel | ídem en el popover |
| Rango de fechas como un solo control | Hoy · 7 días · 30 días · Personalizado + popover Desde/Hasta con validación | sección con las mismas cuatro opciones | ídem; 7 días por defecto |
| Exportación con requisito visible | texto bajo el botón y panel con rango obligatorio y conteo | ídem con diálogo | ídem, atada al rango visible |
| Detalle y lectura completa | hoja con acción completa, fecha y hora, quién, sobre, vacante entera, IP, navegador, metadatos, ID | ídem | ídem |
| Paginación / carga | páginas (10 por página) | páginas | «Mostrar 30 eventos más» |
| Estados | con datos, filtros activos, selectores abiertos, rango, detalle, exportar, exportar con error, sin resultados (conserva filtros y ofrece limpiar), cargando (esqueleto con la forma de la fila), sin actividad (primer uso), error (con «Reintentar») | ídem | ídem |
| Móvil | filas condensadas + «Filtros (n)» en hoja inferior con subvistas | tarjetas + hoja con el mismo panel | la propia línea de tiempo; selectores en hojas |
| Foco y teclado | foco al abrir, Tab contenido, Escape cierra y devuelve el foco | ídem | ídem |

## Autorrevisión del sistema (design/system.md)

- **Colores usados:** solo tokens, en claro y oscuro (`--background`, `--foreground`, `--card`, `--popover`, `--primary`/`--primary-foreground`/`--primary-text`, `--muted`/`--secondary`/`--accent`, `--muted-foreground`, `--border`/`--input`, `--destructive`, `--status-review`, `--status-success`, `--status-danger`, `--sidebar*`, `--sel`/`--on-sel`/`--edge`); cero hex u `oklch()` fuera de las definiciones de tokens.
- **Familias:** pila del sistema como respaldo de Inter; **`ui-monospace`** solo para IP, identificadores y códigos de evento (igual que `audit-columns.tsx` con `font-mono`), que `system.md` no lista.
- **Reglas de componentes aplicadas:** encabezado de página 24/32 600 con resumen en una línea (reglas de página del candidato), `Badge neutral` para «Solo el dueño», segmentado para el rango, `Popover`/`Dialog`/`Sheet`/`Drawer`, filas de elección (`ChoiceList`) con marca final, `SectionEmpty` para «Sin resultados», vacío y error, esqueleto con la forma del contenido, toast con `--popover`.
- **Desviaciones (para decidir antes de implementar):**
  1. **Tabla con texto que se parte** (hasta 3 líneas en la vacante, 2 en la dirección 2): `system.md` dice «Table … sin saltos de línea». Es lo que pide S2; el texto completo está siempre en el detalle.
  2. **Popover de 360–460 px** para los selectores (el sistema fija 288 px): hace falta para nombres y títulos completos.
  3. **Chips con radio 14 px** y texto en varias líneas (el sistema usa `rounded-full` para chips de una línea).
  4. **Faceta-chip de la dirección 3** (disparador + valor + equis) es un patrón nuevo.
  5. «Exportar CSV» siempre habilitado, con un panel que exige el rango: cambia el comportamiento actual (botón deshabilitado + aviso).
  6. El selector de filas por página mide 40 px (el de la tabla actual es `size="sm"`, 32 px).
