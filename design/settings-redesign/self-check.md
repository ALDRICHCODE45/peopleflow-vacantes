# Autorrevisión · design/settings-redesign (T1 · S1 S3)

Fecha: 2026-11-24. Sin herramientas del canvas: los tres artboards se escribieron como HTML autocontenido y se revisaron en Chromium (Playwright de `frontend/node_modules`).

## Qué se ejecutó de verdad

| Comprobación | Alcance | Resultado |
|---|---|---|
| Render headless de cada artboard | 3 artboards × 1440×900 y 390×844 × claro y oscuro × 9 estados = 108 corridas, pantalla completa | sin errores de JS en consola |
| axe-core 4.13 (WCAG 2.0/2.1/2.2 A y AA, incluido contraste) | las mismas 108 corridas, solo dentro del marco | 0 violaciones al final (al principio: `definition-list`, `aria-allowed-attr`; corregidas) |
| Desbordes | elementos fuera del marco en horizontal, scroll horizontal de la página, texto con `ellipsis` o cortado | 0 |
| Objetivos táctiles | botones, enlaces, selects e inputs < 40 px (el control segmentado sigue la regla del sistema: ítems de 36 px dentro de 44, 40 px en móvil) | 0 |
| Flujos con clic y teclado (Playwright) | editar ubicación (quitar y guardar), cambiar Base de talento, marcar un reclutador, guardia de salida (clic y Escape), guardar | pasan en 1440 y 390 en las tres direcciones |
| Revisión visual | capturas de cada estado en claro y oscuro, en `/tmp/design-shots/` (fuera del repo) | ver «Corregido tras la revisión visual» en el informe de la tarea |

## Autorrevisión de UX (composition-and-feedback, adaptive-interfaces)

| Criterio | 01 Navegación lateral | 02 Resumen + secciones | 03 Lista tipo iOS |
|---|---|---|---|
| Jerarquía: un título por lugar, secciones con encabezado, etiquetas distintas del valor | título del panel 18/600 por sección; etiquetas 14 muted, valores 14/500 | franja con nombre 18/600 y hechos 12/14; filas 14/500 con descripción 12 | encabezados de grupo 12/600; fila 14/500 con valor a la derecha |
| Agrupar sin ruido: un contenedor por trabajo, sin tarjeta dentro de tarjeta | una tarjeta por sección; la lista de elección es el único marco interno (como `ChoiceList`) | una tarjeta por grupo, filas separadas con `divide-y` | un grupo = un contenedor |
| Estados: seleccionado, foco, deshabilitado, error | barra de 3 px + fondo para elegido; foco = contorno de 2 px dentro de la fila (nunca barra ni fondo) | ídem | ídem |
| Sin color como único canal | «Cambios sin guardar», «Activa», «Próximamente» siempre con texto | ídem | ídem |
| «Próximamente» explicado, no solo deshabilitado | interruptores deshabilitados con «Próximamente» visible junto al control (como hoy) | tarjeta propia, filas de texto sin controles | filas de texto con «Próximamente», nota al pie |
| Móvil: navegación y acción principal alcanzables | botón «Sección» + hoja con la lista; barra de guardado fija, botones de 44 px | hoja inferior para Base de talento y diálogo/hoja para ubicación | la misma lista; hojas inferiores |
| Estados de datos | cargando (esqueleto por sección), conflicto, selección vacía, guardado, salir sin guardar | ídem | ídem |
| Teclado y foco en superposiciones | el foco entra al diálogo/hoja, Tab queda dentro, Escape cierra y devuelve el foco al disparador; con cambios pendientes Escape pregunta | ídem | ídem |
| Movimiento | solo giro del chevrón y transición del interruptor, ambos apagados con `prefers-reduced-motion` | ídem | ídem |

## Autorrevisión del sistema (design/system.md)

- **Colores usados:** solo los tokens (`--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--primary-foreground`, `--primary-text`, `--secondary`/`--muted`/`--accent`, `--muted-foreground`, `--border`/`--input`, `--destructive`, `--status-review`, `--status-success`, `--status-danger`, `--sidebar`, `--sidebar-accent`, `--ring`, y `--sel`/`--on-sel`/`--edge` = tokens de selección), en claro y oscuro con los valores del sistema; cero hex u `oklch()` fuera de las definiciones de tokens. Sombras de Tailwind (`shadow-sm/md/lg/xl`) con negro al 10 % y el telón `bg-black/30`.
- **Familias:** pila del sistema (`system-ui, -apple-system, "Segoe UI", Roboto`) como respaldo de canvas de Inter; ninguna otra.
- **Reglas de componentes:** `ChoiceList` (fila completa como objetivo, barra de 3 px, marca final circular/cuadrada, «Seleccionar todo» con contador y estado indeterminado, motivo visible), `Switch` solo para on/off, `Dialog` 448 px, `Sheet` flotante de 384 px, `Drawer` en móvil, `AlertDialog`, `Badge` (`success` con punto, `review`, `neutral`), `Button` (rounded-2xl, 40/44 px), segmentado (`h-9` en 44), tarjeta de 24 px, avatar de 32 px, logo de 48 px `rounded-xl`, toast con `--popover`.
- **Desviaciones (para decidir):**
  1. 01 usa un riel de navegación propio con barra de 3 px para la sección actual (reusa el lenguaje de «fila seleccionada»; no es un componente del sistema).
  2. En la hoja de escritorio la lista de reclutadores va sin avatares para que el correo quepa en 384 px (el sistema permite avatar opcional).
  3. 02 y 03 quitan los interruptores deshabilitados de «Próximamente» y los reemplazan por filas de texto: cambia el patrón actual (SettingRow con `Switch disabled`).
