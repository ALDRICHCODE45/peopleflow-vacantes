# Prueba manual: empresa y borrador privado (empleador)

Guía para probar en el navegador, de punta a punta, el flujo
**login recruiter → crear empresa → guardar borrador privado → encontrarlo en la
lista → reabrirlo, editarlo y guardarlo → configurar las columnas de su pipeline**
contra la API Go real. Esta prueba es el requisito para integrar
`feat/vacancy-publication-ui` en `main`.

- Rama frontend: `feat/vacancy-publication-ui`.
- Rama backend: `feat/vacancy-publication` (incluye todo lo de `main` más la
  publicación). Trae las migraciones `00018` y `00019`: corré `make db-migrate` y
  confirmá con `make db-status` que no queda nada en «Pending».
- Los servicios los levantás vos en tu terminal. Ningún agente lee ni modifica
  tus archivos `.env`; acá solo aparecen **nombres** de variables, nunca valores.
- No pegues tokens, cookies, contraseñas ni el contenido de tus `.env` en el chat.

## 1. Preparar la base de datos (backend)

Desde `peopleflow-vacantes/backend/`:

1. Liberá el puerto 5432. Si el contenedor `nest-practice` está corriendo, lo ocupa:

   ```bash
   docker stop nest-practice     # al terminar: docker start nest-practice
   ```

2. Levantá PostgreSQL (contenedor `peopleflow-vacancies`, la base descartable que
   ya tiene tu usuario recruiter):

   ```bash
   make db-up
   docker compose ps             # esperá estado healthy
   ```

3. Verificá las migraciones:

   ```bash
   make db-status
   ```

   `00012_create_private_job_drafts` y `00013_version_draft_idempotency_fingerprint`
   deben tener fecha en «Applied At». Si alguna dice «Pending», corré
   `make db-migrate` y repetí `make db-status`.

## 2. Levantar la API Go

En `backend/.env` tienen que estar definidas:

| Variable | Valor esperado (descripción) |
| --- | --- |
| `DATABASE_URL` | Conexión loopback al contenedor `peopleflow-vacancies` |
| `APP_ENV` | `local` |
| `IDENTITY_JWT_MODE` | `jwks` |
| `IDENTITY_JWT_ISSUER` | El mismo issuer que `COGNITO_ISSUER` del frontend |
| `IDENTITY_JWT_CLIENT_ID` | El mismo client id que `COGNITO_CLIENT_ID` del frontend |
| `IDENTITY_JWT_TOKEN_USE` | `access` |
| `PORT` | Opcional; por defecto `8080` |

**No** definas `IDENTITY_JWT_AUDIENCE` ni `IDENTITY_JWT_PUBLIC_KEY_PEM`: con
`AUDIENCE` definida, el access token de Cognito es rechazado. Las variables
`IDENTITY_LOCAL_BOOTSTRAP_*` no hacen falta: el bootstrap local queda apagado.

```bash
make run
curl -s localhost:8080/healthz   # 200
curl -s localhost:8080/readyz    # 200
```

## 3. Levantar el frontend

En `peopleflow-vacantes-frontend/frontend/`, con Node 22:

- `PEOPLEFLOW_API_BASE_URL` apunta al origen de la API Go (por ejemplo
  `http://localhost:8080`).
- Las variables de auth que ya usás: `NEXTAUTH_URL`, `NEXTAUTH_SECRET`,
  `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET`, `COGNITO_ISSUER`, `COGNITO_DOMAIN`.

```bash
corepack pnpm dev
```

## 4. Pasos en el navegador

1. **Login.** Entrá a `/empresa/login` y presioná «Ingresar con Cognito». Si
   cambiaste los scopes de Cognito o tu sesión es vieja, primero cerrá sesión y
   volvé a entrar.
2. **Crear empresa.** Entrá a `/empresa/configuracion`. La primera sección,
   «Tu empresa», muestra un formulario si todavía no tenés empresa:
   - Nombre de la empresa (al menos 4 caracteres).
   - RFC de exactamente 12 caracteres (se guarda en mayúsculas; la Ñ y el `&`
     cuentan como un carácter).
   - Industria (lista que viene del backend).

   Presioná «Crear empresa». **Esperado:** aviso «Empresa creada» y la sección
   pasa a mostrar la empresa con el estado «Activa», el RFC, la industria y
   «Tu rol: Propietario». Si aparece «En verificación», los borradores van a
   responder que la empresa no está activa: avisá antes de seguir.
   Los avisos aparecen **arriba a la derecha**. Los de error quedan fijos hasta que
   los cerrás o reintentás, y al final muestran la referencia técnica (código HTTP,
   código del backend y hora). Junto al botón siempre queda una línea de estado.
3. **Solicitante.** Entrá a `/empresa/vacantes/borradores/nuevo`. En «Revisión
   interna», elegí el tipo («Área interna» o «Cliente») y escribí en «Área o
   cliente»:
   - Con un nombre nuevo aparece «Crear "…"». Elegilo: se muestra el aviso de que
     queda en el catálogo aunque canceles el borrador. Presioná «Crear y
     seleccionar». **Esperado:** aviso «Solicitante creado» y «Seleccionado: …».
   - Escribí el mismo nombre otra vez: **esperado**, aparece en la lista para
     elegirlo (no ofrece crearlo de nuevo). Si lo intentás con otra variante de
     mayúsculas, debe ofrecer «Seleccionar existente» sin elegirlo solo.
   - Cambiar el tipo limpia la selección y lo avisa.
4. **Guardar borrador.** Completá los pasos (podés dejar campos vacíos) y en el
   último presioná «Guardar borrador». **Esperado:** aviso «Borrador guardado» y,
   junto al botón, «Guardado · versión 1 · <hora>». El botón pasa a decir
   «Guardar cambios». «Atrás», la línea de estado y los botones del último paso
   quedan en una sola fila (el estado entre «Atrás» y los botones), sin moverlos.
5. **Guardar cambios.** Volvé a un paso, modificá un campo (la línea de estado
   avisa que hay cambios sin guardar) y presioná «Guardar cambios».
   **Esperado:** aviso «Cambios guardados» y «versión 2» sobre el mismo borrador.
6. **Error a propósito (opcional).** Frená `make run` y presioná «Guardar
   cambios». **Esperado:** aviso de error fijo «No hubo respuesta del servidor»
   con la referencia técnica, y junto al botón «Resultado sin confirmar · ver
   aviso». Volvé a levantar `make run` antes de seguir.
7. **Dirección del borrador.** Después del primer guardado, la barra de
   direcciones pasa a `/empresa/vacantes/borradores/<id>` sin recargar el editor.
   **Esperado:** recargar la página abre el mismo borrador con lo guardado.
8. **Borradores en Vacantes.** Entrá a `/empresa/vacantes`. No hay un botón ni
   una pantalla aparte de borradores. **Esperado:** mientras cargan aparecen filas
   de carga en la tabla; después tus borradores aparecen primero (el editado más
   reciente arriba), con la misma fila que el resto: iniciales, título (o «Sin
   título»), «modalidad · jornada» (o «Modalidad sin definir»), «Sin candidatos
   todavía», tu nombre y el solicitante; estado «Borrador» (con un color distinto
   de «Cerrada»); en Pipeline la barra vacía y «Sin pipeline · en borrador»; en
   Publicada «Sin publicar» y «Editado <fecha>». La pestaña «Borradores» y la
   tarjeta «Borradores» muestran cuántos hay, «Todas» los incluye y la búsqueda
   también encuentra borradores por título.
9. **Pipeline de un borrador.** En la fila de un borrador presioná «Acciones»: el
   menú tiene «Ver pipeline» y «Continuar editando». Elegí «Ver pipeline».
   **Esperado:** `/empresa/vacantes/<id>/pipeline` con el título del borrador y el
   badge «Borrador» arriba, el mensaje «Esta vacante todavía no tiene pipeline» con
   «Configurar columnas», «Continuar editando» y «Volver a Vacantes», y a la derecha
   del título «Pipeline» un botón con engranaje («Configuración de la vacante»).
   El engranaje y «Configurar columnas» llevan a
   `/empresa/vacantes/<id>/configuracion/columnas`: arriba el título del borrador
   con «Pipeline» para volver, a la izquierda los apartados (por ahora solo
   «Columnas del pipeline», marcado como activo) y a la derecha el editor (pasos
   14 a 19). `/empresa/vacantes/<id>/configuracion` lleva al mismo apartado.
10. **Reabrir sin cambios.** En la fila del borrador abrí «Acciones» y elegí
    «Continuar editando» (o usalo desde el pipeline). **Esperado:** el editor
    muestra todos los datos guardados, incluidas las preguntas de filtro y la
    descripción, y el botón dice «Guardar cambios»; arriba, «Vacantes» vuelve a la
    tabla. Andá al último paso y guardá sin editar nada: la versión sube y, en la
    base (sección 5), `fields_json` queda igual que antes.
11. **Reabrir y editar.** Cambiá un campo (por ejemplo la modalidad) y presioná
    «Guardar cambios». **Esperado:** aviso «Cambios guardados» y versión
    siguiente; al volver a Vacantes el borrador queda primero con la modalidad y la
    fecha nuevas.
12. **Conflicto (opcional).** Abrí el mismo borrador en dos pestañas, guardá en
    una y después en la otra. **Esperado:** la segunda muestra «Esto cambió en
    otro lugar» y no pisa los cambios de la primera.
13. **Borrador inexistente.** Entrá a
    `/empresa/vacantes/borradores/00000000-0000-4000-8000-000000000000` y a
    `/empresa/vacantes/00000000-0000-4000-8000-000000000000/pipeline`.
    **Esperado:** en ambas, un estado vacío que dice que el borrador no existe o no
    tenés acceso, con «Reintentar» y un enlace a Vacantes. Una dirección que no es
    un id muestra la página 404, y `/empresa/vacantes/borradores` ya no existe.

14. **Columnas por defecto (probalo en tema claro y oscuro).** En «Columnas del pipeline» de un borrador que nunca configuraste.
    **Esperado:** mientras carga, una tarjeta de carga; después «Columnas del
    pipeline» con, en orden, Nuevos, Screening, Screening OK, En proceso y Placement,
    cada una con su número. Nuevos y Placement dicen «Posición fija» y no tienen
    botones para moverse. Abajo, separada, «Salida del proceso» con Descartados.
    Arriba a la derecha, «0 de 3 columnas propias». Debajo de la tarjeta, la
    «Vista previa» del tablero. «Guardar cambios» y «Descartar cambios» están
    deshabilitados mientras no cambies nada.
15. **Editar y guardar.** Renombrá Screening a «Filtro», arrastrá columnas desde su manija (⋮⋮, a la izquierda del número); con teclado, tabulá hasta la manija,
    espacio para tomarla, flechas para moverla y espacio para soltarla (nada puede
    quedar antes de Nuevos ni después de Placement). Sin arrastrar: el botón «⋯» de
    cada fila tiene «Subir» y «Bajar» (deshabilitados cuando no se puede), presioná
    «Agregar columna» y escribí «Prueba técnica» (el cursor queda en la columna
    nueva, que aparece antes de Placement). La vista previa refleja todo sin
    guardar. Presioná «Guardar cambios». **Esperado:** aviso «Pipeline guardado»
    y, debajo de los botones, «Guardado». Recargá la página: las columnas vuelven
    en el mismo orden y con los mismos nombres.
16. **Límite y quitar.** Agregá columnas hasta llegar a 3 propias. **Esperado:**
    «Agregar columna» se deshabilita y dice «Llegaste al máximo de 3 columnas
    propias.»; el contador dice «3 de 3». Quitá una con «⋯» → «Quitar columna» (solo
    las columnas propias tienen esa opción) y guardá.
17. **Validaciones.** Dejá un nombre vacío, poné el mismo nombre en dos columnas
    (por ejemplo «Entrevista» y «ENTREVISTA», o renombrá Descartados igual que otra)
    y uno de más de 40 caracteres; salí de cada campo. **Esperado:** junto a cada
    campo, «Escribe un nombre para la columna.», «Ya hay otra columna con este
    nombre.» o «Usa como máximo 40 caracteres.»; al guardar, aviso «Revisa los
    datos marcados» y no se envía nada. «Descartar cambios» vuelve a lo guardado.
18. **Renombre crítico.** Renombrá En proceso, Placement o Descartados y guardá.
    **Esperado:** antes de guardar se abre «Confirmar cambio de nombre» con
    «nombre anterior → nombre nuevo» y qué función sigue cumpliendo esa columna.
    «Revisar» cierra sin guardar; «Guardar cambios» guarda.
19. **Conflicto (opcional).** Abrí el mismo pipeline en dos pestañas, guardá un
    cambio en una y otro en la otra. **Esperado:** la segunda muestra «Esto cambió
    en otro lugar», tus cambios siguen en pantalla y «Cargar versión actual»
    trae lo guardado en la primera pestaña. Guardar el pipeline no afecta al
    borrador: después de guardar columnas, «Continuar editando» y guardar el
    borrador funciona sin conflicto.
20. **Desde el editor.** Abrí un borrador con «Continuar editando». **Esperado:**
    arriba del editor hay un botón «Configurar columnas» que lleva a la
    configuración de columnas de ese borrador.

21. **Subestados vacíos (tema claro y oscuro).** En «Columnas del pipeline», la
    fila de En proceso muestra el badge «Sin subestados» y el menú de apartados de
    la izquierda solo tiene «Columnas del pipeline». Abrí el «⋯» de En proceso y
    elegí «Subestados». **Esperado:** se abre un panel lateral (en celular, a pantalla
    completa) «Subestados de En proceso» (o el nombre que tenga esa columna, aunque
    no lo hayas guardado), «0 de 50 subestados», las cuatro sugerencias en una fila
    alineada a la izquierda y «Todavía no hay subestados. Elige una sugerencia o
    agrega uno.»
22. **Agregar y guardar.** Elegí dos sugerencias (desaparecen de «Sugerencias») y
    agregá uno propio con «Agregar subestado» (por ejemplo «Entrevista técnica»).
    Ordenalos arrastrando o con «⋯» → Subir/Bajar y presioná «Guardar subestados».
    **Esperado:** aviso «Subestados guardados», el panel se cierra y la fila de En
    proceso dice «3 subestados». Al recargar y volver a abrirlo, están en el mismo
    orden.
23. **Validaciones, quitar y descartar.** Dejá un nombre vacío y repetí otro con
    distinta mayúscula. **Esperado:** «Escribe un nombre para el subestado.» y «Ya
    hay otro subestado con este nombre.»; no se envía nada. Quitá uno con «⋯» →
    «Quitar subestado»: si era una sugerencia, vuelve a «Sugerencias». Cerrá el panel
    (Cancelar, Escape o clic afuera) sin guardar. **Esperado:** pregunta «¿Descartar
    los cambios de subestados?»; «Seguir editando» vuelve al panel y «Descartar» lo
    cierra sin guardar. Sin cambios, se cierra directo.
24. **Independencia.** Renombrá una columna sin guardar, abrí «Subestados», agregá
    uno y guardalo. **Esperado:** el rename de la columna sigue en la tarjeta sin
    guardar («Guardar cambios» habilitado); guardalo y ninguno de los dos da «Esto
    cambió en otro lugar».

25. **Entrega vacía (tema claro y oscuro).** En la configuración de un borrador, el
    menú de apartados muestra «Columnas del pipeline» y «Entrega». Entrá a «Entrega».
    **Esperado:** la tarjeta «Entrega» con «Columna de corte» en «Sin definir», el
    objetivo vacío y la fecha sin elegir. Las opciones de la columna de corte son
    tus columnas con sus nombres actuales (no aparece Descartados).
26. **Guardar por partes.** Elegí solo la columna de corte y guardá. **Esperado:**
    aviso «Entrega guardada». Después escribí el objetivo (probá «0», «1000» y «abc»:
    **esperado** «Usa un número entre 1 y 999.» o «Escribe un número entero.»),
    dejá «5» y guardá.
27. **Fecha compromiso.** Abrí el calendario. **Esperado:** solo se pueden elegir
    días desde hoy hasta dentro de un año; sábados, domingos y días de descanso
    obligatorio (por ejemplo el tercer lunes de noviembre o el 25 de diciembre)
    aparecen deshabilitados. Elegí un día hábil y guardá; recargá y sigue igual.
    «Quitar fecha» la deja vacía.
28. **Columna de corte protegida.** Con una columna propia como corte, volvé a
    «Columnas del pipeline». **Esperado:** esa fila tiene el badge «Corte de entrega»
    y en su «⋯» «Quitar columna» está deshabilitado. Desde otra pestaña cambiá el
    corte a esa columna después de abrir el editor y quitala en la primera.
    **Esperado:** aviso «No puedes quitar la columna de corte» con «Ir a Entrega», y
    la fila queda marcada.

29. **Solicitud (tema claro y oscuro).** En la configuración de un borrador, el
    menú de apartados muestra «Columnas del pipeline», «Entrega» y «Solicitud».
    Entrá a «Solicitud». **Esperado:** «Fecha de solicitud» solo deja elegir hoy o
    días pasados; «Plazas a cubrir» acepta de 1 a 999 (probá «0» y «abc»). Guardá
    y recargá.
30. **Faltantes.** Con un borrador incompleto, abrí «Publicar» desde el «⋯» de la
    fila en Vacantes (o desde el pipeline o el último paso del editor). **Esperado:**
    «Te falta para publicar» con los faltantes agrupados en «Editor de la vacante»,
    «Solicitud» y «Entrega», cada uno con «Completar» que lleva a donde se completa.
    No hay botón para publicar.
31. **Publicar.** Completá todo y volvé a abrir «Publicar». **Esperado:** «Publicar
    vacante» con el resumen (vacante, columna de corte, objetivo de entrega y fecha
    compromiso) y el aviso de que empieza a contar el tiempo de entrega. Confirmá.
    **Esperado:** aviso «Vacante publicada»; en Vacantes la fila pasa a «Activa» con
    «Publicada el …» y sale de la pestaña «Borradores»; el pipeline muestra una
    tarjeta por columna con «Sin candidatos todavía».
32. **Editor con cambios sin guardar.** En el último paso del editor de otro
    borrador, cambiá algo sin guardar y tocá «Publicar». **Esperado:** «Guarda los
    cambios antes de publicar», sin botón para publicar.
33. **Fecha vencida (opcional).** Si un borrador tiene una fecha compromiso pasada,
    «Publicar» la lista como «La fecha compromiso ya pasó» en «Entrega».

34. **Sitio público con vacantes publicadas (P2a).** Sin sesión, entrá a
    `/vacantes`. **Esperado:** aparecen juntas las vacantes del catálogo anterior y
    tu vacante publicada (paso 31), cada una con «Publicada el …». Filtrá por
    modalidad, jornada, contrato y área: con jornada, contrato o área aparece la
    nota «Algunas vacantes del catálogo anterior no tienen este dato y no aparecen
    con este filtro.». No hay filtros de salario ni de idioma.
35. **Detalle de la vacante publicada.** Abrí tu vacante. **Esperado:** descripción
    con formato, «Requisitos», «Beneficios», salario solo si lo marcaste como
    visible y nada interno (ni solicitante, ni plazas, ni entrega). No hay botón
    «Postularme» (llega en P2b); en una vacante del catálogo anterior sí está.
36. **Vacante publicada incompleta.** En el editor de tu vacante publicada borrá el
    título (o en «Entrega» quitá el objetivo) y guardá. **Esperado:** aviso «La
    vacante está publicada» con «No puedes dejarla sin: …»; lo editado sigue en
    pantalla.

37. **Cuenta de candidato (P2b0).** Con otro email (nunca el de tu empresa), entrá a
    `/candidato/login` y tocá «Crear cuenta»: se abre el login de Cognito; registrate,
    verificá el email y entrá. **Esperado:** «Crear mi cuenta de candidato» con el
    aviso «Vas a crear una cuenta de candidato con {tu email}. Esta cuenta no podrá
    usarse para publicar vacantes.». Escribí tu nombre y confirmá con el botón (no se
    crea sola). **Esperado:** aviso «Cuenta de candidato creada» y entrás a tu área;
    el menú de usuario muestra tu nombre y email reales.
38. **Roles cruzados.** Con la sesión de candidato entrá a `/empresa/vacantes`.
    **Esperado:** «Esta cuenta es de candidato» con salida. Con tu cuenta de empresa
    entrá a `/candidato/dashboard`. **Esperado:** «Esta cuenta es de empresa».
39. **Cerrar sesión de candidato.** Desde el menú del candidato, «Cerrar sesión».
    **Esperado:** volvés a `/candidato/login` (no a la de empresa).
40. **Backend sin UserInfo (opcional).** Sin `IDENTITY_USERINFO_ENDPOINT` en el
    backend, el alta muestra un error con «Reintentar» y el resto sigue funcionando.

41. **Biblioteca de CVs (P2b).** Con tu cuenta de candidato entrá a `/candidato/cvs`.
    **Esperado:** «0 de 10 CVs»; subí un PDF y un .docx (y probá un .txt y uno de más
    de 5 MB: mensajes junto al campo). Renombrá uno y descargalo. Eliminar pide
    confirmación.
42. **Postularse.** Sin sesión, abrí tu vacante publicada en `/vacantes/{id}` y tocá
    «Postularme». **Esperado:** «Ingresar como candidato»; al entrar volvés a la
    postulación. Pasos: datos (tu nombre y email), CV (elegí uno o subí otro), preguntas
    (todas obligatorias, las abiertas con contador) y resumen. «Enviar postulación».
    **Esperado:** «Postulación enviada» con enlace a «Mis postulaciones».
43. **Mis postulaciones.** En `/candidato/postulaciones` aparece la vacante con
    «Postulación enviada». Volvé a postularte a la misma: **esperado** «Ya te postulaste
    a esta vacante». El CV usado queda «En uso» en tu biblioteca. Escribí parte del
    puesto o de la empresa sin tildes en «Buscar por puesto o empresa»: **esperado** la
    postulación sigue visible; con un texto que no coincide aparece «Ninguna postulación
    coincide con «…».» y «Limpiar búsqueda» vuelve a mostrar todo.
44. **Preguntas cambiadas (opcional).** Con la postulación abierta, cambiá las preguntas
    de la vacante desde el editor y enviá. **Esperado:** «Las preguntas cambiaron. Revisa
    tus respuestas.» con el formulario recargado.

### Corte 4: mover candidatos (rama `feat/pipeline-movement-ui`, backend `feat/pipeline-movement`, migración 00023)

45. **Tablero real.** Con la vacante publicada y la postulación del paso 42, entrá como
    empresa a `/empresa/vacantes/{id}/pipeline`. **Esperado:** las columnas configuradas
    con sus conteos, la tarjeta del candidato en la primera columna, «Descartados» solo de
    lectura y «X de Y plazas cubiertas» (o «X plazas cubiertas» si no definiste plazas).
46. **Mover.** Abrí el menú «Mover a…» de la tarjeta: solo aparece la columna siguiente.
    Movela y después arrastrala con la manija (mouse y teclado: espacio, flechas, espacio).
    **Esperado:** no se puede soltar en una columna que salta etapas; «Candidato movido»
    y conteos actualizados. Hacia atrás se puede ir a cualquier columna anterior.
47. **Placement.** Llevá al candidato hasta Placement: la cobertura sube. Movelo hacia
    atrás. **Esperado:** diálogo «Salir de …» que explica que reduce las plazas cubiertas;
    cancelar no mueve nada; confirmar lo mueve y la cobertura baja.
48. **Conflicto (opcional).** Con el tablero abierto en dos pestañas, mové al candidato en
    una y después en la otra. **Esperado:** «Otro usuario movió a este candidato.
    Actualizamos el tablero.» y el tablero recargado, sin repetir el movimiento.
49. **Ficha y candidato.** Tocá la tarjeta. **Esperado:** ficha con la fecha de
    postulación, las respuestas de filtro, el historial (postulación y cada movimiento,
    con quién y cuándo) y el CV que se descarga. En `…/configuracion/columnas` solo se
    puede renombrar, con el aviso de que la vacante ya tiene candidatos. Como candidato,
    `/candidato/postulaciones` muestra «En proceso» («Enviada» mientras esté en la
    primera columna).

### Corte 5: descartar y recuperar (rama `feat/pipeline-discard-ui`, backend `feat/pipeline-discard`, migración 00024)

50. **Descartar.** En el tablero, abrí el menú de la tarjeta y elegí «Descartar».
    **Esperado:** diálogo con los motivos agrupados en «Decisión de la empresa» y
    «Decisión del candidato»; con «Otro» no deja confirmar sin comentario; los
    contadores no dejan pasar 1.000 (comentario) ni 500 (mensaje). Escribí un mensaje para
    el candidato y confirmá: la tarjeta pasa a «Descartados» con su motivo.
51. **Vista del candidato.** Como candidato, `/candidato/postulaciones` muestra
    «Finalizada» y tu mensaje, nunca el motivo interno.
52. **Recuperar.** En «Descartados», «Recuperar». **Esperado:** el diálogo nombra la
    etapa a la que vuelve; al confirmar, la tarjeta vuelve ahí y el candidato deja de ver
    el mensaje (vuelve a «Enviada» o «En proceso»). La ficha muestra en el historial el
    descarte (motivo, comentario, mensaje) y la recuperación.
53. **Placement (opcional).** Descartá a alguien que está en Placement: el diálogo avisa que
    baja la cobertura. Recuperalo: el diálogo avisa que vuelve a ocupar una plaza y la
    cobertura sube.

### Pulido de UI (rama `feat/ui-polish`, sin cambios de backend)

54. **Tipografía.** Recorré la app de empresa y de candidato. **Esperado:** todos los
    títulos en Inter (la misma letra del texto); la landing conserva su tipografía propia.
55. **Tablero y ficha.** En el pipeline: columnas teñidas por etapa que llegan hasta abajo
    con scroll propio, encabezado con «X de Y plazas cubiertas» compacto, tarjetas con
    iniciales, fechas cortas y chip del CV; la manija aparece al pasar el mouse o con el
    teclado. Abrí una ficha: barra superior con «Mover a…», «Descartar»/«Recuperar» y una
    sola X; pestañas «Resumen», «Respuestas», «Historial» con contador; línea de tiempo.
56. **Sidebar colapsado.** Cerrá el sidebar (empresa y candidato). **Esperado:** el isotipo «pf»
    centrado en lugar del logo aplastado (con su versión de tema oscuro); todos los ítems, «Nueva vacante» y el avatar son
    cuadrados iguales y centrados, también al pasar el mouse, seleccionados y con foco.
57. **Reordenar columnas.** En una vacante publicada **sin candidatos**, arrastrá una columna
    del medio desde la manija de su encabezado (o usá su menú con el teclado).
    **Esperado:** se guarda al soltar, con «Columnas reordenadas» y «{columna} ahora va
    después de {otra}»; «Nuevos», «Placement» y «Descartados» no se mueven. En una vacante
    con candidatos, la manija aparece bloqueada con la explicación.
58. **Toasts.** Mové, descartá y recuperá un candidato. **Esperado:** cada aviso dice qué
    pasó y con quién («Ana Pérez pasó a Screening») y abajo la consecuencia (etapa anterior,
    plazas cubiertas, motivo o si verá tu mensaje), sin repetir el título.
59. **Cards y skeletons.** Recorré empresa (dashboard, vacantes, «Publicar» con faltantes,
    configuración, equipo, talento, perfil), candidato (dashboard, perfil, CVs,
    postulaciones) y el sitio público. **Esperado:** cada tarjeta con su título arriba,
    acción o estado arriba a la derecha y botones de cierre al pie; mientras carga, el
    skeleton tiene la misma forma que lo que aparece (nada salta). Antes de entrar a
    /empresa o /candidato solo se ve un spinner discreto, no un formulario falso.
60. **Jerarquía y estados vacíos.** Recorré: pipeline de un borrador (badge «Vacante en
    borrador», «Configurar columnas» arriba, «Publicar vacante» principal y «Continuar
    editando» al lado, «Volver a Vacantes» fuera de la card); editor de borradores
    («Guardar» principal, «Publicar» secundario); ficha del candidato («Mover a…»
    principal); listados vacíos de vacantes, postulaciones, CVs, guardadas, talento y
    resultados públicos. **Esperado:** una sola acción principal por pantalla, salir de la
    pantalla nunca junto a ella, cada vacío dice qué pasa y qué hacer, y en el celular los
    botones se apilan.
61. **Crear una vacante.** En «Tus vacantes», el sidebar y la barra pública solo hay un
    botón para crear («Nueva vacante» / «Publicar vacante») y abre el editor de
    borradores. Entrar a `/empresa/vacantes/nueva` también lleva ahí. Con la lista vacía no
    aparece otro botón de crear: la descripción remite a «Nueva vacante».
62. **Cards y detalle públicos** (backend `feat/public-listing-enrichment`, `make db-migrate`
    aplica la 00025). En `/vacantes`, card como el diseño de v0: logo o iniciales,
    título, empresa y «Nueva» arriba a la derecha; condiciones con íconos (incluye el rango
    de postulantes); extracto; «Contrato · Nivel · Área»; «Habilidades» con «+N»;
    beneficios con «y N beneficios más» (lleva al detalle); pie con la compensación, «Ver
    vacante» y «Postulación rápida» o «N preguntas de filtro». En el detalle: encabezado,
    «La vacante de un vistazo», navegación por secciones, beneficios con íconos y la
    columna fija con «Postularme» y «Compartir vacante» («Enlace copiado»). En
    `/candidato/postulaciones`: card con estado arriba a la derecha y «Ver vacante».
63. **Estructuras comparables.** Recorré el listado de vacantes de la empresa, la ficha del
    candidato, el dashboard, talento, las cards de postulaciones, CVs y guardadas, la vista
    previa del borrador y el resumen de la postulación. **Esperado:** cada registro sigue
    identidad → condiciones → complemento → acción; los badges solo marcan estado o
    categoría y lo demás es texto con « · »; todo monto se lee como «$50,000 MXN» con su
    periodicidad y neto/bruto debajo (o dice que no se publican); en el celular las zonas
    se apilan sin achicar el texto.

### Corte 6: subestado por candidato (rama `feat/pipeline-substates-active-ui`, backend `feat/pipeline-substates-active`, migración 00026)

64. **Asignar.** Con un candidato en una columna de tipo «En proceso», abrí el menú de la
    tarjeta → «Subestado» y elegí uno. **Esperado:** badge con el subestado en la tarjeta y
    toast «… quedó en «…»» con el anterior en la descripción. En la ficha aparece el
    selector «Subestado» junto a «Mover a…»; en otras etapas no aparece.
65. **Filtrar.** Usá el filtro sobre el tablero: elegí uno o varios subestados y «Sin
    subestado». **Esperado:** solo quedan los de «En proceso» que coinciden; las columnas
    dicen «X de Y»; una columna sin coincidencias muestra «Ningún candidato coincide con el
    filtro»; «Limpiar» vuelve a mostrar todo.
66. **Salir, historial y catálogo.** Mové al candidato fuera de «En proceso». **Esperado:**
    pierde el subestado y el historial muestra el cambio a «Sin subestado» antes del
    movimiento. En la configuración de subestados, uno con candidatos tiene «Quitar»
    deshabilitado con la explicación; renombrarlo sí se puede.

### Corte de entrega (rama `feat/pipeline-delivery-fulfillment-ui`, backend `feat/pipeline-delivery-fulfillment`, migración 00027)

67. **Progreso.** En el pipeline de una vacante publicada, junto a la cobertura. **Esperado:**
    «Entrega: X de Y» con barra y «Faltan N días hábiles» («Vence hoy» / «Venció hace …»).
68. **Cumplir moviendo.** Llevá candidatos hasta la columna de corte hasta alcanzar el
    objetivo. **Esperado:** toast «Entrega cumplida» con cuántos llegaron, a qué columna y si
    fue a tiempo; el indicador pasa a «Entregada a tiempo» / «… antes» / «… de retraso».
    Descartar o mover después a alguien no cambia el resultado.
69. **Configuración.** En «Entrega» de otra vacante pendiente, bajá el objetivo a lo ya
    entregado y guardá. **Esperado:** confirmación con los candidatos que cuentan;
    «Cancelar» conserva lo editado; confirmar la cumple. En una vacante ya cumplida, «Entrega»
    es de solo lectura con el resultado congelado y los candidatos.

### Filtros del tablero (rama `feat/pipeline-board-filters-ui`, sin cambios de backend)

70. **Filtros y encabezado.** En el pipeline: cobertura y entrega forman un solo bloque con
    la misma forma; la barra tiene un único botón «Filtros». Abrilo. **Esperado:** Sheet
    «Filtrar candidatos» con ícono y descripción; secciones «PROCESO DE SELECCIÓN» («Etapa
    del pipeline» y, si hay catálogo, «Subestado») y «CANDIDATOS DESCARTADOS» («Motivo de
    descarte»); cada filtro es un desplegable con buscador, casillas y conteos discretos;
    una nota final explica cómo se combinan; el pie dice «N candidato(s) coincide(n)», los
    filtros activos, «Limpiar» y «Ver N candidato(s)» (plural correcto). Marcar aplica al
    instante; debajo de la barra aparecen chips removibles y «Limpiar filtros»; las
    columnas dicen «X de Y». El contenido nunca pasa por debajo del encabezado del Sheet.

71. **Confirmación antes de cada acción importante.** En el pipeline: arrastrá una tarjeta a
    otra columna. **Esperado:** se abre una confirmación con ícono, «¿Mover a {nombre} a
    {columna}?», la consecuencia y los botones «Cancelar» (con el foco) y «Mover»; la tarjeta
    sigue en su columna. «Cancelar» la deja donde estaba y no escribe nada. Repetí con
    «Mover a…» desde la tarjeta y desde la ficha, el cambio de subestado, el reordenar
    columnas (vacante sin candidatos), sacar y volver a Placement, descartar (motivo y
    mensaje dentro del mismo diálogo, botón rojo) y recuperar. Fuera del tablero: publicar,
    borrar un CV (rojo) y «Guardar y cumplir» la entrega. Un doble clic en el botón no
    ejecuta dos veces; con mucho contenido (descarte, lista de entrega) solo scrollea el
    medio y el título y los botones quedan visibles.

72. **Subestados sin crear.** En una vacante sin subestados, abrí la configuración de «En
    proceso». **Esperado:** chip «En proceso», «Configurar subestados» y su descripción;
    «Empieza con una sugerencia» como lista con «+ Agregar» por fila; «O crea un subestado
    personalizado» con un campo (Enter agrega) y la ayuda «Hasta 80 caracteres…». No hay
    sección «Tus subestados» vacía. Al agregar una sugerencia desaparece de la lista de
    sugerencias y aparece en tus subestados, que se ven igual que antes.

## 5. Verificación en la base (solo lectura)

Opcional, para confirmar lo que guardó Go:

```bash
docker exec -it peopleflow-vacancies psql -U <usuario> -d peopleflow_vacancies
```

Usá el usuario de tu `DATABASE_URL` sin pegarlo en el chat.

```sql
-- Empresa y membresía
SELECT c.id, c.name, c.rfc, c.status, m.role
FROM companies c JOIN company_members m ON m.company_id = c.id
WHERE c.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 5;

-- Borradores
SELECT id, company_id, status, version, created_at, updated_at,
       length(fields) AS bytes, convert_from(fields, 'UTF8') AS fields_json
FROM job_drafts ORDER BY created_at DESC LIMIT 5;

-- Catálogo de solicitantes
SELECT id, kind, name, created_at FROM job_draft_requesters
ORDER BY created_at DESC LIMIT 5;

-- Idempotencia del primer guardado
SELECT operation, idem_key, response_etag, created_at
FROM job_draft_idempotency ORDER BY created_at DESC LIMIT 5;
```

**Esperado:** empresa con `status = 'active'` y `role = 'owner'`; borrador con
`version = 1` después de crear y `2` después de guardar cambios; el solicitante
creado aparece en `job_draft_requesters` y en `fields_json` del borrador.

## 6. Qué reportar

Para cada paso: si funcionó o no, y el mensaje visible exacto si falló. Si algo
falla, en las herramientas de desarrollo podés anotar la ruta y el código HTTP,
pero **no** copies cabeceras, cookies ni cuerpos.

## 7. Al terminar

```bash
# Ctrl+C en make run y en el frontend
docker start nest-practice   # si lo habías frenado
```

Si todo pasa, el siguiente paso es integrar `feat/vacancy-publication-ui` en
`main`. La rama del backend la integra su propio agente. El push lo hacés vos.

73. **Editar columnas con candidatos (corte 7).** Backend en `feat/pipeline-column-editing`
    (`make db-migrate` aplica la 00028). En una vacante con candidatos, abrí Configuración →
    Columnas: agregá una columna propia antes de una columna con candidatos y guardá.
    **Esperado:** primero «Revisando impacto…», luego una confirmación «¿Guardar los cambios
    de columnas?» que lista quiénes quedan con «No aplica por cambio de proceso»; al
    confirmar, toast con el impacto aplicado y nadie cambia de columna. Quitá una columna
    con candidatos activos: error que la nombra y lleva al tablero. En el tablero, reordená
    una columna arrastrándola: misma vista previa y confirmación; «Cancelar» la deja en su
    lugar. En la ficha de un candidato afectado, el historial muestra «No aplica por cambio
    de proceso». Descartá a alguien, quitá su columna anterior y recuperalo: el diálogo
    avisa que su columna ya no existe y pide «Columna de regreso» con la sugerida marcada.

74. **Filtros por respuestas y perfil.** Backend en `feat/pipeline-filter-data`
    (`make db-migrate` aplica la 00029). Postulá a un candidato con perfil completo
    (ciudad, habilidades, experiencia, estudios) a una vacante con preguntas de opción
    única. En el tablero abrí «Filtros». **Esperado:** sección «PREGUNTAS DE FILTRO» con un
    filtro por pregunta (opciones + «Sin respuesta») y sección «PERFIL DEL CANDIDATO» con
    «Ciudad», «Habilidades», «Años de experiencia» (rangos), «Nivel de estudios», cada uno
    con «Sin dato». Filtrar aplica al instante con chips. En la ficha, bloque «Perfil» con
    los datos y «Copiado del perfil al postularse.»; postulaciones anteriores muestran
    «Sin dato». Mover o descartar al candidato no borra su perfil ni sus respuestas.

75. **Barra de filtros en una sola fila.** En el pipeline, activá varios filtros, incluidas
    dos preguntas de filtro con texto largo. **Esperado:** una sola barra con «Filtros» y
    su contador, los chips en una fila con scroll horizontal (nunca bajan el tablero) y
    «Limpiar» a la derecha. Los chips largos se cortan con «…»; al pasar el mouse o con el
    foco se ve el texto completo. Debajo: «Vista filtrada · Mostrando X de Y candidatos» y
    «Editar filtros», que abre el Sheet. Las columnas sin resultados dicen «Sin
    coincidencias» sin botones propios. En los desplegables del Sheet, las opciones al pasar
    el mouse y marcadas se resaltan con bordes redondeados, sin bloques cuadrados. Probalo
    en celular y en los dos temas.

76. **Ubicación estructurada de la vacante (G1 + G2).** Backend en `feat/geo-vacancy`.
    Desde `backend/`: `make db-migrate` (aplica 00030 y 00031) y después
    `DATABASE_URL=… make geo-import` (no lee el `.env`: exportá la variable en la misma
    terminal). Ojo: la 00031 borra la ubicación de los borradores y vacantes de prueba.
    En el editor de un borrador: la sección «Ubicación» tiene «Código postal», «Estado» y
    «Municipio». Escribí 44100. **Esperado:** se precargan Jalisco y Guadalajara, editables.
    Cambiá el municipio a uno de otro código: el código postal se borra con un aviso.
    Elegí otro país: solo queda el país con «Por ahora solo detallamos ubicaciones en
    México.». Poné la modalidad en Remoto: aparece «¿Desde dónde pueden postular?» con
    «Desde cualquier lugar» y «Solo desde estos países» (chips en el orden elegido, sin
    repetidos) y la ubicación pasa a «(opcional)». Intentá publicar sin completar: la lista
    de faltantes muestra «Agrega la ubicación de la vacante.», «Completa estado y
    municipio.» o «Indica desde dónde pueden postular.», cada uno con «Completar». Publicá
    y mirá la tarjeta y el detalle públicos: «Guadalajara, Jalisco» o «Remoto · Desde
    cualquier lugar» / «Solo desde México, Colombia y 2 más».

77. **Ubicación del candidato y de la empresa (G3) + perfil real del candidato.** Backend
    en `feat/geo-profiles` (`make db-migrate` aplica la 00032; el catálogo ya importado).
    **Candidato** (`/candidato/perfil`): el perfil ahora se carga y se guarda en el
    backend. «Agregar ubicación» muestra país, estado y municipio (sin código postal);
    «Quitar ubicación» la borra. Cambiá datos e idiomas y pulsá «Guardar perfil».
    **Esperado:** «Perfil guardado.» y al recargar sigue igual. Un idioma sin nivel no se
    puede guardar. En la postulación, la tarjeta «Tu perfil» muestra la ubicación
    («Guadalajara, Jalisco»). **Empresa** (Configuración → Empresa): al crearla, la
    ubicación es opcional (con código postal). El dueño ve «Editar ubicación» → diálogo →
    «Guardar ubicación» → «Ubicación actualizada.». Abrí el mismo diálogo en dos pestañas,
    guardá en una y después en la otra: aparece «Esto cambió en otro lugar» con los datos
    actuales, sin guardar solo. Un reclutador ve la ubicación sin el botón.

78. **Postulación por país y filtros por estado/municipio (G4).** Backend en `feat/geo-apply`
    (`make db-migrate` aplica la 00033). Publicá una vacante remota «Solo desde estos
    países» con México y Colombia. Como candidato **sin país** en el perfil, abrí
    «Postular». **Esperado:** «Esta vacante solo acepta postulantes de: México y
    Colombia.» y «Agrega tu país en tu perfil para postularte.» con «Completar perfil».
    Con país Argentina: «Tu perfil indica Argentina. Esta vacante no acepta postulaciones
    desde ahí.» y «Enviar postulación» deshabilitado. Con México: postulás normal. En el
    tablero de esa vacante, «Filtros» → «PERFIL DEL CANDIDATO» tiene «Estado» y
    «Municipio» (el municipio dice también su estado) con «Sin dato»; la ficha muestra
    «Ubicación». Las postulaciones viejas aparecen como «Sin dato».
