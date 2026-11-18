# Mis CVs y Perfil · principios para el rediseño (T11, S10)

Investigación ligera, hecha con lo que sé de editores de perfil y bibliotecas de documentos ya conocidos: LinkedIn
(edición de perfil), Read.cv, Wellfound (perfil de candidato), los ajustes de Notion y Linear, y las listas de
archivos de Google Drive y Dropbox. No consulté fuentes nuevas ni medí nada: son observaciones de diseño, no datos.
Las propuestas de alineación (`design/candidate-align/02-cvs.html` y `03-perfil.html`) se rechazaron porque seguían
siendo el mismo formulario y la misma lista con otra piel. Estos principios buscan un cambio de modelo sin perder
ningún campo, acción o regla de hoy.

1. **Mostrar el documento, no una fila que habla de él.** Drive, Dropbox y Read.cv permiten reconocer un archivo
   por cómo se ve: la primera página, el tipo y la fecha. Un CV se elige por su contenido, así que la miniatura es
   información y no adorno. Cuando no hay vista previa (Word en el navegador), se dice así y se ofrece la descarga;
   no se inventa una imagen.

2. **Subir se hace donde están los archivos, y los límites se dicen antes del error.** En Dropbox puedes soltar el
   archivo en cualquier parte de la lista. Aquí: soltar en toda la página, más un punto fijo para subir (un mosaico,
   una fila o el encabezado). «PDF o Word, hasta 5 MB» y «n de 10» quedan visibles siempre, no solo cuando algo falla.
   Con la biblioteca llena, el control se desactiva y explica por qué.

3. **Cada acción que cambia algo dice qué toca y qué no.** Drive avisa a quién afecta un cambio antes de hacerlo. La
   regla «Cada postulación guarda su copia» va junto a Renombrar y Eliminar (en el diálogo, en la nota de uso y en la
   ayuda de «En uso»), no en un panel aparte que nadie lee.

4. **El perfil se lee como lo ven las empresas y se edita donde se lee.** LinkedIn y Read.cv muestran el perfil
   terminado y ponen el lápiz en cada sección. Las cinco pestañas de hoy (Personal, Experiencia, Educación,
   Compensación, Idiomas) pasan a secciones que primero se leen; editar es un modo de la sección o una hoja enfocada,
   no una pantalla de campos vacíos.

5. **Un solo guardado, siempre a la vista.** El backend guarda el perfil completo en una sola escritura (más los
   idiomas), así que no fingimos un guardado automático por campo como en Notion o Linear. A cambio, «Cambios sin
   guardar», qué secciones cambiaron, «Guardar perfil» y «Restaurar copia original» se ven siempre, en una barra fija
   en móvil, como en los ajustes de GitHub o Stripe.

6. **El avance sale de datos reales y lleva a lo que falta.** La fuerza del perfil de LinkedIn y el checklist de
   Wellfound funcionan porque cada punto abre el campo que falta. Usamos los 10 datos clave que ya cuenta el editor de
   hoy (`n de 10 datos clave`), con el anillo fino de marca, y cada dato que falta es un botón que abre su campo. No
   hay puntajes inventados.

7. **La privacidad forma parte de la etiqueta.** Wellfound y LinkedIn marcan lo que solo ve el candidato. Fecha de
   nacimiento, resumen y compensación no aparecen en la ficha que recibe la empresa (según
   `features/org-candidates/detail/detail-model.ts`). Se marcan «Solo tú» con un candado. Falta confirmarlo con el
   backend.

8. **El mismo modelo, recompuesto para 390 px.** Los paneles laterales se abren en su lugar, las hojas ocupan toda la
   pantalla, la navegación por secciones pasa a un menú «Ir a» fijo arriba y el guardado queda abajo. No se esconde
   nada de lo necesario para decidir. Sin superficie oscura en ninguna de las dos pantallas («Superficie oscura (hero)»).
