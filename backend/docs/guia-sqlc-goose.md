# Guía operativa: goose + sqlc

Referencia del flujo de migraciones (**goose**) y generación de código (**sqlc**)
en el backend de `peopleflow-vacantes`. Documenta cómo está configurado hoy,
qué hace cada pieza y **por qué**, para no depender de la memoria.

Todos los comandos se ejecutan desde la carpeta `backend/`.

---

## 1. Qué hace cada herramienta y por qué van juntas

| Herramienta | Rol                                                         | Entrada                                                                | Salida                                                         |
| ----------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| **goose**   | Aplica/revierte cambios de schema en la base (migraciones). | Archivos `.sql` en `db/migrations/`.                                   | Tablas/índices creados en Postgres + tabla `goose_db_version`. |
| **sqlc**    | Genera código Go type-safe a partir de tu SQL.              | El **schema** (lee las migraciones) + tus **queries** (`db/queries/`). | Código en `internal/db/` (NO se edita a mano).                 |

**El detalle clave (y el "por qué" del orden de trabajo):**
sqlc NO tiene su propio archivo de schema. Lee el schema **directamente desde las
migraciones de goose** (`schema: "db/migrations"` en `sqlc.yaml`). sqlc entiende
las anotaciones `-- +goose` y arma el modelo de las tablas a partir de ellas.

Consecuencia práctica: **primero la migración, después la query, después generás.**
Si cambiás una columna, primero la cambiás en una migración goose, y recién ahí
sqlc "ve" el cambio cuando corrés `sqlc generate`.

```
cambio de schema  ->  migración goose  ->  goose up  ->  query SQL  ->  sqlc generate  ->  código Go
```

---

## 2. Instalación: por qué `go tool` y no global

Las herramientas están **pineadas** como tools del módulo en `go.mod`:

```go
tool (
	github.com/pressly/goose/v3/cmd/goose
	github.com/sqlc-dev/sqlc/cmd/sqlc
)
```

Esto significa que la versión queda fija y reproducible por proyecto
(goose `v3.27.1`, sqlc `v1.31.1`). No se instalan globales que se pisen entre
proyectos. Se invocan con `go tool`:

```bash
go tool goose --version
go tool sqlc version
```

> Si clonás el repo en otra máquina, no hay que "instalar" nada aparte:
> `go mod download` baja también estas tools.

---

## 3. Base de datos: levantar Postgres y connection string

Postgres corre en Docker (`docker-compose.yml`): usuario `admin`,
password `secreto`, base `peopleflow_vacancies`, puerto `5432`.

```bash
docker compose up -d        # levanta Postgres en segundo plano
docker compose ps           # verificar que está "healthy"
docker compose down         # apagar (los datos persisten en el volumen)
docker compose down -v      # apagar y BORRAR los datos (volumen incluido)
```

El connection string que sale de esa config:

```
postgres://admin:secreto@localhost:5432/peopleflow_vacancies?sslmode=disable
```

`sslmode=disable` porque es local en Docker, sin TLS. Es el mismo valor que
consume el binario `cmd/api` vía la variable de entorno `DATABASE_URL`.

Para no repetir el string en cada comando de goose, exportalo una vez por sesión
de terminal:

```bash
export DATABASE_URL="postgres://admin:secreto@localhost:5432/peopleflow_vacancies?sslmode=disable"
```

---

## 4. goose: migraciones

### 4.1. Anotaciones dentro del archivo (`-- +goose ...`)

Una migración es un solo archivo `.sql` con DOS secciones marcadas por comentarios
especiales que goose lee:

```sql
-- +goose Up
CREATE TABLE industries ( ... );
INSERT INTO industries (...) VALUES (...);

-- +goose Down
DROP TABLE industries;
```

| Anotación        | Qué es                                                   | Por qué la incluimos                                                      |
| ---------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| `-- +goose Up`   | Lo que se ejecuta al **aplicar** la migración (avanzar). | Define el cambio que querés en la base.                                   |
| `-- +goose Down` | Lo que se ejecuta al **revertir** (`goose down`).        | Permite deshacer el cambio. Sin `Down`, no podés rollbackear esa versión. |

Regla de oro: el `Down` debe **deshacer exactamente** lo que hizo el `Up`.
Si el `Up` crea una tabla, el `Down` la dropea. Si el `Up` agrega una columna,
el `Down` la elimina.

### 4.2. `StatementBegin` / `StatementEnd` (cuándo hacen falta)

goose separa los statements por punto y coma (`;`). Eso funciona para SQL normal
(como nuestras migraciones actuales, que son `CREATE TABLE`, `INSERT`, `CREATE INDEX`).

**El problema:** si un solo statement contiene `;` internos —por ejemplo una función
PL/pgSQL, un `DO $$ ... $$` o un trigger— goose lo cortaría mal. Para esos casos
se envuelve el statement:

```sql
-- +goose Up
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
```

> Hoy NO lo usamos porque ninguna migración tiene funciones/bloques. Queda
> documentado para cuando aparezca el primer trigger o función.

### 4.3. Convención de nombres

Los archivos van con prefijo numérico secuencial + nombre descriptivo:

```
db/migrations/
  00001_create_industries.sql
  00002_create_companies.sql
```

goose aplica las migraciones **en orden por ese número**. El número es la "versión".
Nunca renumeres ni edites una migración ya aplicada en un entorno compartido:
para cambiar algo, se crea una migración nueva.

### 4.4. Comandos de goose

Todos llevan `-dir db/migrations`, el driver (`postgres`) y el connection string.

```bash
# Crear una nueva migración vacía (genera el archivo con el timestamp/secuencia)
go tool goose -dir db/migrations create nombre_descriptivo sql

# Ver estado: qué migraciones están aplicadas y cuáles pendientes
go tool goose -dir db/migrations postgres "$DATABASE_URL" status

# Aplicar TODAS las migraciones pendientes (avanzar al final)
go tool goose -dir db/migrations postgres "$DATABASE_URL" up

# Aplicar solo la siguiente migración pendiente
go tool goose -dir db/migrations postgres "$DATABASE_URL" up-by-one

# Revertir la ÚLTIMA migración aplicada (ejecuta su sección Down)
go tool goose -dir db/migrations postgres "$DATABASE_URL" down

# Revertir y volver a aplicar la última (útil mientras desarrollás una migración)
go tool goose -dir db/migrations postgres "$DATABASE_URL" redo

# Ver el número de versión actual de la base
go tool goose -dir db/migrations postgres "$DATABASE_URL" version
```

> `create ... sql` genera el esqueleto del archivo con las anotaciones
> `-- +goose Up` / `-- +goose Down` ya puestas. Solo completás el SQL.

goose lleva la cuenta de qué se aplicó en una tabla propia llamada
`goose_db_version` dentro de tu base. Por eso `up` es idempotente: no vuelve a
correr lo ya aplicado.

---

## 5. sqlc: generación de código

### 5.1. El `sqlc.yaml` explicado

```yaml
version: "2"
sql:
  - engine: "postgresql" # dialecto: Postgres
    schema: "db/migrations" # de DÓNDE saca el schema -> las migraciones goose
    queries: "db/queries" # dónde están tus archivos .sql de queries
    gen:
      go:
        package: "db" # nombre del paquete Go generado
        out: "internal/db" # carpeta de salida del código generado
        sql_package: "pgx/v5" # usa el driver pgx v5 (no database/sql)
        emit_json_tags: true # los structs llevan tags `json:"..."`
        emit_interface: true # genera la interface Querier (útil para mocks)
        overrides:
          - db_type: "uuid"
            go_type: "github.com/google/uuid.UUID"
```

**Los puntos que importan y por qué:**

- `schema: "db/migrations"` → este es el acople con goose. sqlc no tiene schema propio.
- `sql_package: "pgx/v5"` → genera código que usa el pool/driver pgx que ya usamos
  en `main.go`. Define los tipos: por ejemplo, columnas `NOT NULL` → tipo nativo Go,
  columnas nullable → `pgtype.Text`, `pgtype.Timestamptz`, etc.
- `emit_interface: true` → genera la interface `Querier`, que te deja mockear la capa
  de datos en tests.
- `overrides` `uuid → google/uuid.UUID` → por defecto sqlc mapearía `uuid` a otro tipo;
  acá forzamos que use `github.com/google/uuid.UUID`, que es el que maneja el dominio.

> Recordá la interface **`DBTX`**: tanto el pool de pgx como una `pgx.Tx` la cumplen.
> Por eso el mismo `Queries` sirve con o sin transacción.

### 5.2. Anotaciones en las queries (`-- name: ... :tipo`)

Cada query lleva un comentario mágico que le dice a sqlc cómo generar la función:

```sql
-- name: CreateCompany :one
INSERT INTO companies (id, name, rfc, industry_id, website, logo_url)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetCompanyByID :one
SELECT * FROM companies
WHERE id = $1 AND deleted_at IS NULL;
```

- `name: CreateCompany` → nombre del método Go generado.
- El sufijo define qué devuelve la función:

| Sufijo  | Devuelve                  | Cuándo usarlo                                 |
| ------- | ------------------------- | --------------------------------------------- |
| `:one`  | una fila (struct) + error | SELECT/INSERT...RETURNING de un solo registro |
| `:many` | slice de filas + error    | SELECT que trae varias filas (listados)       |
| `:exec` | solo error                | INSERT/UPDATE/DELETE sin RETURNING            |

- Los `$1, $2, ...` son parámetros posicionales → sqlc los convierte en argumentos
  tipados de la función Go (queries parametrizadas, a salvo de inyección SQL).

### 5.3. Generar

```bash
go tool sqlc generate     # regenera todo internal/db/
go tool sqlc vet          # opcional: analiza las queries sin generar
```

Salida en `internal/db/`: `companies.sql.go` (los métodos), `models.go` (los structs
de las tablas), `querier.go` (la interface `Querier`), `db.go` (el wiring `New(DBTX)`).

> **Nunca edites `internal/db/` a mano.** Es código generado: tu cambio se pierde en
> el próximo `sqlc generate`. Si querés otra query, la agregás en `db/queries/` y
> regenerás.

---

## 6. Flujo completo de trabajo (cheat sheet)

Cuando necesitás un cambio en la base + código nuevo:

1. **Crear la migración**
   ```bash
   go tool goose -dir db/migrations create lo_que_sea sql
   ```
2. **Escribir el `Up` y el `Down`** en el archivo nuevo (el `Down` deshace el `Up`).
3. **Aplicarla**
   ```bash
   go tool goose -dir db/migrations postgres "$DATABASE_URL" up
   ```
   Verificá con `status`.
4. **Escribir/ajustar la query** en `db/queries/*.sql` con su `-- name: ... :tipo`.
5. **Generar el código**
   ```bash
   go tool sqlc generate
   ```
6. **Usar** el método generado desde la capa de infraestructura en Go.

Si te equivocaste en una migración que todavía solo aplicaste en local:

```bash
go tool goose -dir db/migrations postgres "$DATABASE_URL" down   # revertir
# editás el archivo
go tool goose -dir db/migrations postgres "$DATABASE_URL" up      # reaplicar
```

---

## 7. Gotchas que ya nos cruzamos

- **Orden goose → sqlc:** sqlc no ve un cambio de schema hasta que está en una
  migración. No alcanza con tenerlo en la base; tiene que estar en `db/migrations/`.
- **Nullable vs NOT NULL:** columnas `NOT NULL` generan tipo nativo Go; nullable
  generan `pgtype.*`. Esto define cómo mapeás entidad ↔ struct sqlc en el repo.
- **`RETURNING *` + `:one`** te devuelve la fila completa ya tipada: úsalo para no
  tener que hacer un SELECT extra después del INSERT.
- **Reproducibilidad:** las tools viven en `go.mod` (`go tool`), no globales.
  Cualquiera con el repo corre las mismas versiones.
