# Autorrevisión · design/notification-emails (U1 · S1)

Fecha: 2026-11-26. Cuatro artboards HTML autocontenidos (CSS y JS en línea, sin URLs externas ni fuentes remotas) y 15 correos
de muestra en `samples/` (3 direcciones × T8, T2, T12, T15, T17). Todo sale de una sola fuente: `_src/email.mjs` (renderizador de
correo), `_src/templates.mjs` (datos y matriz T1–T17), `_src/build.mjs` (artboards y muestras); `_src/check.mjs` es la revisión.

Nota de proceso: los dos archivos de skill indicados (`skills/design/SKILL.md`, `skills/gentle-ui-design/SKILL.md`) siguieron
bloqueados por la política de seguridad incluso después de la autorización; se trabajó con `design/system.md`, el brief y las
convenciones de `design/notifications/` (design.json + artboards numerados + self-check.md), como indicó el padre.

## Qué se ejecutó de verdad

| Comprobación | Alcance | Resultado |
|---|---|---|
| Render headless y errores de JS (Chromium de `@playwright/test` en `frontend/node_modules`) | 4 artboards × claro y oscuro, viewport 1440 | 0 errores |
| axe-core (wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, con contraste; incluye el contenido de los iframes de correo) | 8 corridas, página completa | 0 violaciones. Al principio, 1 `scrollable-region-focusable` en 04 (bloques `<pre>` con scroll); corregido con `tabindex="0"` y nombre accesible |
| Desborde horizontal | página a 1440; cada iframe de correo (720 escritorio, 375 teléfono) | 0 |
| Modo oscuro real, sin la clase de vista previa | `samples/01-t8`, `02-t12`, `03-t17` con `colorScheme: dark` y `light` a 375 px | `@media (prefers-color-scheme: dark)` aplica fondo `#0C0912` / `#15121F` y título `#F6F2FF`; en claro, `#F7F5FB` / `#FFFFFF` y `#1A1626`; botón a todo el ancho (309–311 px); sin scroll horizontal |
| Contraste calculado (WCAG 2.x) | 46 pares de texto/fondo en claro y oscuro (tabla completa en 04) | todos ≥ 4.5 : 1 (mínimo 4.87 : 1, secundario sobre superficie tranquila en claro) |
| Copia | asunto, título, línea de cuerpo, botón de T2, T8, T12, T15, T17; F1, F2 | comparada a mano con `notifications-stage2-email-copy.md`: literal, solo con variables llenas; el énfasis (`<strong>`) no cambia palabras |
| Revisión visual | capturas por sección y tema en `_review/` | ver abajo |

### Corregido tras la revisión visual

- Tarjetas y etiquetas mostraban un borde cuadrado por fuera del fondo redondeado: el reset `border-collapse:collapse` anulaba
  `border-radius` en celdas con borde. Se cambió por `border-spacing:0` (las tablas ya llevan `cellspacing="0"`).
- Los iframes medían como mínimo su alto inicial (600 px) y dejaban huecos; ahora se miden por el contenido del correo.
- La estructura de Go usaba `ToneName` en el esqueleto sin declararlo; añadido.

### Límites de la revisión

- Solo Chromium. No se probó en Outlook de escritorio, Gmail (web y app), Apple Mail ni Outlook.com: el VML del botón, las reglas
  `[data-ogsc]`/`[data-ogsb]` y la inversión forzada de Gmail están escritas según la práctica conocida, sin verificar. Antes de
  implementar, enviar `samples/` a Mailpit y a una herramienta tipo Litmus / Email on Acid.
- La máquina de revisión no tiene Arial Black: en las capturas «people» sale en la sans de respaldo; en macOS y Windows se verá más
  pesado y más cercano al wordmark.
- `_review/` (capturas y `report.json`) es salida de la revisión dentro de la carpeta; se puede borrar sin afectar los artboards.

## Autorrevisión de UX

| Criterio | Cómo se cumple |
|---|---|
| Lo importante primero | marca → tipo/urgencia → título → una línea → un botón; ninguna dirección pasa de una pantalla de teléfono por encima del botón |
| Urgencia sin depender del color | «Vencida» siempre como palabra; además rojo de estado en la etiqueta, la fecha (01, 03), la franja (02) o la barra (03) |
| Obligatorio frente a opcional | «Obligatorio» en neutro (no compite con la urgencia) + pie F2 sin enlace de baja; los opcionales llevan F1 con «Dejar de recibir este tipo de correo» |
| Agrupado frente a individual | el agrupado repite el conteo del asunto; 02 y 03 lo ponen además en el mosaico / sello |
| Candidato | tono violeta suave y la empresa como identidad (monograma + nombre) antes del título; sin vocabulario interno |
| Privacidad | ningún nombre de candidato ni de integrante; el remitente es PeopleFlow |
| Lector de pantalla | `lang="es-MX"`, tablas `role="presentation"`, contenedor `role="article"`, título en `<h1>`, mosaicos y sellos `aria-hidden`, marca con `aria-label="PeopleFlow"` |
| Objetivos | botón de 48 px (52 en 03), a todo el ancho en teléfono; enlaces del pie de 18 px de línea separados por « · » |
| Imágenes bloqueadas | no hay imágenes: el correo se ve igual con imágenes apagadas |

## Desviaciones respecto a design/system.md (para decidir)

1. **Tipografía de correo**: cuerpo 16/26 (17/28 en 03) y título 24/32 o 28/36 a 700; el producto usa cuerpo 14 y títulos 500–600.
   En correo, 14 px se lee pequeño en el teléfono y el título tiene que ganar en una bandeja.
2. **Inter no se carga**: sin fuentes remotas, Inter solo aparece si está instalada; el respaldo es la pila del sistema.
3. **Marca como texto**: «people» en Arial Black 900 y «flow» en Georgia cursiva violeta, aproximando el wordmark aprobado (imagen
   WebP en el producto; WebP no se ve en Outlook).
4. **Colores en hex**: los tokens `oklch()` se convirtieron a sRGB (`--primary` → `#7008E7`, oscuro `#5D0EC0`; `--primary-text` oscuro
   → `#A28CED`; estados → `#A9000C`, `#844C00`, `#0055A9`, `#006B30` y sus oscuros). Los tintes (10 %, 6 %, borde 40 %) se materializan
   en hex con la misma mezcla que `Badge`.
5. **Botón**: 48–52 px de alto, 16/600; el `Button` del sistema es 14/500 con `min-h-10/11`. Mismo radio (18 px) y mismo violeta.
6. **Botón en oscuro**: `--primary` oscuro (`#5D0EC0`) queda ~2 : 1 contra la tarjeta oscura, como en el producto; el texto tiene 8.3 : 1.
7. **Tarjeta sin sombra**: borde de 1 px `--border` en lugar de `shadow-sm` + anillo (las sombras no son fiables en correo).
8. **Etiqueta de urgencia rellena**: «Vencida» va rellena en el tono de estado; las variantes semánticas de `Badge` son tinte + borde.
   Se rellenó para que gane a la etiqueta de tipo; si se prefiere, puede usar la receta de `Badge` sin perder contraste.
9. **Patrones nuevos**: mosaico de tipo de 48 px y franja teñida (02), sello circular de 64 px y barra superior de 4 px (03),
   monograma de la empresa (las tres). Reutilizan tonos de estado fuera de un `Badge`, como la fila de notificación de
   `design/notifications` (desviación 4 de esa carpeta).
10. **Franja teñida a todo el ancho (02)**: tinte claro del tono, no la superficie oscura; la regla «Superficie oscura (hero)» no
    aplica, pero el sistema no tiene franjas teñidas en producto.
11. **Outlook de escritorio**: sin radios ni círculos; tarjeta, etiquetas, mosaicos y sellos quedan cuadrados.

### theme-tokens.ts

`frontend/src/features/company-site/public/theme-tokens.ts` (`SITE_THEME_SURFACES`) tiene las mismas superficies que
design/system.md (`#F7F5FB`/`#FFFFFF`, `#0C0912`/`#15121F`); lo demás que genera son colores de marca de cada empresa para su
sitio de empleo. Los correos usan la marca de PeopleFlow, no la de la empresa, así que no afecta. Solo importaría si se decidiera
pintar los correos de candidato con el color de la empresa (no se propone aquí).

## Microcopia nueva (por aprobar)

Antetítulos y etiquetas: «Postulaciones», «Pruebas», «Entrega», «Asignación», «Equipo», «Vencida», «Vence pronto», «Obligatorio».
Línea legal «PeopleFlow · [Dirección postal de PeopleFlow]» (falta la dirección). Preheader = la línea de cuerpo acordada, sin
palabras nuevas.
