# Prueba manual: empresa y borrador privado (empleador)

Guía para probar en el navegador, de punta a punta, el flujo
**login recruiter → crear empresa → guardar borrador privado → encontrarlo en la
lista → reabrirlo, editarlo y guardarlo** contra la API Go real. Esta prueba es el
requisito para integrar `feat/draft-list-and-reopen` en `main`.

- Rama frontend: `feat/draft-list-and-reopen`.
- Rama backend: `feat/draft-list` (incluye todo lo de `main`, con el catálogo de
  solicitantes, más la lista de borradores). No requiere migración nueva, pero
  corré `make db-status` igual.
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
   «Guardar cambios».
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
8. **Lista.** Entrá a `/empresa/vacantes` y presioná «Borradores» (o andá a
   `/empresa/vacantes/borradores`). **Esperado:** el borrador aparece primero,
   con su título (o «Sin título»), el solicitante, tu nombre como reclutador y la
   fecha de la última actualización. Con más de 20 borradores aparece «Cargar
   más». «Actualizar» vuelve a cargar la lista desde el principio.
9. **Reabrir sin cambios.** Presioná «Abrir» en el borrador. **Esperado:** el
   editor muestra todos los datos guardados, incluidas las preguntas de filtro y
   la descripción, y el botón dice «Guardar cambios». Andá al último paso y
   guardá sin editar nada: la versión sube y, en la base (sección 5), `fields_json`
   queda igual que antes.
10. **Reabrir y editar.** Cambiá un campo y presioná «Guardar cambios».
    **Esperado:** aviso «Cambios guardados», versión siguiente, y en la lista el
    borrador sube al principio con la fecha nueva al presionar «Actualizar».
11. **Conflicto (opcional).** Abrí el mismo borrador en dos pestañas, guardá en
    una y después en la otra. **Esperado:** la segunda muestra «Esto cambió en
    otro lugar» y no pisa los cambios de la primera.
12. **Borrador inexistente.** Entrá a
    `/empresa/vacantes/borradores/00000000-0000-4000-8000-000000000000`.
    **Esperado:** un estado vacío que dice que el borrador no existe o no tenés
    acceso, con un enlace a la lista. Una dirección que no es un id muestra la
    página 404.

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

Si todo pasa, el siguiente paso es integrar `feat/draft-list-and-reopen` en
`main`. La rama del backend la integra su propio agente. El push lo hacés vos.
