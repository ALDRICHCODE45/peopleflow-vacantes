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

## Verificación local

Usa la fixture y un build aislado, no el servidor dev del usuario:
[guía de preview y e2e](local-production-preview.md#careers-sitio-público-y-editor).
El [contrato v1](contracts/company-careers-site-v1.md) detalla validación,
ETag, snapshots y errores. Las imágenes se guardan en disco o en S3 según la
configuración del backend ([backend/docs/site-media.md](../backend/docs/site-media.md));
el frontend no cambia entre ambos modos.
