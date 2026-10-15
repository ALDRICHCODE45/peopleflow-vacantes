# Bootstrap local de identidad (temporal, solo local)

> Estado: **IMPLEMENTACIÓN EN PROGRESO**. El código existe, pero **no** fue
> ejecutado contra una base real ni verificado funcionalmente de punta a punta.
> Leé primero [`docs/temporary-decisions.md`](./temporary-decisions.md)
> (TMP-IDENTITY-001), que es el registro autoritativo del alcance temporal.

Este documento explica la herramienta provisional que crea la fila de identidad
local (`users`) de un empleador ya autenticado con Cognito. Es **solo local**,
está **deshabilitada por defecto**, es **solo usuarios** y **no crea empresas,
membresías, grupos ni esquema**. No hay ninguna acción automática: la creación
solo ocurre cuando una persona prepara, aprueba en la terminal local privada y
confirma explícitamente.

## Camino rápido (solo cuando exista aprobación humana posterior)

1. Un operador habilita la configuración server-only descrita abajo y levanta la
   herramienta local de bootstrap (proceso Go, a cargo del alcance de backend).
2. Un empleador inicia sesión con Cognito y abre `/empresa/bootstrap-local`.
3. Presiona **Preparar operación local**: la página pide un nonce anti-CSRF de
   solo lectura (`/api/auth/local-bootstrap/nonce`) y hace `POST /stage` a la
   herramienta local. Esto **no escribe** en la base.
4. En la **terminal local privada de la herramienta**, un humano revisa el correo
   verificado que muestra la terminal (único canal autorizado) y aprueba o
   rechaza la operación con el código de operación.
5. Recién entonces, en la página, presiona **Aplicar operación aprobada**. La
   página resuelve la sesión privada **actual** y hace `POST /apply`.
6. El resultado visible es solo el código opaco de operación, su vencimiento y un
   estado sanitizado (`created` / `already_exists`). Nada de perfil ni PII.

**La ejecución contra la base de datos real requiere una aprobación humana
posterior e independiente, antes de que cualquier persona ejecute la
herramienta.** Esta guía no autoriza esa ejecución.

## Configuración (solo NOMBRES, nunca valores)

Server-only, en tiempo de ejecución. No se exportan valores por chat, CLI, logs
ni respuestas del navegador.

| Variable (frontend) | Obligatoria cuando está habilitado | Regla |
| --- | --- | --- |
| `PEOPLEFLOW_LOCAL_BOOTSTRAP_ENABLED` | sí | `true` habilita; por defecto está **deshabilitado**. En producción se rechaza. |
| `PEOPLEFLOW_LOCAL_BOOTSTRAP_BASE_URL` | sí | Origen `http://127.0.0.1:<puerto>` literal, sin credenciales, ruta, query ni fragmento. |
| `PEOPLEFLOW_LOCAL_BOOTSTRAP_KEY` | sí | Clave server-only de al menos 32 bytes, sin espacios ni caracteres de control. Debe coincidir con la del backend. |
| `NEXTAUTH_URL` | ya requerida | Origen local confiable; es el único origen aceptado en `POST`. Nunca se usa `Host` ni `X-Forwarded-Host`. |
| `NEXTAUTH_SECRET` | ya requerida | Se usa como clave de firma del nonce anti-CSRF ligado a la sesión. |

La misma frontera del backend usa nombres propios (propiedad del alcance de
backend): `IDENTITY_LOCAL_BOOTSTRAP_ENABLED`, `IDENTITY_LOCAL_BOOTSTRAP_ADDR`,
`IDENTITY_LOCAL_BOOTSTRAP_KEY`, `IDENTITY_LOCAL_BOOTSTRAP_USER_TYPE`,
`IDENTITY_LOCAL_BOOTSTRAP_COGNITO_DOMAIN`, más `DATABASE_URL` y la configuración
JWT/JWKS existentes. Esta guía no fija rutas de módulo ni comandos de ejecución
del backend.

## Rutas del frontend

| Ruta | Método | Efecto |
| --- | --- | --- |
| `/empresa/bootstrap-local` | GET | Página temporal, no enlazada en la navegación. No hace nada solo. |
| `/api/auth/local-bootstrap/nonce` | GET | Solo lectura: valida la sesión y emite el nonce anti-CSRF ligado a ella. Sin llamadas a Go ni escrituras. |
| `/api/auth/local-bootstrap/stage` | POST | Envía el token privado **actual** y la clave a la herramienta local. No escribe. |
| `/api/auth/local-bootstrap/apply` | POST | Envía solo el código de operación, con la sesión privada **actual**. Es la única acción que puede crear. |

`GET` nunca muta. El cuerpo de `/stage` debe ser exactamente `{}` y el de
`/apply` únicamente `{"operation_code":"…"}`; cualquier campo extra (por ejemplo
PII) o un cuerpo que no sea ese JSON exacto se rechaza sin llamar a Go. El nonce
anti-CSRF está ligado a la sesión y al origen exacto de `NEXTAUTH_URL`, y tras un
`stage` exitoso se emite una cookie HttpOnly adicional que liga esa operación
concreta a la sesión, al nonce y al código durante un TTL máximo de 60 segundos.
`/apply` exige ese vínculo vigente antes de llamar a Go; el frontend no lo consume,
así que tras un `409 approval_required` una persona puede volver a Aplicar la
misma operación sin preparar otra.

## Resultado incierto: no reintentar automáticamente

Si `/apply` no puede confirmar el resultado (por ejemplo, una falla de red o un
`500 bootstrap_failed`), la página **no** afirma que la escritura falló ni que se
completó: marca la operación como incierta, deshabilita Preparar y Aplicar, y pide
verificar el estado antes de reintentar. Go sigue siendo la autoridad sobre la
aprobación de la terminal, el único intento de creación y la protección contra
replay concurrente; la cookie de vínculo del frontend no es una aprobación.

## Qué NO hace

- No crea ni modifica `companies`, membresías, grupos ni esquema.
- No provisiona nada en login, `GET`, `backend-check` ni guardado de borradores.
- No reintenta de forma automática tras un resultado ambiguo de `apply`; ante
  incertidumbre hay que verificar el estado y decidir manualmente.
- No expone tokens, correo, nombre, sujeto ni perfil al navegador, a la sesión
  pública, a logs, a URLs ni a mensajes de error.
- No despliega nada en AWS ni cambia configuración de Cognito.

## Antes de ejecutarlo contra una base real

- [ ] Existe una aprobación humana **posterior e independiente** para ejecutar
      contra la base real (fuera de esta guía).
- [ ] La terminal local privada mostrará el correo verificado: es el único canal
      autorizado. No copies correos, tokens ni capturas al chat.
- [ ] Confirmaste el alcance: solo `users`, sin membresías.
- [ ] Entendés que la herramienta es temporal y que su retiro está registrado en
      `docs/temporary-decisions.md`.
