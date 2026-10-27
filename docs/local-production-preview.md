# Ejecutar la demo local con `pnpm start`

El modo local permite usar el build de producción de Next con la API mock HTTP.
No cambia `NODE_ENV` ni desactiva la exigencia de HTTPS para despliegues públicos.

## Configuración

Con Node 22, crea o actualiza `frontend/.env.local`:

```dotenv
PEOPLEFLOW_LOCAL_PREVIEW=true
PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:4110
PEOPLEFLOW_SITE_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000
PEOPLEFLOW_API_TIMEOUT_MS=8000
```

`NEXTAUTH_URL` sigue la misma regla: con `PEOPLEFLOW_LOCAL_PREVIEW=true` puede ser
`http` en el build de producción, siempre que sea loopback. `COGNITO_DOMAIN` y
`COGNITO_ISSUER` siguen siendo solo HTTPS.

Desde `frontend/`:

```bash
pnpm build
pnpm start
```

Abre `http://localhost:3000`. El archivo de entorno debe estar presente tanto al
construir como al iniciar. Después de cambios de código, vuelve a ejecutar el build.
No ejecutes `pnpm dev` y `pnpm build` simultáneamente sobre el mismo `.next`.

## API de prueba

Las páginas públicas de vacantes necesitan la API. Si no existe ya un proceso en
el puerto 4110, puedes iniciarlo en otra terminal desde `frontend/`:

```bash
JOBS_FIXTURE_PORT=4110 node tests/fixtures/jobs-server.mjs
```

No inicies una segunda instancia si ese puerto ya está ocupado. La API mock
solo contiene los registros de prueba: IDs desconocidos seguirán dando 404.

## Careers: sitio público y editor

El spec `tests/e2e/company-careers.spec.ts` usa la misma API fixture en `:4010` y
un build de producción en `:3100`. Para el editor, usa **localhost** (no
`127.0.0.1`) tanto en `PEOPLEFLOW_SITE_URL`, `NEXTAUTH_URL` como en
`PLAYWRIGHT_APP_ORIGIN`: la sesión del empleador está ligada a ese host.

1. Inicia sesión con una cuenta de prueba de empleador y guarda su storage state
   mediante el harness en una ruta gitignored, por ejemplo
   `frontend/.playwright-auth/employer.json`. No copies cookies ni tokens a docs,
   logs o commits. La fixture no genera sesiones ni omite las validaciones de identidad.
2. Antes del build y del arranque, configura la API en `http://127.0.0.1:4010`,
   `PEOPLEFLOW_LOCAL_PREVIEW=true`, `PEOPLEFLOW_SITE_URL=http://localhost:3100`
   y `NEXTAUTH_URL=http://localhost:3100`. Usa el mismo secreto de sesión del
   servidor donde se inició sesión; no lo imprimas. No compartas `.next` con dev.
3. Opcionalmente, al iniciar la fixture, `COMPANY_SITE_FIXTURE_IMAGES` acepta rutas
   locales de fotos separadas por `:`. Se asignan circularmente a portada, galería,
   retrato e historia. Sin esa variable se reutiliza la imagen licenciada del repo;
   no se descargan imágenes. Las fotos de revisión no se versionan.

Desde `frontend/`, con app y fixture ya levantadas:

```bash
PLAYWRIGHT_APP_ORIGIN=http://localhost:3100 \
PLAYWRIGHT_FIXTURE_ORIGIN=http://127.0.0.1:4010 \
PLAYWRIGHT_EMPLOYER_STORAGE_STATE=.playwright-auth/employer.json \
pnpm exec playwright test tests/e2e/company-careers.spec.ts
```

Ejemplo de arranque de la fixture con fotos opcionales:

```bash
JOBS_FIXTURE_PORT=4010 \
COMPANY_SITE_FIXTURE_IMAGES=/ruta/local/portada.webp:/ruta/local/equipo.jpg \
node tests/fixtures/jobs-server.mjs
```

Cada caso restablece `/__reset`; no ejecutes otra suite que cambie esta fixture al
mismo tiempo. Sin `PLAYWRIGHT_EMPLOYER_STORAGE_STATE`, solo los cuatro casos del
editor se omiten con un mensaje explícito; los cinco públicos deben correr. Si
caduca la sesión, vuelve a iniciar sesión y capturar el estado. Para comprobar
solo descubrimiento y tipos (sin navegador):

```bash
pnpm exec playwright test --list tests/e2e/company-careers.spec.ts
pnpm -s typecheck --incremental false
```

El typecheck principal incluye `tests/**/*.ts`. Rutas, roles y publicación:
[Constructor del sitio de empleo](company-careers-builder.md).

## Límites de seguridad

- `PEOPLEFLOW_LOCAL_PREVIEW` acepta únicamente `true`, `false` o ausencia.
- Con `true`, `PEOPLEFLOW_API_BASE_URL`, `PEOPLEFLOW_SITE_URL` y `NEXTAUTH_URL` deben
  usar `localhost`, `127.0.0.1` o `[::1]`. No se admiten hosts públicos, direcciones
  LAN ni combinaciones público/local (tampoco en `pnpm dev` mientras la opción esté
  en `true`).
- Sin la opción, producción sigue exigiendo HTTPS en esas URLs.
- Con HTTP local, NextAuth usa cookies sin `Secure`; es lo esperado en loopback.
- La validación de credenciales, rutas, query, fragmentos y timeout no cambia.
- Para desplegar, elimina la opción o usa `false` y configura URLs HTTPS reales.
- Para limitar el servidor de la demo a esta máquina puedes usar
  `pnpm start --hostname 127.0.0.1`.

## Pruebas e2e contra el build de producción

Los specs de Playwright se corren contra `next build` + `next start`, no contra
`pnpm dev`: en modo desarrollo aparecen fallos que no existen en producción
(redirecciones, hidratación tardía, violaciones de axe del overlay de Next).
`playwright.config.ts` no levanta servidores; la app va en `:3100` y la API mock en
`:4010`. Desde `frontend/`, con los puertos libres:

```bash
export PEOPLEFLOW_LOCAL_PREVIEW=true \
  PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:4010 \
  PEOPLEFLOW_SITE_URL=http://127.0.0.1:3100 \
  NEXTAUTH_URL=http://127.0.0.1:3100 \
  PEOPLEFLOW_API_TIMEOUT_MS=1000 \
  JOBS_FIXTURE_PORT=4010 \
  PLAYWRIGHT_FIXTURE_ORIGIN=http://127.0.0.1:4010
node tests/fixtures/jobs-server.mjs &   # API mock
pnpm build
pnpm start --hostname 127.0.0.1 --port 3100 &
pnpm exec playwright test tests/e2e/vacantes.spec.ts tests/e2e/vacantes-a11y.spec.ts \
  tests/e2e/vacante-detalle.spec.ts tests/e2e/vacante-postular.spec.ts
```

Resultado esperado: 83 tests, todos en verde y ninguno sin correr.

- Las variables de entorno de la terminal tienen prioridad sobre `.env.local`.
- `PEOPLEFLOW_API_TIMEOUT_MS=1000` es el valor con el que los specs prueban los
  timeouts de la API.
- `vacante-postular.spec.ts` lee `PLAYWRIGHT_FIXTURE_ORIGIN` (por defecto `:4011`);
  apuntarlo a `:4010` permite usar una sola API mock para todos los specs.
- Los specs corren en modo independiente: un fallo no esconde el resto. Un
  resultado solo es válido si no queda ningún test como «did not run».
- No uses `route.abort()` sobre los prefetch de Next salvo el de los detalles
  (`/vacantes/<id>`) que ya hace `vacantes.spec.ts`: abortarlos puede hacer que
  la navegación siguiente a esa URL se pierda.
- El área privada del candidato (`/candidato/*`) no tiene e2e: hace falta una
  sesión de prueba.
- «renders the approved hero…» fallaba alrededor de 1 de cada 5 corridas porque el
  filtro rápido «Todas» perdía su navegación; la causa era el `loading.tsx` del
  listado (ver `odd/tasks/next-16-upgrade.md`) y ya no existe.
- Después de cambiar código de `src/`, vuelve a ejecutar `pnpm build` antes de
  repetir los specs.
