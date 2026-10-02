# Ejecutar la demo local con `pnpm start`

El modo local permite usar el build de producción de Next con la API mock HTTP.
No cambia `NODE_ENV` ni desactiva la exigencia de HTTPS para despliegues públicos.

## Configuración

Con Node 22, crea o actualiza `frontend/.env.local`:

```dotenv
PEOPLEFLOW_LOCAL_PREVIEW=true
PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:4110
PEOPLEFLOW_SITE_URL=http://localhost:3000
PEOPLEFLOW_API_TIMEOUT_MS=8000
```

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

## Límites de seguridad

- `PEOPLEFLOW_LOCAL_PREVIEW` acepta únicamente `true`, `false` o ausencia.
- Con `true`, **ambas** URLs deben usar `localhost`, `127.0.0.1` o `[::1]`.
  No se admiten hosts públicos, direcciones LAN ni combinaciones público/local.
- Sin la opción, producción sigue exigiendo HTTPS en ambas URLs.
- La validación de credenciales, rutas, query, fragmentos y timeout no cambia.
- Para desplegar, elimina la opción o usa `false` y configura URLs HTTPS reales.
- Para limitar el servidor de la demo a esta máquina puedes usar
  `pnpm start --hostname 127.0.0.1`.
