# Registro de decisiones provisionales

> Documento autoritativo de **alcances temporales**. Leerlo antes de trabajar en
> onboarding, autenticación, *provisioning* o producción. No es la fuente total
> del estado del proyecto: solo fija qué es provisional, quién es dueño de cada
> alcance y cuándo/cómo se sale de él. Que algo "funcione en local" no lo vuelve
> definitivo.

## Cómo usar este registro

1. Antes de tocar identidad, auth, *provisioning* o producción, revisá la matriz
   y los límites del alcance que vayas a usar.
2. La presencia de código no establece despliegue ni verificación. Un futuro
   mecanismo local temporal, aunque se implemente, no equivale a adopción en
   producción ni a su retiro: registrá el estado exacto con evidencia y nunca
   cierres el alcance de forma implícita.
3. Para cambiarlo, agregá o actualizá una fila con evidencia observada y
   aprobación del owner. Un cambio sin registro no cuenta.
4. No prometas fechas, cobertura de tests ni infra cloud que no existan.

## Matriz de estado

| ID | Estado | Owner | Alcance | Reemplazo en producción |
|----|--------|-------|---------|-------------------------|
| TMP-IDENTITY-001 | Provisional — **IMPLEMENTADO Y VERIFICADO CON FICTICIOS**; sin aceptación real ni ejecución contra base real | Backend Go (peer) + Frontend (peer) | *Bootstrap*/alta de identidad local, **solo** tabla `users` | Trigger/servicio de *provisioning* productivo + infra cloud diseñada, desplegada y verificada |

## TMP-IDENTITY-001 — Bootstrap de identidad local (SOLO LOCAL / PROVISIONAL)

### Qué es

Mecanismo provisional para crear el registro local de identidad (fila en `users`)
de un empleador que ya se autenticó con Cognito, de modo que el backend pueda
resolver su usuario local. La implementación de la herramienta temporal está
**autorizada e implementada**, con verificación acotada mediante datos ficticios
(decisión «si, lo autorizo», alcance S1-S5), con `recruiter` como tipo y `profile`
agregado a los scopes del frontend. Esto no constituye aceptación real. Sigue
**prohibido** ejecutarla contra la base de datos real, desplegar infraestructura
o tocar AWS: esa ejecución requiere una aprobación humana posterior e
independiente. Guía de uso (solo nombres de configuración, sin secretos):
[`docs/local-identity-bootstrap.md`](./local-identity-bootstrap.md).

### Estado real verificado (no inferir más)

- **Bootstrap local (TMP-IDENTITY-001)**: implementado en frontend y backend;
  verificación independiente dirigida de sus correcciones y costura de protocolo
  **con ficticios**, sin ejecución contra la base real ni aceptación productiva.
  - Frontend: 238 tests de autocontrol y TypeScript/ESLint correctos; rechequeo
    independiente de 180 tests en 7 archivos, sin blockers en ese alcance.
  - Backend: correcciones de atributos UserInfo duplicados y cancelación del
    lector verificadas mediante pruebas públicas ficticias; no prueba Postgres real.
  - Costura única: bytes del handler Go real consumidos por el bridge/decoder
    frontend reales, sin servicios; estados `202 → 409 → 200`, contadores de
    creador ficticio `0 → 0 → 1`, tres llamadas simuladas y hashes sin cambios.
    No demuestra conexión ni coincidencia de secretos entre procesos reales.
  - Pendientes: navegador, cookies y sesión reales, atributos/permisos Cognito,
    terminal real y Postgres. La cancelación del body frontend se inspeccionó en
    código; los tests de deadline no afirman contadores de cancelación.
  - La suite global conserva el timeout RPC histórico sin aprobación ni repetición.
    La evaluación nativa no pudo aislar el candidato entre archivos pendientes;
    no existe aprobación nativa de review ni autorización de entrega.
  La verificación ficticia no implica adopción productiva ni retiro del mecanismo.
- **Cognito dev-login real**: el frontend Next.js mantiene sesión de Cognito.
- **Go + Postgres locales**: el backend Go y su Postgres corren en local.
- **Sin backend AWS**: no hay infraestructura de backend desplegada en AWS.
- **`PostConfirmation` existe solo como CÓDIGO**: no está *wired* ni desplegado;
  no se infiere su ejecución a partir de un login exitoso.
- **`backend_user_not_found`** (diagnóstico vivo): Go aceptó el JWT pero no pudo
  resolver el usuario local. Es un problema de *provisioning*, no de token.
- **Usuarios locales normales ≠ mecanismo temporal**: las filas del dominio local
  no son el mecanismo provisional, y **no** se promete migrar datos locales a
  producción.

### Límites y prohibiciones

- **Tipo aprobado para esta herramienta**: `recruiter`, autorizado explícitamente
  junto con la implementación. Cambiar el tipo exige otra decisión humana.
  El tipo `candidate`/`recruiter` **no** equivale a owner de empresa ni a membresía.
- **Alcance mínimo**: solo `users`. No crear ni alterar `companies`, membresías,
  grupos ni esquema.
- **Create/idempotencia**: el diseño implementado reutiliza el alta válida del
  backend y exige compatibilidad del perfil/tipo para la identidad existente por
  `sub`; ante conflicto, **detener**. Nunca fusionar por email, re-vincular ni
  sobrescribir una fila local. El comportamiento sobre Postgres real sigue sin probar.
- **Sin provisioning automático**: ningún `GET`, login ni `backend-check` debe
  provisionar usuarios.
- **Frontera frontend**: los tokens (access/refresh/ID) no deben exponerse al JS
  del navegador ni a la sesión pública. NextAuth guarda el JWT cifrado en cookies
  HttpOnly del navegador, gestionadas del lado servidor: **no** es
  almacenamiento exclusivamente server-side. Sin exposición de tokens en claro.
- **Credenciales**: no exportar credenciales por navegador, chat, argumentos de
  CLI ni logs.

### Diseño del canal (decidido, con observación pendiente)

- **Fuente/canal del `sub`/email/name verificados**: **decidido** por el diseño
  aprobado: el proceso Go local valida el access token y consulta el endpoint
  UserInfo de Cognito con `openid email profile`, usando el `sub` y los atributos
  verificados (correo verificado y nombre). No se infiere identidad desde un
  `sub` provisto manualmente.
  - **No observado**: que el App Client real permita leer `name`/perfil y que los
    atributos existan. Requiere un login nuevo con los scopes configurados.
  - **Sin cambios en AWS**: la implementación no modifica configuración de
    Cognito ni escribe nada en AWS.
- **Trigger/servicio de provisioning productivo**: sin decidir.
- **`PostConfirmation`**: opción posible, pero no garantiza cubrir usuarios ya
  existentes (retroactivo) ni la membresía de empresa.

### Criterios de salida

- Ruta de producción decidida, con la infra necesaria desplegada y verificada.
- Plan explícito para identidades ya existentes.
- Definir remoción/desactivación de la herramienta, o su restricción aprobada a
  soporte.
- Registrar evidencia + aprobación del owner; actualizar llamadores, docs y tests
  si la herramienta se implementó.

### Para producción (deliberado, no implícito)

Elegir el trigger/servicio de provisioning y la infra cloud con diseño y
verificación deliberados: procedencia del perfil, disponibilidad de grupos,
manejo de fallos y observabilidad **sin PII**. Considerar usuarios ya confirmados
y planificar el *backfill*.

## Historial de cambios

| Fecha | ID | Cambio | Evidencia / aprobación |
|-------|----|--------|------------------------|
| 2026-10-10 | TMP-IDENTITY-001 | Implementación autorizada; estado pasa a **IMPLEMENTACIÓN EN PROGRESO** (no verificada ni ejecutada contra base real) | Autorización «si, lo autorizo» (S1-S5); implementación frontend/backend con pruebas fake; ver [`docs/local-identity-bootstrap.md`](./local-identity-bootstrap.md) |
| 2026-10-10 | TMP-IDENTITY-001 | Corrección acotada post-verificación: vínculo de operación (cookie firmada ligada a sesión+nonce+código), deadline de lectura del cuerpo, comparación literal de Origin, cuerpo exacto `{}` en `/stage` e incertidumbre en la UI; autocontrol de escritor, **en esa etapa sin verificación independiente** | Batch acotado T2 con regresiones públicas nuevas; rechequeo dirigido pendiente en ese momento |
| 2026-10-10 | TMP-IDENTITY-001 | Estado **IMPLEMENTADO Y VERIFICADO CON FICTICIOS**; límites reales y provisionales intactos | Rechequeos dirigidos frontend B1–B5 y backend B1–B2 sin blockers; costura única de bytes Go→bridge frontend `202/409/200`, creador ficticio `0/0/1`, hashes sin cambios; no ejecución real ni aprobación nativa |
