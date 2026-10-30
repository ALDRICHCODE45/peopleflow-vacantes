# Configuración de psicometría — R7 / S4

Tres alternativas de diseño, no una implementación de R8. Manifest: `design.json`.
Todas apuntan a 1440 × 1080 y mantienen el shell de configuración de la vacante.

| Artboard | Organización | Costo principal |
| --- | --- | --- |
| `01-tablero-de-importancia.html` | Tres carriles y detalle lateral; menú «Mover a…» operable con teclado | Menor espacio para redactar; comparar detalles exige seleccionar tarjetas |
| `02-pasos-guiados.html` | Cuatro pasos de navegación libre, revisión y resumen lateral vivo; abre en Justificar | Más navegación para editar datos de varias categorías |
| `03-lista-maestra-detalle.html` | Siete competencias visibles y un detalle amplio; ajustes generales arriba | Comparar dos justificaciones exige cambiar de selección |

Recomendación: **03 para edición recurrente**; 02 para acompañar la primera configuración;
01 para priorizar visualmente. Ninguna está elegida: decide el padre con el usuario.

## Alcance e interacciones

- Datos: Software Developer; Orden para avanzar = Clave / Alto, con tarea y justificación;
  Cuidado de acuerdos = Importante / Medio, con justificación. Las otras cinco = No relevante.
- Exactamente siete competencias del catálogo, incluida Manejo de la presión.
- Cambiar a No relevante limpia banda, tarea y justificación; volver a relevante inicia Medio y
  justificación vacía. Importante elimina la tarea. No se infiere Alto.
- Banda obligatoria para relevantes; justificación de 1–1000 caracteres al confirmar para
  Clave/Importante; tarea de 1–300 solo para Clave. Contadores por puntos de código después de trim,
  sin `maxlength` UTF-16. Un borrador admite tarea/justificación vacías, pero no textos demasiado largos.
- Editar requisitos quita confirmación; activación, etapas y vigencia no la quitan. La fecha de
  confirmación inicial de 03 es una muestra de datos cargados, no el resultado de un guardado simulado.
- La activación es independiente; está encendida en estos ejemplos, con ayuda de que por defecto está apagada.
- Etapas: opciones de ejemplo de un pipeline actual, sin retiradas ni salida. Multiselección opcional;
  crear invitación no manda correo. En R8 usar las etapas reales del servidor, no este catálogo de muestra.
- Vigencia entera de 1–30 días, por defecto 7; 01 abre con 31 y error visible. La ayuda indica que aplica
  a invitaciones nuevas.
- «Sugerir desde la vacante» conserva los datos y explica que no existen reglas; no inventa una inferencia.
- Guardar cambios y Confirmar perfil son acciones distintas. Los botones validan localmente los rechazos,
  pero **no persisten, no generan una fecha de confirmación y no anuncian un éxito ficticio**. En 02,
  Confirmar lleva primero a la revisión si los campos están completos. Con datos válidos en la revisión
  o en las otras direcciones, la acción final queda inerte.
- Los textos de recuperación, conflictos, permisos, cargas y respuestas del servidor siguen siendo los
  de la implementación existente; estos artboards no implementan ni sustituyen ese ciclo.
- Sin conexión de red, almacenamiento, dependencias, imágenes, fuentes o scripts externos.

## Self-check

**Tokens de `design/system.md`:** los tres archivos solo declaran la paleta clara existente:
`background` #F7F5FB, `foreground` #1A1626, `card` #FFFFFF, `primary` oklch(0.491 0.27 292.581),
`primary-foreground` oklch(0.969 0.016 293.756), `muted` #F1EEF7, `muted-foreground` #6B6480,
`border` #E4DFF0, `status-info` oklch(0.45 0.16 250), `status-review` oklch(0.47 0.12 70),
`status-success` oklch(0.46 0.13 152), `status-danger` oklch(0.45 0.2 25).
Tintas y sombras se derivan con `color-mix` de esos tokens. Sin colores adicionales.

**Familia:** `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`, fallback de canvas
permitido por el sistema. Fuente única para títulos y cuerpo; no fuentes remotas.
Radio base .625rem y multiplicadores documentados; sombra de tarjeta del sistema.
Títulos de página 20/600, secciones 16, cuerpo 14, metadatos 12.

**L6:** tarjetas elevadas sobre fondo atenuado; encabezado con icono, título, metadatos y acción/estado;
cuerpo y nota de cierre. Mismo lenguaje en los tres artboards. Panel único de detalle, selección segmentada,
escalas mini de bandas en 03, estados textuales de completitud. No disclosure nativo ni triángulo ▸ de navegador.
Las listas semánticas de navegación/competencias no muestran viñetas nativas.

**Accesibilidad estructural:** main/nav/section/header/footer, headings, fieldsets y labels; controles
independientes de 40px, radio groups nativos para elecciones cortas, foco visible, estados no dependientes
del color, errores asociados al campo y foco al primer error visible; `prefers-reduced-motion` incluido.
Texto principal/atenuado sobre superficies neutras y textos semánticos oscuros; no tintas claras para texto.
Los carriles se mueven desde botones, no por drag-only. Los menús de movimiento permiten Escape.
En 02 se conserva el foco al cambiar importancia aunque se reconstruya el catálogo.

**Seguridad del HTML:** 02/03 construyen nodos y usan `textContent`. 01 escapa los datos y pasa los
fragmentos por un sanitizador de etiquetas/atributos permitidos antes de `replaceChildren`.
Las herramientas de escritura informaron `HTML clean` en los tres archivos y `JSON clean` en el manifest.
No se ejecutó el frontend: es un cambio de diseño aislado. No hubo runner de navegador disponible.
Esto no equivale a una auditoría de contraste calculada, axe ni aprobación visual.

## Revisión pendiente del padre

Abrir `/gentle:design open psychometric-profile-config` (herramienta canvas no disponible en el worker).
Revisar los tres archivos a 1440 × 1080 y 1440 × 900; verificar encuadre, altura y barra sticky.
Revisar también móvil, zoom de texto, teclado, contraste AA calculado y ausencia de desbordes.
Estos artboards solo definen el tema claro; la validación de oscuro queda para R8 con los tokens del producto.

Casos concretos para la revisión interactiva:
1. 01: corregir 31 a 7; mover Orden a Importante y a No relevante; volver a Clave; confirmar y comprobar
   que lleva al detalle incompleto sin perder lo escrito en otras competencias. Abrir/cerrar «Mover a…» con teclado.
2. 02: recorrer los cuatro pasos libremente; editar importancia, banda y justificación; confirmar con tarea vacía
   y verificar que vuelve a Justificar. Guardar con tarea vacía no debe exigir confirmarla.
3. 03: editar solo la vigencia o activación mantiene «Perfil confirmado · 29 oct 2026»; editar tarea, importancia,
   banda o justificación lo cambia a «Perfil sin confirmar». Cambiar de competencia conserva los datos.
4. Todos: borrar rationale de Cuidado y confirmar; introducir más de 300/1000 caracteres, incluidos caracteres
   suplementarios; rechazar vigencia 0, 31, 1.5 y vacía; permitir 1 y 30. Elegir todas/ninguna etapa sin desbordar
   el control (01/03 muestran un conteo para selecciones múltiples). Ningún botón debe simular un éxito del servidor.

## Log propuesto (el padre asigna el siguiente L#)

R7 / S4: direcciones en `design/psychometric-profile-config/`: `01-tablero-de-importancia.html`
(tres carriles con «Mover a…», detalle y error de vigencia), `02-pasos-guiados.html` (cuatro pasos,
revisión y resumen vivo), `03-lista-maestra-detalle.html` (siete competencias y detalle; recomendada para
edición recurrente). Manifest vinculado a esta feature. Se preservan campos, validaciones, shell,
Guardar vs Confirmar, independencia de activación e invalidación de confirmación al editar requisitos.
Self-check L6/tokens/fuente del sistema realizado; HTML/JSON lint limpio. Sin elección ni implementación R8.
Canvas, verificación visual/interactiva y contraste calculado pendientes del padre; no se simuló persistencia.
