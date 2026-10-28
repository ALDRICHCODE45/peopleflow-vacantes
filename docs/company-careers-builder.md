# Publicar el sitio de empleo de la empresa

El editor guarda un borrador compartido por el equipo. El sitio público muestra
solo la última versión publicada: guardar no publica.

## Rutas

| Ruta | Uso |
|------|-----|
| `/empresa/sitio` | Editor privado: secciones, marca, dirección pública y SEO. Requiere sesión y empresa activa. |
| `/empresas/<slug>` | Sitio publicado, sin el encabezado global de la app. Un slug anterior redirige con 308 al actual; uno desconocido o despublicado muestra 404. |
| `/media/sitios/<id>` | Proxy público de imágenes del sitio desde el mismo origen; acepta UUID e imágenes JPEG, PNG o WebP de la API configurada. |

El pie del sitio siempre conserva «Impulsado por PeopleFlow» con enlace a `/`.
Los datos de identidad (nombre, logo, descripción y redes) vienen del perfil de
empresa; se editan en `/empresa/configuracion`, no se duplican en el borrador.
Las vacantes son las publicadas de esa empresa, con búsqueda y filtros.

## Buscar y filtrar vacantes

**Filtros** ofrece Área, Modalidad, Ubicación, Jornada, Tipo de contrato y Nivel.
Ubicación muestra el nombre del estado donde se ubica la vacante, no su estado de
publicación. Solo aparecen los filtros y las opciones presentes en las vacantes
cargadas; las opciones se ordenan alfabéticamente en español.

Puedes elegir varias opciones de un mismo filtro: basta con que coincida una.
Al combinar filtros, la vacante debe cumplir todos. El conteo cambia en vivo;
**Quitar filtros** restaura la búsqueda completa. No se hacen nuevas consultas.

El panel conserva la paleta, la tipografía y el tema del sitio. Tanto su contenido
como su fondo oscurecido permanecen dentro de la vista previa, también al usar
**Ver como visitante**. Las filas y tarjetas destacan con un anillo de marca al
pasar el puntero o recibir foco, sin quedar tapadas por la siguiente vacante.

## Guardar y publicar

1. Edita una sección y revisa el resultado en la vista previa. «Cambios guardados»
   confirma el autosave del borrador, no una publicación.
2. La persona dueña pulsa **Publicar**. El editor termina el guardado y muestra
   requisitos pendientes o pide confirmar la versión exacta.
3. «Sitio publicado» confirma que esa versión reemplazó la publicación anterior.
   **Ver como visitante** sigue siendo una vista privada del borrador, no una URL
   pública para compartir.

| Rol | Borrador | Publicar / despublicar |
|-----|----------|------------------------|
| Owner | Editar y guardar | Sí, con confirmación |
| Recruiter | Editar y guardar | No; la API también aplica el permiso |

Despublicar oculta el sitio público y conserva el borrador. Una dirección «En uso»
no entra en el documento guardado. Si otra persona guarda primero, el editor no
sobrescribe en silencio: **Cargar versión** descarta los cambios locales tras
confirmación y usa la versión más reciente conocida del servidor.

## Íconos o emojis en valores y beneficios

Cada elemento usa **un ícono o un emoji**, nunca ambos. Abre **Ícono o emoji**:

- **Íconos** ofrece 111 opciones agrupadas, con nombres y búsqueda en español
  (no necesitas escribir acentos).
- **Emojis** incluye 120 opciones de cultura laboral. También puedes pegar el
  que tú prefieras y pulsar **Usar emoji**. Si no es válido, el campo explica cómo
  corregirlo sin modificar el borrador ni interrumpir su guardado.

Se acepta una secuencia completa, incluidos tonos de piel, banderas y uniones
como 👩‍💻, de hasta 32 bytes UTF-8. No se recortan espacios ni se aceptan dos
emojis separados. El validador usa `Intl.Segmenter` y la gramática del backend
con su tabla `Extended_Pictographic` de Unicode 15.0 fijada; las uniones ZWJ
válidas según esa gramática se conservan aunque un navegador más nuevo las
segmente distinto. Esto también mantiene símbolos como ♡, no solo emojis RGI.
Los nuevos elementos empiezan con un ícono. Los documentos antiguos se leen
con `emoji: null`; si no tenían ningún símbolo, siguen siendo legibles y el
editor pedirá elegir uno antes de guardar una edición.

Los símbolos públicos son decorativos (`aria-hidden`); el título y la descripción
del elemento conservan la información accesible en todas las variantes.

## Marca: paletas y colores

En **Marca**, elige una de ocho paletas o usa **Personalizar**:

- **Principal** identifica franjas, acentos de títulos, navegación y enlaces.
- **Acento/CTA** distingue acciones y badges. Vacío (`null`) usa el principal.
- **Fondo** define la superficie clara. Vacío conserva las superficies originales.

Editar cualquier color marca la selección como **Personalizado**. Los campos aceptan
`#RRGGBB` y guardan mayúsculas. Un hexadecimal incompleto se conserva en el campo,
con un error, sin enviarlo al borrador. Puedes vaciar Acento/CTA y Fondo para recuperar
sus valores automáticos. Elegir una paleta llena los tres campos; no cambia la tipografía.

| Paleta | Principal | Acento/CTA | Fondo claro |
|--------|-----------|------------|-------------|
| Violeta | `#7835DB` | `#0F766E` | `#F7F5FB` |
| Océano | `#1D4ED8` | `#0E7490` | `#F0F9FF` |
| Bosque | `#285548` | `#4D651D` | `#F4F8F2` |
| Terracota | `#9A3412` | `#7C3F58` | `#FFF7ED` |
| Medianoche | `#373080` | `#0369A1` | `#F5F6FF` |
| Coral | `#BE123C` | `#9D174D` | `#FFF1F2` |
| Grafito | `#374151` | `#4B5563` | `#F9FAFB` |
| Mostaza | `#854D0E` | `#3F6212` | `#FEFCE8` |

### Contraste y modo oscuro

El visitante sigue usando su preferencia de tema. No se guardan colores ajustados:
la vista previa y el sitio publicado calculan los mismos tokens, sin APIs del navegador.

1. El fondo claro usa el hexadecimal elegido. Su versión oscura conserva el matiz
   HSL, limita la saturación a 25% y fija la luminosidad en 8% (redondeo sRGB de 8 bits).
   Sin fondo personalizado se conservan `#F7F5FB` / `#0C0912` exactamente.
2. Las tarjetas conservan `#FFFFFF` / `#15121F`. Solo cambian de polo neutro cuando
   el color de texto legible sobre la página no alcanza 4.5:1 en la tarjeta original
   (por ejemplo, un fondo claro personalizado negro necesita tarjetas oscuras).
3. La franja parte de la mezcla sRGB de 7% del principal ajustado original y 93%
   de la página, materializada en hexadecimal. Si hace falta, se ajusta para conservar
   el mismo polo de texto que la página. Las superficies muted personalizadas usan
   la tarjeta; sin fondo personalizado conservan las superficies muted originales.
4. Principal, acento, texto principal y secundario conservan matiz/saturación y buscan
   luminosidad en pasos de un punto porcentual HSL hasta superar el contraste en
   **todas** sus superficies simultáneamente (página, franja, tarjeta y muted).
   La dirección se aleja del fondo hacia negro o blanco. El texto exige 4.5:1;
   el anillo de foco exige 3:1. Principal y acento sobre superficies normales usan
   también 4.5:1, por encima del mínimo no textual de 3:1.
5. El texto sobre cada relleno usa el negro o blanco de mayor contraste. El CTA
   sobre una franja principal deriva un acento independiente, legible contra esa
   franja; con acento nulo conserva el CTA inverso anterior. Las franjas siguen
   usando el principal, no el acento. El foco personalizado usa contorno opaco;
   los CTA personalizados conservan su relleno probado al pasar el puntero, con
   subrayado como señal, evitando perder contraste por transparencia.

La matriz prueba las ocho paletas × ambos temas × cada par de tokens. La tolerancia
es **cero**: todos los hexadecimales finales superan 4.5:1 (texto) / 3:1 (no textual),
sin otra corrección después de calcular tokens. La adaptación de luminosidad por tema
es parte de esa derivación, no una modificación de los colores guardados. Los colores
originales de las paletas ya superan 4.5:1 contra su fondo claro. Los avisos de ajuste
muestran cada color y tema afectados, incluyendo el fondo oscuro derivado.

### Composición y revisión pendiente

Las paletas siguen el patrón oficial **RadioGroup → FieldLabel → Field horizontal →
FieldContent + RadioGroupItem** (choice card), con FieldSet/FieldLegend y selección
`ring-primary`. Los tres colores usan FieldGroup/Field + InputGroupInput y addon de
muestra; las muestras son datos elegidos, no una paleta de la aplicación. Se conserva
el ToggleGroup de tipografía. Referencias: `radio-group.md`, `field.md` e
`input-group.md` en `docs/design/shadcn-reference/`. No se altera ningún primitive:
RadioGroup se agregó desde el registro base-rhea autorizado.

Pendiente en navegador: panel angosto y móvil sin desbordamiento, selección mediante
la tarjeta completa y flechas de teclado, foco visible, colores normales/hover sobre
franjas y tarjetas en ambos temas, avisos de ajuste y guardado/publicación real.
Los tests de jsdom y la matriz numérica no sustituyen esa revisión visual.

## Verificación local

Usa la fixture y un build aislado, no el servidor dev del usuario:
[guía de preview y e2e](local-production-preview.md#careers-sitio-público-y-editor).
El [contrato v1](contracts/company-careers-site-v1.md) detalla validación,
ETag, snapshots y errores. Las imágenes se guardan en disco o en S3 según la
configuración del backend ([backend/docs/site-media.md](../backend/docs/site-media.md));
el frontend no cambia entre ambos modos.
