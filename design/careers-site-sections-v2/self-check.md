# Autorrevisión: careers-site-sections-v2 (T1)

Revisión contra `design/system.md` (sección «Colors — public careers site», «Colors — careers hero», tipografía, radios,
botones) y `docs/frontend-ui-design-rules.md`, más la revisión en navegador real (Chromium de Playwright 1.62.1 desde
`frontend/node_modules`, `@axe-core/playwright`).

## Revisión en navegador (2026-11-25)

| Artboard | Viewport | axe wcag2a/aa/21a/21aa/22aa | Desbordamiento horizontal | Foco visible (14 Tab) | Movimiento reducido |
|---|---|---|---|---|---|
| 01 Editorial | 1440×900 | 0 en claro, oscuro, Terracota claro y Terracota oscuro | no (scrollWidth = clientWidth en las 4) | sí | cifras ya en valor final (+15, +300, 3, 12), 0 animaciones corriendo |
| 02 Bento moderno | 1440×900 | 0 en las 4 combinaciones | no | sí | cifras finales; fondo en movimiento en pausa; 0 animaciones |
| 03 Humano y fotográfico | 1440×900 | 0 en las 4 combinaciones | no | sí | cifras finales; tira de fotos detenida y deslizable a mano; 0 animaciones |
| 04 Editorial celular | 390×844 | 0 en las 4 combinaciones | no | sí | igual que 01 |
| 05 Bento celular | 390×844 | 0 en las 4 combinaciones | no | sí | igual que 02 |
| 06 Humano celular | 390×844 | 0 en las 4 combinaciones | no | sí | igual que 03 |
| 07 Editor | 1440×2178 | 0 | no | sí | sin movimiento |

Interacciones probadas con clics reales (01, 02, 03, 05): elegir «Logística y transporte» deja solo ese grupo y anuncia
«2 vacantes en Logística y transporte»; el chip «Área: …» lo quita y vuelve a «12 vacantes»; el carrusel avanza a
«2 de 3»; con 1 beneficio la tarjeta ocupa el 100 % del ancho; con 5, ninguna fila queda a medias. Sin errores de
JavaScript. Lo que se corrigió en la revisión: carrusel de 01 mostraba las tres diapositivas (`display: contents`
anulaba `hidden`); notas de estilo heredaban el color secundario (2.5:1 en oscuro); texto sobre la banda de marca en
Terracota oscuro (4.3:1) — se oscureció la marca a `#A8401B` y el secundario sobre marca subió a 90 %; en 05 los datos y
el botón de pausa tapaban «Conoce la empresa»; `dl` mal formado en cifras de 02; botón «Ver vacantes» y nombre de la
empresa se amontonaban en el encabezado del celular; siluetas de las fotos de ejemplo demasiado claras detrás del
titular en 03. Capturas en `/tmp/cs-design/` (página completa `NN-…-light-altavista.png`, pantalla inicial
`NN-…-viewport.png`, paleta Terracota en oscuro `NN-…-dark-terracota-viewport.png`).

Límite de la prueba: axe no mide contraste de texto sobre imágenes ni degradados (las portadas con foto o video, «Cifras»
de 03 y «Llamado a talento» de 01). Ahí el contraste se garantiza con el velo oscuro (`oklch(0.14 0.02 292 / α)`, el
mismo tono que `--pf-hero-scrim`) y se revisó a ojo en las capturas; en producción el editor debería medirlo (ver 07).

## Colores usados frente a los tokens

- **Sitio público (01–06):** solo los roles `--site-*` de `theme-tokens.ts`: page, card, muted, foreground, secondary,
  brand, on-brand, brand-text, band, accent, on-accent, ring, más `border = foreground 18 % sobre page` (como
  `site-theme.module.css`). Grupo Altavista usa marca `#1F3A5F` y acento `#1E7369`, medidos en la captura del sitio
  publicado (`/tmp/site-review/shots/11-public-full.png`); `band #E8E8F0` coincide con el 7 % que calcula `brandBand`.
  Terracota usa el preset de `palettes.ts` (`#9A3412`, `#7C3F58`, `#FFF7ED`).
- **Desviación — valores oscuros y de Terracota calculados a mano.** Los valores de tema oscuro (p. ej. marca
  `#34557F`, texto de marca `#9DB8DD`, acento `#5BBFAE`) y los de Terracota no salen de ejecutar `siteBrandTokens`;
  son aproximaciones que cumplen AA (axe 0). La implementación debe usar la función real, no estos hex.
- **Portadas y fondos con imagen:** botón blanco con tinta `oklch(0.2 0.03 292)` y su hover `oklch(0.93 0.01 292)`,
  borde blanco 75 % y texto secundario blanco 90 % (`--pf-hero-*` dice 88 %); scrim `oklch(0.14 0.02 292 / α)`.
- **Desviación — velo variable.** Hoy el scrim de portada es fijo (0.66). La propuesta S2/S3 lo vuelve un control de tres
  niveles (Suave 0.36, Medio 0.50, Fuerte 0.68); es un token nuevo que habría que agregar al contrato.
- **Fotos de ejemplo:** degradados `color-mix` de marca y acento con blanco y negro; siluetas en blanco con opacidad.
  Son marcadores, no imágenes reales; no van a producción.
- **Cromo del artboard (no es producto):** barra de controles y notas de estilo con `#1A1626`, `#F6F2FF`, `#2A2438`,
  `#C9C2DB`, `#C4B5FD`, `#6B6480`.
- **Editor (07):** tokens claros de la app (`--background`, `--card`, `--muted`, `--muted-foreground`, `--border`,
  `--primary`, `--selection`, `--control-edge`, `--sidebar`, `--status-success`, `--status-review`). La vista previa en
  miniatura usa los `--site-*` de Grupo Altavista.

## Tipografía

- **Desviación obligada por la skill (sin fuentes remotas):** Fraunces (par «editorial») se representa con la pila serif
  del sistema (`Iowan Old Style`, `Palatino`, `Georgia`); Plus Jakarta Sans (par «modern») e Inter (par «classic») con
  `system-ui`. Cada dirección corresponde a un par existente de `fonts.ts` / `font_pair`: 01 = editorial,
  02 = modern, 03 = classic. No se propone ninguna fuente nueva.
- Escalas: los titulares de sección van de 30 a 60 px y la portada de 44 a 104 px; más grandes que el `text-5xl/6xl`
  actual de `site-blocks.tsx`. Es intencional (S1 «más premium») y solo en el sitio público.

## Componentes, radios y otras desviaciones

- **Botones en píldora (03):** el sistema define `rounded-2xl` (18 px), no píldora completa. 03 usa píldora para un
  tono más cálido; 01 y 02 conservan 18 px. Decidir al elegir una dirección.
- **Radios grandes (03):** fotos y portada a 28–36 px frente a los 24 px de la tarjeta compartida. El sitio público
  tiene dirección de arte propia («Superficie oscura (hero)» lo deja fuera de esa regla), pero sigue siendo una
  desviación del radio de tarjeta.
- **Alto de botones:** 44 px en todo el sitio (`min-h-11`), por encima del `min-h-10` actual del sitio público.
- **Varias bandas de color de marca por página (02 y 03):** permitido en el sitio público; en la app sería contrario a
  «Superficie oscura (hero)».
- **Biblioteca en 07:** panel no modal anclado a la izquierda de unos 784 px, para que la vista previa siga visible y
  muestre dónde se inserta. El `Dialog` actual es `sm:max-w-2xl` y tapa la vista previa; el `Sheet` del sistema mide
  384 px. Es una composición nueva que requiere revisión.
- **Foco en 07:** contorno de 2 px `--primary-text` (regla de «Choice controls») en lugar del `ring-3 ring-ring/30` de
  los botones, que en gris 30 % no se distingue bien en capturas.
- **Contraste mostrado en 07** («7.4:1 en la zona más clara del video») es ilustrativo: describe cómo debería avisar el
  editor y no está medido.
- **07 solo en claro;** el editor real tiene modo oscuro y no se dibujó.
- **Contenido ilustrativo:** testimonios (Daniela Cantú, Jorge Ibarra, Paola Ríos), líderes, clientes («Constructora
  Sierra Alta», etc.) y reconocimientos son inventados y así se rotulan en cada artboard. Las cifras salen del contenido
  real (fundada en 2009, «más de quince años», «más de trescientos colaboradores», tres oficinas, 12 vacantes). Los
  títulos de vacantes con nombres de prueba («Auditoría A — …», «Vacante creada por reclutador», «Analista de pruebas
  de pipeline») se reescribieron con títulos plausibles; el resto son los 12 títulos, áreas y ubicaciones reales.
