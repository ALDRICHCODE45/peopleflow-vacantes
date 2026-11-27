# UI fixes after the stage-2 preview, email design system, and the onboarding/auth conversation

Raised by the user after reviewing the production preview (2026-11-27). Branch `feat/notifications-stage2`. Items 1–4 are
fixes; item 5 is a product conversation before AWS/deployment work.

## Specs

- **S1** Emails, verbatim (L1): «el diseno de los correos.. maaal, muy muy mal, se ven pesimos, hay que tener un system
  design en los correos, algo en condiciones, ten en cuenta que lo van a usar empresas, clientes reales, hay que tenerlo
  pulido, presentable, que sea de PeopleFlow, me sigues?? algo bien hecho.» → design directions for the email system
  (layout, brand, typography, button, footer, mandatory vs optional, grouped vs single) on the canvas; the user picks;
  the backend applies it to the 17 templates and 2 footers. Copy stays as agreed (notifications-stage2-email-copy.md).
- **S2** Vacancy header actions, verbatim (L1): «esos 3 botones de acciones "editar publicacion" "compartir" "ver pagina
  publica" estan en medio hermano, para mi se ve mal, no cuadran ahi, no deben ir ahi ... me gusta resolverlas
  simplemente poniendo un dropdown con 3 puntos y ya, igualmente tienes reglas especificas para los dropdowmmenus en tu
  system design» → one ⋯ dropdown following design/system.md dropdown rules.
- **S3** Kanban column menu, verbatim (L1): «cuando presiono los "3 puntos" de cualquier columna del kanban me salen esas
  dos opciones con un texto y aqui creo que hay muchos errores: creo que la explicacion es inecesaria y no me gustaa que
  las opciones esten en dos lineas "mover a la izquierda" y "mover a la derecha" no me gusta nadaaa que sea asi» → no
  explanation text; each option on one line.
- **S4** Login redirect, verbatim (L1): «cuando ingreso a mi cuenta, ingreso mis datos correctamente, no me manda al
  sistema me deja en el mismo lugar, pero ahora en lugar de un boton de "Ingresar con cognito" aparece "Ir a mi panel"
  ... deberia de redirigir a mi panel automaticamente» → after a successful login the user lands on their panel.
- **S5** Onboarding and auth conversation, verbatim (L1): «como se da de alta una empresa, como entra un candidato, el
  proceso para acreditar la existencia de una empresa y que dicha empresa puede publicar vacantes, etc.. ese tipo de
  cosas hay que tenerlas antes de pasar con aws y tambien que no quiero el login actual, porque el login actual te
  redirige a otra pagina de cognito para loguearte, para crear tu cuenta, y eso no es lo que queremos, queremos que todo
  sea dentro del sistema con la misma ux/ui etc.. quiero que todos esos procesos se realizen dentro del sistema, no fuera
  en una pantalla de aws cognito, y tambien ligin con google, con linkedin, con github, y con microsoft.. hay que
  hablarlo, no estoy cerrado a nada.» → read-only proposal and decisions first; no implementation yet.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| U1 | S1 | Email design directions on the canvas (`design/notification-emails/`), then backend applies the chosen one | |
| U2 | S2 | Vacancy header actions into one ⋯ dropdown | b9ff00b3 |
| U3 | S3 | Kanban column menu: no explanation, one-line options | a4aa3c61 |
| U4 | S4 | Diagnose and fix the post-login redirect | 7f0ce75b |
| U5 | S5 | Onboarding / company verification / embedded auth / social login proposal (discussion) | |

## Log

- **L1** (2026-11-27) User, verbatim: «Bien, hay algunas cositas que arreglar, te las paso una por una. 1. en primera, el
  diseno de los correos.. maaal, muy muy mal, se ven pesimos, hay que tener un system design en los correos, algo en
  condiciones, ten en cuenta que lo van a usar empresas, clientes reales, hay que tenerlo pulido, presentable, que sea
  de PeopleFlow, me sigues?? algo bien hecho. luego: 2. Hay algo aqui que no me gusta nadaaa y es esos 3 botones de
  acciones "editar publicacion" "compartir" "ver pagina publica" estan en medio hermano, para mi se ve mal, no cuadran
  ahi, no deben ir ahi, esetas cosas (me parece que esta en tu system design, pero no estoy seguro) me gusta resolverlas
  simplemente poniendo un dropdown con 3 puntos y ya, igualmente tienes reglas especificas para los dropdowmmenus en tu
  system design, 3. cuando presiono los "3 puntos" de cualquier columna del kanban me salen esas dos opciones con un
  texto y aqui creo que hay muchos errores: creo que la explicacion es inecesaria y no me gustaa que las opciones esten
  en dos lineas "mover a la izquierda" y "mover a la derecha" no me gusta nadaaa que sea asi (creo que esto tambien
  estaba en tu system design). y 4: cuando ingreso a mi cuenta, ingreso mis datos correctamente, no me manda al sistema
  me deja en el mismo lugar, pero ahora en lugar de un boton de "Ingresar con cognito" aparece "Ir a mi panel" y esto me
  gusta, deberia de redirigir a mi panel automaticamente (creo que eso se hace en aws cognito, lo puedo hacer yo desde
  la consola), y de lo ultimo que queria hablar de literalmente lo ultimo antes de pasar a ya comenzar con el diseno del
  despligue, estrategias del ambiente de pruebas, rollbacks, dominios, ci/cd, etc.. porque todo el tema del despliegue
  en el ambiente de pruebas debemos tenerlo bien seteado, en condiciones profesionales reales, y el tema del que queria
  hablar es de como se da de alta una empresa, como entra un candidato, el proceso para acreditar la existencia de una
  empresa y que dicha empresa puede publicar vacantes, etc.. ese tipo de cosas hay que tenerlas antes de pasar con aws y
  tambien que no quiero el login actual, porque el login actual te redirige a otra pagina de cognito para loguearte,
  para crear tu cuenta, y eso no es lo que queremos, queremos que todo sea dentro del sistema con la misma ux/ui etc..
  quiero que todos esos procesos se realizen dentro del sistema, no fuera en una pantalla de aws cognito, y tambien
  ligin con google, con linkedin, con github, y con microsoft.. hay que hablarlo, no estoy cerrado a nada.»
  Screenshots: emails in Mailpit (deadline overdue/due soon, delivery due soon/overdue); vacancy «Configuración ›
  Entrega» header with «Editar publicación · Compartir · Ver página pública» centred; kanban column menu with
  «Reordena columnas y revisa el impacto antes de guardar» and «Mover a la izquierda / derecha» wrapping; /empresa/login
  showing «Sesión iniciada.» + «Ir a mi panel».
- **L2** (2026-11-27) U4 cause (our code, not Cognito): EmployerAuthControls defaulted the sign-in callbackUrl to
  /empresa/login and nothing moved a signed-in user on. Fixed in 7f0ce75b: the fallback is /empresa/dashboard (its guard
  routes owner/recruiter, stakeholder → /empresa/metricas, candidate/no-company → RoleBlocked) and /empresa/login is
  never accepted as a return target; explicit /empresa/... callbacks (guard returns, invitations) still win. U5
  decisions (user): «Cognito con pantallas propias (recomendado)»; social login: Google, Microsoft, LinkedIn (GitHub
  later); company sign-up «Cualquiera, autoservicio (recomendado)»; company verification: «No estoy seguro hermano..
  dejame platicarlo con mis socios por favor, dejame tus propuestas y yo se las paso» — pending partners.
  Pre-existing bug noted: vacancy-checklist/compare/ui.tsx:57 links /empresa/login?next=…, which the login ignores.
