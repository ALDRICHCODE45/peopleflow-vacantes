# Seguir el proyecto en otra máquina (laptop)

Guía para continuar en otra computadora exactamente donde quedó el trabajo del 2026-10-28:
backend en `feat/vacancy-checklist-backend` y frontend en `feat/vacancy-checklist` (incluye
`chore/backlog-small-fixes`), con la misma base de datos y los mismos archivos subidos.

Lo que **no** viaja con `git clone` y hay que llevar a mano (nunca lo subas a ningún lado):

| Qué | Dónde está hoy |
| --- | --- |
| Dump de la base (migración 48) y CVs/imágenes | `peopleflow-vacantes/.transfer/` (ignorada por git) |
| `backend/.env` | `peopleflow-vacantes/backend/.env` |
| `frontend/.env` y `frontend/.env.local` | `peopleflow-vacantes-frontend/frontend/` |
| Sesión de Playwright (opcional) | `peopleflow-vacantes-frontend/frontend/.playwright-auth/` |

## A. En esta máquina, antes de salir

```bash
cd ~/Desktop/workspace/peopleflow-vacantes

# 1. Subir las tres ramas (main ya está en GitHub).
git push -u origin chore/backlog-small-fixes feat/vacancy-checklist feat/vacancy-checklist-backend

# 2. Juntar los .env en la carpeta privada .transfer/ (ignorada por git).
cp backend/.env .transfer/backend.env
cp ../peopleflow-vacantes-frontend/frontend/.env .transfer/frontend.env
cp ../peopleflow-vacantes-frontend/frontend/.env.local .transfer/frontend.env.local
cp -r ../peopleflow-vacantes-frontend/frontend/.playwright-auth .transfer/playwright-auth   # opcional
chmod -R go-rwx .transfer

# 3. Copiar .transfer/ a la laptop por un medio privado (USB, scp a tu propia máquina).
ls -la .transfer
```

Integridad esperada en la laptop (`sha256sum .transfer/*`):

- `peopleflow_vacancies-2026-10-28.dump` → `c6cde855f193f92d526e83d67e73c587a319391f5bd1da839e14d75ae7596e21`
- `cv_temporal-2026-10-28.tar.gz` → `848df8dd88c4d3e8f6ec040c75faa45ac43031817429df7a98f0daa2e6870905`

## B. En la laptop

Requisitos: git con tu llave SSH de GitHub, Docker, Go 1.26.1, Node 22 (el frontend exige
`>=22 <23`) y Corepack (trae pnpm 10.34.5).

```bash
# 1. Clonar: el worktree principal es el backend.
mkdir -p ~/Desktop/workspace && cd ~/Desktop/workspace
git clone git@github.com:ALDRICHCODE45/peopleflow-vacantes.git peopleflow-vacantes
cd peopleflow-vacantes
git switch feat/vacancy-checklist-backend

# 2. Worktree del frontend, en su rama (una rama no puede estar en dos worktrees).
git worktree add ../peopleflow-vacantes-frontend feat/vacancy-checklist

# 3. Poner .transfer/ en la raíz del clone y verificar.
#    (copiala desde tu USB a ~/Desktop/workspace/peopleflow-vacantes/.transfer)
chmod -R go-rwx .transfer && sha256sum .transfer/*.dump .transfer/*.tar.gz

# 4. Archivos .env.
cp .transfer/backend.env backend/.env
cp .transfer/frontend.env ../peopleflow-vacantes-frontend/frontend/.env
cp .transfer/frontend.env.local ../peopleflow-vacantes-frontend/frontend/.env.local
cp -r .transfer/playwright-auth ../peopleflow-vacantes-frontend/frontend/.playwright-auth   # opcional

# 5. Base de datos: Postgres 16 vacío y restaurar el dump.
#    NO corras `make db-migrate` antes: el dump ya trae el esquema y goose en la versión 48.
#    Si el puerto 5432 está ocupado por otro Postgres, detenelo primero.
cd backend
docker compose up -d
docker compose ps        # esperá «healthy»
docker exec -i peopleflow-vacancies pg_restore -U admin -d peopleflow_vacancies \
  --no-owner --no-acl --exit-on-error < ../.transfer/peopleflow_vacancies-2026-10-28.dump
docker exec peopleflow-vacancies psql -U admin -d peopleflow_vacancies -Atc \
  "select max(version_id) from goose_db_version"     # → 48

# 6. CVs e imágenes del sitio (la API corre en modo disco: comparten CV_STORAGE_ROOT).
mkdir -p ~/Documents && tar -C ~/Documents -xzf ../.transfer/cv_temporal-2026-10-28.tar.gz
echo "$HOME/Documents/cv_temporal"   # poné esta ruta absoluta en CV_STORAGE_ROOT de backend/.env

# 7. API Go en :8080 (carga backend/.env).
go run ./cmd/api
#    en otra terminal:
curl -s localhost:8080/healthz && curl -s localhost:8080/readyz

# 8. Frontend en :3000 (otra terminal).
cd ~/Desktop/workspace/peopleflow-vacantes-frontend/frontend
corepack enable
pnpm install
pnpm dev
```

Abrí `http://localhost:3000/empresa/login` y entrá con Cognito como siempre: `NEXTAUTH_URL`
sigue siendo `http://localhost:3000`, así que las URLs de Cognito no cambian.

## C. Comprobar que quedó igual

- `/empresa/vacantes`: aparece «Software Developer» con sus 4 candidatos.
- `/empresa/vacantes/01a13ce2-ddaf-73e7-848c-367979b20ead/configuracion/checklist`: el checklist
  de 16 criterios.
- En el pipeline, la ficha de un candidato descarga su CV (prueba de que `CV_STORAGE_ROOT` quedó bien).
- Revisión pendiente del checklist: paso 91 de `docs/employer-manual-test.md` y el ítem 3 de
  `docs/pending-user-review.md`.

## Notas

- `peopleflow-vacantes-frontend` es un worktree del mismo clone: commits, ramas y stash se
  comparten. Abrí una sesión del agente en cada carpeta (backend y frontend) como acá.
- MinIO (`backend/docker-compose.minio.yml`, `backend/docs/site-media.md`) solo hace falta con
  `SITE_MEDIA_STORAGE=s3`; hoy la API usa modo disco y no lo necesita.
- Cuando apruebes el checklist, las dos ramas se mergean a `main` en el worktree principal
  (backend) y el push lo hacés vos.
