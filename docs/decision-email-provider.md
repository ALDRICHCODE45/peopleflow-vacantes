# Decisión: proveedor de correo transaccional

Estado: **decidido, no implementado** (2026-10-24). En el radar; se implementa cuando se programe la unidad de
invitaciones por correo u otra que necesite enviar correo.

## Decisión

| Tema | Decisión |
| --- | --- |
| Proveedor | **Amazon SES** (región de Cognito, `us-east-1`). |
| Forma de envío | **Por cola**: la API publica el evento (p. ej. «miembro invitado») → EventBridge → SQS → worker Go en Fargate envía por SES. Reintentos y fallos sin bloquear la petición del usuario. |
| Infraestructura | **Terraform** en `infra/` (SES, identidad de dominio, EventBridge, SQS, worker, IAM). |
| Dominio | **Pendiente**: todavía no hay dominio registrado. Sin dominio no se puede verificar SES ni salir del sandbox. |

Encaja con la arquitectura objetivo (`docs/architecture/peopleflow-aws-target.html`): API en ECS/Fargate,
EventBridge, SQS y workers Go.

## Por qué SES

- Misma cuenta y facturación de AWS, acceso por IAM (sin claves de terceros en la app).
- Costo bajo (~0.10 USD por 1,000 correos).
- Sirve también para Cognito: el correo por defecto de Cognito tiene un límite diario bajo; en producción Cognito
  debe enviar por SES con el mismo dominio.

## Pasos previos al primer envío real

1. Registrar el dominio y decidir quién maneja el DNS (Route 53 recomendado por estar en AWS).
2. Verificar el dominio en SES con DKIM, SPF y DMARC; definir remitente (p. ej. `no-reply@<dominio>`).
3. Pedir a AWS la salida del sandbox de SES (acceso de producción).
4. Atender rebotes y quejas (eventos de SES por SNS/EventBridge) y no reenviar a direcciones inválidas.
5. Configurar Cognito para enviar por SES.

## Desarrollo local

Sin correos reales: el backend envía a través de una interfaz (`sesv2` en producción) que en local apunta a un
simulador (LocalStack SES o Mailpit para ver los correos en el navegador).

## Usuarios de esta decisión

- Invitar miembros por correo (unidad grande diferida en `odd/tasks/frontend-backlog.md`).
- Correos de Cognito (verificación y recuperación) en producción.
