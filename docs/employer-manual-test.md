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
