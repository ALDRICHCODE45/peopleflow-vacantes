# Prompt v0: tablero del pipeline y ficha del candidato

Prompt para generar en v0 una referencia visual del tablero del pipeline y de la ficha del
candidato. v0 no conoce este proyecto: todo lo que necesita está en el bloque de abajo.
El resultado se usa como referencia; el frontend porta las decisiones visuales a sus
componentes y conserva su lógica (bloqueos, recargas, confirmaciones, contratos).

```text
Diseñá dos pantallas de un ATS (sistema de reclutamiento) B2B para empresas de México, en
español (es-MX), con calidad de producto SaaS pulido (referencias de nivel: Linear, Attio,
Height). Es una sola página de demostración con datos de ejemplo que muestra:
(1) el tablero kanban del pipeline de una vacante y (2) la ficha lateral (Sheet) del
candidato abierta sobre el tablero. Incluí un toggle de tema claro/oscuro para ver ambos.

## Stack y restricciones técnicas
- Next.js App Router + React + TypeScript + Tailwind CSS v4 + shadcn/ui (variante Base UI,
  los componentes usan la prop `render` para composición) + lucide-react.
- Usá SOLO estos primitives de shadcn/ui: accordion, avatar, badge, button, card, checkbox,
  dialog, drawer, dropdown-menu, empty, field, input-group, item, progress, select,
  separator, sheet, skeleton, spinner, table, tabs, textarea, toggle-group, tooltip.
  No agregues otras librerías de UI ni de animación.
- Nada de colores hex/oklch dentro de los componentes: solo clases con tokens semánticos
  (bg-background, bg-card, text-muted-foreground, border-border, text-primary, etc.) y los
  tokens de estado de abajo. Definí los tokens una sola vez en globals.css.
- Tipografía: Inter para TODO (títulos y cuerpo), cargada con next/font. Sin fuentes
  display. Jerarquía por tamaño y peso: título de página 20px/600; título de sección
  15–16px/600; títulos de sección de la ficha como etiqueta en mayúsculas pequeñas
  11–12px/500 con tracking amplio y color muted; cuerpo 14px/400; metadatos 12–13px muted;
  números con tabular-nums.
- Radio base 0.625rem (cards = radius-xl, controles = radius-md, badges = full).

## Paleta (tokens exactos)
Claro:
--background #F7F5FB; --foreground #1A1626; --card #FFFFFF; --popover #FFFFFF;
--primary oklch(0.491 0.27 292.581) (violeta de marca); --primary-foreground
oklch(0.969 0.016 293.756); --secondary/--muted/--accent #F1EEF7; --muted-foreground
#6B6480; --border/--input #E4DFF0; --destructive oklch(0.577 0.245 27.325);
--status-info oklch(0.45 0.16 250); --status-review oklch(0.47 0.12 70);
--status-success oklch(0.46 0.13 152); --status-danger oklch(0.45 0.2 25).
Oscuro:
--background #0C0912; --foreground #F6F2FF; --card #15121F; --popover #1A1626;
--primary oklch(0.432 0.232 292.759); --secondary/--muted/--accent #171226;
--muted-foreground #A79FBF; --border #262233; --destructive oklch(0.704 0.191 22.216);
--status-info oklch(0.78 0.12 245); --status-review oklch(0.82 0.12 78);
--status-success oklch(0.78 0.14 155); --status-danger oklch(0.75 0.15 22).
Los tokens de estado son de intensidad "texto": se usan como texto/borde/punto sobre un
fondo del mismo token al 10–14% de opacidad (badges, acentos de columna). El violeta es
identidad de marca: usalo en la acción principal y foco, no como decoración.

## Pantalla 1: tablero del pipeline de una vacante
Contexto: la vacante «Software Developer» está publicada («Activa»). Un reclutador mueve
candidatos entre etapas configuradas por la empresa.

Encabezado de página (compacto, una sola banda):
- Breadcrumb «Vacantes / Software Developer» con badge «Activa».
- Título «Pipeline» y, en la misma línea o debajo en muted, «Publicada el 17 oct 2026».
- A la derecha: indicador de cobertura compacto (no una card de ancho completo):
  «1 de 2 plazas cubiertas» con una barra de progreso fina; y un botón de ícono
  «Configuración de la vacante» (tuerca) con tooltip.
- Regla de cobertura: si la cobertura está completa mostrar «Cobertura completa» en verde
  con la fecha; si se alcanzó antes pero ya no está completa, NO decir «completa»: mostrar
  una nota discreta «Se completó el 17 oct 2026» en muted junto al conteo actual. Si no
  hay plazas definidas: «1 plaza cubierta» sin «de Y».

Columnas (scroll horizontal; ninguna columna se corta contra el borde; ancho fijo
~280–300px; la altura sigue al contenido, no altura fija):
1. «Nuevos» (tipo new) — 3 candidatos
2. «Screening» (tipo screening) — 2
3. «Screening OK» (tipo screening_ok) — 0 (vacía)
4. «En proceso» (tipo in_process) — 1, con una tarjeta en estado "moviendo" (spinner y
   bloqueada)
5. «Placement» (tipo placement) — 1
6. «Descartados» (columna de salida, solo lectura) — 2
Encabezado de columna: punto o acento de color según el tipo + nombre + contador en
badge. NO repetir el nombre de la columna en otro badge debajo. Colores por tipo: new =
neutral, screening = info, screening_ok = review, in_process = primary/violeta suave,
placement = success, custom = neutral, Descartados = danger. La columna Descartados lleva
un ícono de candado pequeño con tooltip «Se llega descartando, no moviendo».
Columna vacía: un hueco discreto de ~96px con borde punteado y el texto
«Sin candidatos en esta etapa» (una línea, muted). Nada de íconos grandes ni párrafos.

Tarjeta de candidato (densa, legible, todo dato real; NO inventes puntajes, habilidades,
títulos profesionales, ratings ni fotos):
- Fila 1: Avatar con iniciales (2 letras, tamaño 32px) + nombre completo en 14px/500 con
  máximo 2 líneas y truncado; a la derecha botón de ícono «⋯» (acciones).
- Fila 2 (metadatos con ícono, 12px muted): «Postuló 17 oct» y «En la etapa desde 18 oct».
- Fila 3: chip de archivo del CV: ícono según tipo (PDF/DOCX) + nombre del archivo
  truncado (ej. «CV-Ana-Perez.pdf»).
- En Descartados: en lugar de la fila 3, badge danger con el motivo («No cumple
  requisitos») y el grupo en muted («Decisión de la empresa»).
- Manija de arrastre (ícono grip) visible al hover/focus, no permanente; la tarjeta
  entera abre la ficha al hacer clic.
- Menú «⋯»: grupo «Mover a…» con solo los destinos permitidos (la columna siguiente y
  cualquiera anterior; las que saltan etapas no aparecen), separador, «Ver ficha», y
  «Descartar» en rojo. En una tarjeta descartada: «Recuperar» y «Ver ficha».
- Estado moviendo: opacidad reducida + spinner pequeño, sin cambiar el tamaño.
- Durante el arrastre: las columnas que no aceptan el destino se atenúan; la que acepta
  muestra borde primary punteado.

## Pantalla 2: ficha del candidato (Sheet lateral derecho, ~560px; ancho completo en móvil)
Encabezado de identidad (fijo arriba):
- Avatar con iniciales 48px + nombre (18px/600) + badge de la etapa actual con su color.
- Debajo en muted: «Postuló el 17 oct 2026 · Fuente: Orgánica».
- Acciones arriba a la derecha: botón outline «Mover a…» (menú con destinos permitidos),
  botón «Descartar» (destructive outline) o «Recuperar» si está descartado, y botón de
  cerrar (X). Un solo cierre; nada de botón «Cerrar» en el pie.
Pestañas debajo del encabezado (con contador cuando aplica):
- «Resumen»: grilla de 2 columnas etiqueta (12px muted) / valor (14px/500): Etapa actual,
  En la etapa desde, Postulación, Fuente. Sección «CV» con tarjeta de archivo (ícono del
  tipo, nombre, botón de ícono «Descargar» con tooltip). Si está descartado, una sección
  «Descarte» destacada con superficie danger suave: motivo, grupo, etapa anterior,
  «Comentario interno» y «Mensaje para el candidato» (este último con una nota «El
  candidato ve este mensaje con el estado Finalizada»).
- «Respuestas (3)»: lista de preguntas de filtro; cada una con la pregunta en 13px muted y
  la respuesta en 14px; sin puntajes ni correcto/incorrecto. Estado vacío de una línea:
  «Esta postulación no tiene preguntas de filtro».
- «Historial (4)»: línea de tiempo vertical con puntos de color según el evento y una
  línea que los une; cada evento: título («Postulación recibida», «Screening → En
  proceso», «Descarte», «Recuperación»), autor con avatar de iniciales 20px y su rol
  («Reclutador» / «Candidato»), fecha corta «17 oct 2026, 14:32». Badges pequeños
  «Contratación» o «Salida de Placement» cuando aplique.
Estados de la ficha: skeleton mientras carga cada pestaña; error con «Reintentar».

## Diálogo de ejemplo (mostralo abierto en una variante o botón)
«Descartar a Ana Pérez»: motivo con dos grupos («Decisión de la empresa»: No cumple
requisitos, Perfil no adecuado, Expectativa salarial, Seleccionamos a otra persona, Otro;
«Decisión del candidato»: Aceptó otra oferta, Ya no le interesa, Sin respuesta del
candidato, Otro); «Comentario interno» (obligatorio con Otro, contador 0/1000);
«Mensaje para el candidato» opcional (contador 0/500) con la nota de que lo verá con el
estado «Finalizada»; botones «Cancelar» y «Descartar candidato» (destructive).

## UX y accesibilidad (obligatorio)
- Targets de al menos 40×40px; foco visible con anillo; el color nunca es la única señal
  (siempre texto o ícono además del color).
- Todo nombre largo trunca con tooltip; nada se desborda ni se corta.
- Ritmo de espaciado consistente (escala de 4px); densidad de herramienta de trabajo, no
  de landing: sin aire desperdiciado, sin cajas gigantes con poco contenido.
- Profundidad intencional: lienzo background, columnas en muted/secondary suave sin borde
  pesado, tarjetas en card con sombra sutil; nada de bordes finos iguales en todas las
  cajas.
- Iconografía lucide coherente (16px en metadatos, 14px en chips).
- Responsive: en móvil el tablero hace scroll horizontal con snap por columna y la ficha
  ocupa todo el ancho.
- Texto en español neutro de México, sentence case, sin signos de exclamación.

## Datos de ejemplo
Usá nombres latinos realistas (Ana Pérez, Luis Hernández García, María Fernanda López
Ortiz, Jorge Ramírez, Sofía Castillo, Diego Torres Medina, Valeria Ruiz, Carlos Mendoza,
Fernanda Navarro). Fechas de octubre de 2026. Archivos CV en PDF y DOCX.
```
