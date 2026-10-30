# Comparación de candidatos

Presentación de S2/R4 (`design/candidate-comparison/01-resumen-y-matriz.html`).

- Las tarjetas resumen muestran etapa, ajuste y pendientes; la barra reutiliza
  `ChecklistFitSummary`, la misma presentación del tablero sin contexto ni perfiles.
- El orden se conserva en `buildComparison`: solo checklist, nunca psicometría.
- Cada grupo tiene una matriz y su propio botón **Expandir textos / Contraer textos**.
  Los criterios se limitan a dos líneas hasta expandirlos.
- Los resultados tienen nombre accesible con estado y fuente. El Tooltip muestra
  fuente y nota al enfocar con teclado o pasar el puntero. Sin evaluar no significa
  no cumplir. La primera columna permanece fija durante el scroll horizontal.
- **Imprimir / Guardar PDF** revela texto completo, resultados, fuentes y notas sin
  depender de los tooltips. **Descargar CSV** conserva el formato completo existente,
  independientemente de qué textos estén expandidos.

Composición: Card → CardHeader (CardTitle, CardDescription, CardAction cuando hay
acción) → CardContent (Table con caption, header y body) → CardFooter. Tooltip sigue
Trigger + Content; Badge usa la receta central de etapa; Avatar incluye Fallback.
Se conservan los primitives y el shell de la aplicación, no el HTML del artboard.
La columna de criterio se estrecha en móvil para no tapar todos los resultados.
