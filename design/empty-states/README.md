# Estados vacíos

E3 de [empty-states](../../odd/tasks/empty-states.md), S1–S4. **Solo diseño**, pendiente de aprobación: no modifica producto ni datos. Cuatro HTML autónomos, light, 1440 px de ancho. Sigue `design/system.md`, especialmente «Empty states», y la referencia del pipeline en borrador. Cada entrada incluye contexto, `file:line`, variante y «Antes».

## Artboards

- `00-anatomia.html` — cinco variantes lado a lado: página/sección, dentro de tarjeta, sin resultados, nada seleccionado y excepciones compactas. Tamaños, tonos, copy y acciones anotados.
- `01-empresa.html` — primera visita y paneles de empresa; 19 entradas (18 propuestas y una exclusión razonada de Entrega).
- `02-candidato.html` — siete marcos; distingue búsqueda con texto de filtro sin texto, y conserva los límites reales de carga.
- `03-publico.html` — cinco marcos; distingue empresa sin publicaciones, catálogo vacío y filtros sin coincidencias. Incluye la simulación del editor, no una ruta pública nueva.

El manifiesto enlaza el feature y usa las alturas completas medidas en Chrome. No son alternativas entre las que elegir: cada entrada propone un solo tratamiento.

## Propuestas: pantalla → título → acción principal

### 00 · Anatomía

| Pantalla / variante | Título | Acción |
|---|---|---|
| Vacantes / página | Todavía no hay vacantes | Crear vacante |
| Ficha / tarjeta | Todavía no hay respuestas | Ver resumen |
| Talento / sin resultados | Sin resultados | Limpiar filtros |
| Checklist / nada seleccionado | Selecciona un criterio para verlo aquí | Sin botón |
| Pipeline, campo, combobox / compacto | Sin candidatos en esta etapa / Sin dato / Sin coincidencias. | Sin botón |

### 01 · Empresa

| Pantalla | Título | Acción |
|---|---|---|
| Vacantes, primera visita | Todavía no hay vacantes | Crear vacante |
| Base de talento | Todavía no hay candidatos | Ir a mis vacantes |
| Talento, fallback de tabla filtrada | Sin resultados | Limpiar filtros |
| Equipo | Todavía no hay miembros del equipo | Ver configuración |
| Ficha del pipeline, respuestas | Todavía no hay respuestas | Ver resumen |
| Ficha del pipeline, historial | Todavía no hay actividad registrada | Ver resumen |
| Ficha del pipeline, checklist | Esta vacante todavía no tiene criterios | Agregar criterio |
| Psicometría, invitación | Aún no hay evaluación | Invitar a evaluación |
| Resultado, focos | No hay focos para esta comparación | Ver competencias |
| Resultado, guía | Esta comparación no tiene preguntas | Ver competencias |
| Checklist, detalle sin criterio | Selecciona un criterio para verlo aquí | Sin botón |
| Editor de carreras, propiedades | Selecciona una sección para verla aquí | Sin botón |
| Editor, colección de beneficios | Todavía no hay beneficios | Agregar beneficio |
| Editor, sección en blanco | Nuestra historia todavía no tiene contenido | Completar sección |
| Ficha de talento, activos | No tiene procesos activos | Ver todos los procesos |
| Ficha de talento, todos | Todavía no tiene procesos | Ver resumen |
| Ficha de talento, historial | Todavía no hay cambios | Ver resumen |
| Dashboard, vacantes activas | Todavía no hay vacantes activas | Ver mis vacantes |
| Entrega | Sin propuesta: vacío no alcanzable | Ninguna |

La colección usa el mismo marco con sustantivo, icono y límites propios: valores → «Todavía no hay valores» → Agregar valor (1–8); cifras → «Todavía no hay cifras» → Agregar cifra (1–6); proceso → «Todavía no hay pasos» → Agregar paso (2–8); galería → «Todavía no hay fotos» → Agregar foto (2–12); testimonios → «Todavía no hay testimonios» → Agregar testimonio (1–6); oficinas → «Todavía no hay oficinas» → Agregar oficina (1–20); FAQ → «Todavía no hay preguntas frecuentes» → Agregar pregunta (1–20). Beneficios: 1–24. El board anota el copy específico de cada colección.

Entrega: `fulfillmentSchema` exige objetivo positivo y `candidates.length === target`. El otro uso, confirmación, solo abre con `would_fulfill`; por tanto, ninguno admite cero candidatos válidos. No inventar un panel pendiente ni mostrar un vacío como entrega cumplida.

### 02 · Candidato

| Pantalla | Título | Acción |
|---|---|---|
| Postulaciones, query no vacía | Sin resultados | Limpiar filtros |
| Postulaciones, solo filtro | Sin resultados | Limpiar filtros |
| Perfil, estudios | Todavía no agregas tus estudios | Agregar estudio |
| Postular, CVs = 0 | Todavía no tienes un CV | Subir CV |
| Dashboard, sin CV principal | Aún no hay un CV principal | Ver mis CVs |
| Evaluaciones pendientes | No tienes evaluaciones pendientes | Ver mis postulaciones |
| Evaluaciones adicionales | No tienes evaluaciones adicionales | Explorar vacantes |

No citar `query.trim()` si está vacío. Buscar y contar solo sobre las postulaciones cargadas; conservar Cargar más cuando hay cursor. Límites de CV tomados de `library.limits`, no números ficticios. Los vacíos de evaluaciones solo se muestran tras lectura exitosa, nunca desde carga o error.

### 03 · Público

| Pantalla | Título | Acción |
|---|---|---|
| Carreras de empresa, sin vacantes | Por ahora no hay vacantes abiertas | Explorar vacantes en PeopleFlow |
| Carreras de empresa, filtros | Sin resultados | Limpiar filtros |
| Catálogo, sin filtros ni cursor | Todavía no hay vacantes publicadas | Ir al inicio |
| Catálogo, query/filtros | Sin resultados | Limpiar filtros |
| Editor, simulación de cuestionario | Todavía no hay preguntas | Editar preguntas |

La ausencia al final de un cursor no prueba catálogo vacío: volver al inicio de la búsqueda conservando filtros. Editar preguntas solo aparece si existe `onEditQuestions`. Las secciones públicas opcionales sin contenido siguen omitidas.

## «requiere backend» y decisiones abiertas

- **Invitar miembro requiere backend**: no existe ese flujo en TeamPage; el diseño ofrece únicamente Ver configuración, no un botón falso de invitación.
- **Marcar CV principal requiere backend**: `candidate-cvs/model.ts` no expone el campo ni la escritura; se ofrece revisar los CVs, nunca seleccionar principal desde este diseño.
- Confirmar la utilidad de mantener visible **Evaluaciones adicionales** cuando no hay invitaciones independientes. La propuesta es un vacío explícito, sin duplicar vacíos dentro de cada postulación sin evaluación.
- Confirmar si **equipo sin miembros** es alcanzable con membresía válida. El marco es defensivo; no trata un error de lectura como vacío.

No se propone envío automático de correos, suscripciones, importación masiva, postulación espontánea ni vinculación de candidatos a vacantes desde la ficha.

## Comprobación

Excepción TDD: entregable visual estático, sin comportamiento de producto; no corresponde RED/GREEN de tests de aplicación. Validado con Node 22.23.4 y Playwright (`/tmp/t12qa/lib.mjs`, Chrome), viewport 1440 × 1000, capturas full-page:

- `/tmp/t12qa/empty/00-anatomia.png` — 1440 × 1161
- `/tmp/t12qa/empty/01-empresa.png` — 1440 × 8191
- `/tmp/t12qa/empty/02-candidato.png` — 1440 × 3224
- `/tmp/t12qa/empty/03-publico.png` — 1440 × 2646

Cero errores de consola/página, cero solicitudes externas, cero scripts y cero objetivos de acción menores de 40 px. Sin desbordamiento horizontal. Capturas revisadas visualmente. Solo colores/tipografía del sistema: background, foreground, card, primary, primary-foreground, muted, muted-foreground, border; anatomía también ilustra destructive/10. Mezclas informativas primary/10. Fuentes visibles system UI; foco visible, sin animación ni `innerHTML`.

**Canvas:** [Estados vacíos](http://127.0.0.1:50705/srxekv_Wfc6d-H8d2t-JyTnkRteCBwGp/d/empty-states/), abierto y actualizado por el padre mediante `gentle_design open empty-states` (herramienta no expuesta a este agente). La entrada del Log ODD corresponde al padre porque `odd/tasks/empty-states.md` está fuera de la superficie autorizada.
