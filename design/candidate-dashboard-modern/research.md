# Dashboard del candidato moderno: investigación

Spec: `odd/tasks/candidate-dashboard-modern.md` (T2 · S1, S3, S5). Fecha: 2026-11-18.

## 0. Datos que existen (la propuesta no usa nada más)

- **Postulaciones** (`features/candidate-applications/model.ts:25`, límite 50): para cada una hay vacante (`title`, `state` open/closed), empresa, `applied_at`, `updated_at?`, `first_response_at?` (puede ser null), `status` (`submitted` | `in_process` | `closed`), `message` y `message_read_at`. **No hay historial de eventos** ni etapas como entrevista u oferta. Una línea de tiempo solo puede mostrar el estado actual y la fecha del último cambio de cada postulación.
- **Evaluaciones** (`features/psychometrics/model.ts:30-35`): vacante, empresa, `status`, `expires_at`, `answered_count`/63 y `estimated_minutes` = 10. Con esto se puede dibujar un anillo de progreso real.
- **Perfil**: porcentaje de completitud y lista de lo que falta (`profileCompleteness`).
- **CVs**: total, `max_cvs` y cuántos están `in_use`.
- **Vacantes guardadas**: la API existe (`features/saved-vacancies/model.ts:6`, `saved_at`), pero **el dashboard no la carga hoy**. Usarla implica añadir una lectura más; el backend no tiene que cambiar.
- **Derivados** (`features/candidate/dashboard/insights.ts`): postulaciones por semana, este mes frente al anterior, distribución por estado, porcentaje que avanzó a proceso y días hasta la primera respuesta.
- **Demo de Valeria**: 4 postulaciones, todas de hoy, 3 guardadas y 1 mensaje sin leer. La serie semanal tiene una sola barra y la de respuestas probablemente sale vacía.

## 1. Problemas concretos del dashboard actual

1. **El banner «Pendientes» parece antiguo.** Es una tarjeta con `border-l-3 border-l-primary`, encima del saludo, con título, descripción y badge (`candidate-dashboard-overview.tsx:76-77`). Es el patrón de «alert box» de hace una década y abre la página con un aviso en lugar de una voz. Además, el mismo total aparece tres veces: en el badge del banner, en el KPI «Por atender» y en la frase del encabezado.
2. **El encabezado no aporta nada.** «… y tres formas de entender cómo va tu búsqueda» describe la interfaz en vez de dar un dato.
3. **Las 4 KPI pesan igual.** Todas llevan icono en un cuadro tintado y la cabecera mide `h-24` en móvil. No hay un elemento protagonista, en contra de la regla 5 de `design/system.md`.
4. **La primera gráfica tiene trece semanas casi vacías.** Muestra unas trece semanas de barras apiladas (`charts.tsx:42`) y con 4 postulaciones de hoy queda una barra alta, un eje 0–4 y una leyenda de 3 colores. También mezcla tiempo (la semana en que postulaste) con estado actual: una postulación enviada hace 2 meses aparece hoy como «En proceso».
5. **El estado se repite cuatro veces.** Aparece en el subtexto del KPI, en el donut, en su leyenda propia y en la tarjeta «Estado de tus postulaciones» (tres `Progress` genéricos, `charts.tsx:66-70`). Esta última no responde ninguna pregunta nueva.
6. **Tres tarjetas iguales con preguntas coloquiales como título** (`min-h-80` + gráfica de 240 px). Pie de página con prosa («no predice contratación»), en contra de la regla 7.
7. **La gráfica de respuesta casi siempre está vacía.** Es un histograma que necesita varios `first_response_at`. Con pocos datos el candidato ve sobre todo estados vacíos.
8. **El donut tartamudea (S2).** El `<Pie>` no fija `isAnimationActive` ni `animationDuration`, y `distribution` se recrea en cada render. El overview vuelve a renderizar cada vez que llega una de las 4 fuentes independientes (postulaciones, CVs, perfil y evaluaciones). *Inferencia, no verificada:* cada render reinicia o reanuda la animación, y eso produce los «tramos». T1 lo confirma en el navegador.

## 2. Principios

1. **Una sola cosa importante arriba.** Oura rediseñó su app para centrarse en «one big thing — the most important score or insight you need right now». https://ouraring.com/blog/cs/new-app-design/
2. **Comparar contigo mismo, no con un ideal.** Copilot compara «month-to-date … to the previous month-to-date» y sitúa al usuario sobre una línea de ritmo ideal. https://help.copilot.money/en/articles/6045480-dashboard-tab-overview
3. **La constancia se premia por semanas, no por volumen.** En Strava, la racha exige «at least one activity … between Monday and Sunday». https://support.strava.com/en-us/articles/15401580-streaks-on-strava
4. **Una meta personal y no punitiva.** En Simplify, la meta semanal es «a personal tracking target, not a requirement». https://help.simplify.jobs/articles/6390631-navigate-your-dashboard
5. **Con pocos datos, cifras antes que tasas.** Simplify advierte: «A small set of applications … can make a rate misleading, so read the counts alongside the percentages». https://help.simplify.jobs/articles/6486416-use-flow-chart-insights
6. **Ordenar «lo mío» por foco.** En Linear, «My issues» agrupa «in a focus order such as urgent work… Some sections only appear when they apply». https://linear.app/docs/my-issues
7. **Distinguir los tipos de vacío.** «Never show missing data as zero.» El periodo parcial se marca con «dashed line or lighter fill». https://rendata.nl/style-guide/docs/dashboards/data-states/
8. **Un estado vacío enseña y lleva a la acción.** «Tell the user what could be displayed, and how to populate» y «Provide direct pathways». https://www.nngroup.com/articles/empty-state-interface-design/
9. **Sparklines con mínimo diseño y máximo dato.** «small intense, simple, word-sized graphic». https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/
10. **En móvil, una columna por prioridad.** «Stack in a single, full-width column. Horizontal scroll works against comparison» y «Never delete … Prioritize». https://developer.dynatrace.com/design/foundations/mobile-experience/
11. **Movimiento corto con ease-out.** Las salidas de ease-out van de 200 a 500 ms: «ease-out will be the right call». https://web.dev/articles/choosing-the-right-easing. Lo normal es entre 100 y 500 ms, y es más común pasarse de largo que quedarse corto: https://www.nngroup.com/articles/animation-duration/
12. **Animar solo `transform` y `opacity`.** Esas propiedades se resuelven en composición; las de geometría provocan layout y repintado. El presupuesto es de 16,7 ms por frame. https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Animation_performance_and_frame_rate

## 3. Patrones que vale la pena tomar

| Patrón | Ejemplo | Uso aquí |
| --- | --- | --- |
| Frase protagonista | Oura, «one big thing» | «Tienes 1 evaluación por terminar · 10 min» o «2 de tus 4 postulaciones ya avanzaron» |
| Ritmo frente a periodo anterior | Copilot, «Net This Month» | «4 este mes · primer mes», sin delta falso (principio 7) |
| Racha semanal | Strava Streaks | Semanas seguidas con al menos 1 postulación, a partir de `applied_at` |
| Meta semanal | Simplify, application activity card | Solo como texto o anillo local; el backend no guarda metas, así que sería un valor fijo de UI o se omite |
| Funnel y estados | Huntr Job Search Funnel (https://help.huntr.co/en/articles/10042709-maps-and-metrics), WTTJ con estados con color y palabra (https://help.welcometothejungle.com/en/how-to-effectively-track-your-applications-on-welcome-to-the-jungle) | Una barra segmentada de una línea: Enviada → En proceso → Cerrada, con palabra y cifra |
| Lista por foco | Linear «My issues» | Sustituye a «Pendientes»: secciones que solo aparecen si aplican |
| Estados con significado | Indeed «Solicitud vista / No seleccionado» (https://www.indeed.com/help/job-seekers/articles/4412589551757-my-jobs-managing-applied-jobs) | Badge y fecha relativa en cada fila de la bitácora |
| Mapa de calor de actividad | Calendario de contribuciones de GitHub (https://docs.github.com/en/account-and-profile/concepts/contributions-on-your-profile) | Tira de 12 semanas × 1 fila: puntos encendidos o apagados, que se ven bien aunque haya solo 1 |
| Anillo de progreso | Anillo de presupuesto de Copilot | Evaluación `answered_count/63` y perfil al X % |
| Sparkline en KPI | Tufte | Solo cuando hay 4 semanas o más con datos |

Monzo no se verificó; no hay ninguna cita suya.

## 4. Tres direcciones

### A. «Tu siguiente paso» (foco y acción, al estilo Oura + Linear)

- **Layout:** saludo y frase protagonista generada a partir de los datos, en 24/600 con una línea muted. Debajo, una tarjeta hero de 8 columnas con la siguiente acción y una columna lateral de 4 con el anillo del perfil y el número de CVs. Fila 2: «Tu búsqueda» con una barra de estados segmentada y la tira de constancia de 12 semanas. Fila 3: la bitácora de postulaciones.
- **Gráficas:** dos anillos (perfil %, evaluación n/63), una barra segmentada horizontal y la tira de puntos. No hay barras verticales ni donut.
- **En lugar de «Pendientes»:** la tarjeta hero «Siguiente paso», con una sola acción cada vez y un orden de foco: evaluación que vence → mensaje sin leer → completar perfil → explorar vacantes. Debajo, «+1 más» con un enlace. El banner y el KPI «Por atender» desaparecen.
- **A 390 px:** frase → hero a ancho completo con botón de 44 px → los dos anillos en 2 columnas → barra de estados → tira de puntos (12 puntos de unos 20 px caben en 358 px) → bitácora como filas.

### B. «Bento personal» (protagonista + módulos, al estilo Copilot + Strava)

- **Layout:** cuadrícula bento de 12 columnas. Un tile hero de 6×2 con «4 postulaciones este mes» en 44/600, el texto «primer mes de actividad» o «+2 frente a octubre» y una sparkline semanal que solo aparece con 4 semanas o más. Tiles de 3: «Racha · 1 semana», «Avanzaron · 2 de 4», «Primera respuesta · 3 días en promedio» o «Sin respuestas aún». Tiles de 3+3: el perfil con un anillo y los CVs «2 de 5».
- **Gráficas:** una sparkline condicional y un anillo. El resto son cifras grandes con su contexto.
- **En lugar de «Pendientes»:** una franja compacta de chips bajo el saludo («Evaluación · vence 20 nov», «1 mensaje»), cada uno con su enlace. Si no hay nada pendiente, no se muestra.
- **A 390 px:** el hero a ancho completo y los tiles de 3 columnas en 2×2. Los chips en wrap, sin scroll horizontal. Ningún tile baja de 168 px de ancho.

### C. «Bitácora viva» (la línea de tiempo protagonista, al estilo Huntr + WTTJ)

- **Layout:** a la izquierda (8 columnas), una línea de tiempo vertical de las postulaciones ordenadas por `updated_at`. Cada nodo lleva el estado con palabra y punto, la fecha relativa, el mensaje en línea si existe y la evaluación anidada con su mini anillo. A la derecha (4 columnas), un resumen fijo con la frase, la barra de estados segmentada, el perfil y los CVs.
- **Gráficas:** ninguna «gráfica» como tal. Mini anillos en los nodos y una barra segmentada.
- **En lugar de «Pendientes»:** los pendientes se convierten en nodos marcados «Requiere acción», fijados arriba de la línea. Se aclara que es «la línea conecta postulaciones, no un historial de eventos», como en `candidate-dashboard-redesign/design.json`.
- **A 390 px:** el resumen pasa arriba en formato compacto y la línea ocupa el ancho completo con el conector a 16 px del borde. Las acciones van bajo cada nodo, nunca a su derecha.

## 5. Guía de gráficas y animación

**Cuándo usar cada cosa:**

- **Sin gráfica** (cifra + frase): menos de 5 registros, o menos de 4 periodos con datos. Es el caso de la demo. Se dan cifras y no tasas (principio 5).
- **Tira de puntos o mapa de calor**: la constancia con cualquier volumen. Funciona bien con 1 punto y marca la semana en curso con contorno discontinuo (principio 7).
- **Sparkline**: tendencia con 4 semanas o más con datos, sin ejes, con el último punto en `--primary`.
- **Anillo**: solo para partes de un total con meta clara: perfil %, evaluación n/63. Nunca para la distribución de estados.
- **Barra segmentada horizontal**: la composición por estado (3 partes) con palabra y cifra. Reemplaza al donut y a «Estado de tus postulaciones».
- **Línea de tiempo**: la lista de postulaciones por `updated_at`.
- **Histograma de respuesta**: solo con 5 primeras respuestas o más. Si hay menos, «3 días en promedio · 1 respuesta».

**Reglas de animación:**

- **Entrada:** ease-out entre 200 y 400 ms. El anillo y la barra se animan con `transform: scaleX` o `rotate`, o con `stroke-dashoffset` en un único SVG propio. `stroke-dashoffset` conviene medirlo, porque no es tan barato como `transform` (MDN).
- **Reduced motion:** respetar `prefers-reduced-motion` (https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion).
- **Recharts:** `isAnimationActive="auto"` respeta reduced motion. Hay que fijar `animationDuration` (unos 400) y `animationEasing="ease-out"` (https://recharts.github.io/en-US/guide/animations/). Se monta la gráfica solo cuando sus datos ya están completos y se memoizan los datos, para que los renders de otras fuentes no la reanimen. Esto último es una inferencia sobre el tartamudeo que hay que verificar en T1.
- **Animar una sola vez** al montar, nunca en cada actualización. Sin rebotes. Sin contadores numéricos en cifras pequeñas (contar de 0 a 4 se ve tonto).
- **Hover y focus:** entre 100 y 150 ms.
- **Escalonado** entre tarjetas: como mucho 40 ms por tarjeta y 4 tarjetas.

## Incertidumbre

- La causa del tartamudeo del donut es una inferencia a partir del código; T1 la verifica.
- La página de gráficas de Apple HIG no se pudo recuperar (se renderiza con JS).
- Monzo y Teal (más allá de su tracker) no se verificaron.
- La «meta semanal» no tiene respaldo en el backend.
- Las vacantes guardadas exigen una lectura nueva en el frontend.
