# Autorrevisión · design/embedded-auth (A2 · S1 S3 S4)

Fecha: 2026-11-27. Tres artboards HTML autocontenidos (CSS, JS y SVG en línea; sin URLs externas ni fuentes remotas),
generados desde `_src/` (`node design/embedded-auth/_src/build.mjs`). Interactivos, en claro y oscuro, empresa y candidato,
cada estado con un marco de escritorio de 1440 × 900 (escalado para caber) y uno de teléfono de 390 × 844.

**Skills:** la política de seguridad bloqueó la lectura de `gentle-pi/skills/design/SKILL.md` y
`gentle-pi/skills/gentle-ui-design/SKILL.md`. No intenté rodearla. Seguí `design/system.md` y las convenciones de
`design/notifications/` y `design/notification-emails/` (`design.json` + artboards HTML numerados + `self-check.md`, `_src/` con build).

## Las tres direcciones

| | 01 · Panel dividido | 02 · Tarjeta centrada | 03 · Recorrido guiado |
|---|---|---|---|
| Escritorio | Panel FloatingLines a la izquierda, formulario de 400 px a la derecha (como hoy) | Tarjeta de 456 px sobre el fondo con brillo y puntos del acento | Formulario a la izquierda, panel claro «Tu recorrido» de 560 px a la derecha |
| Otra audiencia | Enlace «¿Eres candidato? Ingresa aquí» (como hoy) | Selector Empresa · Candidato (navegación) dentro de la tarjeta | Enlace (como hoy) |
| Proveedores | Debajo del formulario, a todo el ancho | **Primero**, después «o con tu correo» | Debajo, en una fila compacta (solo el nombre) |
| Pasos (registro, contraseña) | Texto en el eyebrow: «Registro de empresa · Paso 1 de 3» | Barra «Paso 1 de 3 · Sigue: Verifica tu correo» | Lista de pasos con Hecho / Ahora / Después; en el teléfono «Paso 2 de 3» con barra y los pasos plegados |
| Teléfono | Sin panel; logotipo + alternar tema | La tarjeta se vuelve la pantalla | Progreso plegable arriba del título |

Flujo de empresa en las tres: **Tu cuenta → Verifica tu correo → Tu empresa**. «Tu empresa» va después del código porque crear
la empresa necesita sesión (POST /companies con user_type recruiter, L4). No hay paso de verificación de empresa; solo el aviso
«Podrás publicar vacantes cuando verifiquemos tu empresa.»

## Qué se ejecutó de verdad

Chromium headless con Playwright y `@axe-core/playwright` de `frontend/node_modules` (`_src/check.mjs`, solo lectura).

| Comprobación | Alcance | Resultado final |
|---|---|---|
| Errores de JS | 3 artboards × 25 estados × audiencias aplicables × claro y oscuro = **300 corridas** | 0 |
| axe-core (wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, incluido contraste) | las 300 corridas, página completa con ambos marcos | **0 violaciones** |
| Desborde | elementos fuera de cada marco (1440 y 390), scroll horizontal, recortes por `overflow:hidden` | 0 |
| Objetivos de 44 px en el teléfono | todo `a`, `button`, `input` (excepto la casilla, cuyo objetivo es su `label` de 44 px) y `summary` del marco de 390 | 0 por debajo de 44 px. Al principio: los enlaces «Términos» y «Aviso de privacidad» dentro de la etiqueta de consentimiento medían 18 px; se sacaron a su propia línea («Léelos aquí: …») con objetivos de 44 px y la casilla los cita en `aria-describedby` |
| Flujos con clic y teclado (script de Playwright) | en los tres: pegar «482913» en la 1.ª casilla llena las seis y lleva el foco a «Verificar»; escribir «12» deja el foco en «Dígito 3 de 6» y Retroceso vuelve a «Dígito 2 de 6»; el ojo cambia el tipo a texto y el nombre a «Ocultar contraseña»; «Registra tu empresa» navega y enfoca el título; escribir «Altavista#2026» anuncia «Tu contraseña cumple todos los requisitos.»; enviar el registro lleva al código; «Cambiar correo» enfoca el campo y Escape o «Cancelar» devuelven el foco a «Cambiar correo»; el alternar tema del marco cambia el tema y conserva el foco; «Reenviar código» disponible confirma «Te enviamos un código nuevo.» y reinicia a 1:00; enviar «Pedir código» lleva al paso 2 con el foco en el título | pasan. Al principio Escape en «Cambiar correo» lanzaba un error (el objetivo se quitaba del DOM al volver a pintar); corregido |
| Movimiento reducido | el único movimiento es el spinner de «Ingresando…» / «Verificando…» | `prefers-reduced-motion: reduce` lo detiene (CSS); no medido con script |
| Revisión visual | capturas de 6 estados en claro (empresa) y 4 en oscuro (candidato) por artboard, en `_src/shots/` | ver abajo |

### Corregido tras la revisión visual

- 02: con proveedores primero, el separador decía «o continúa con» debajo de ellos; ahora dice «o con tu correo».
- 02: la tarjeta quedaba arriba con medio marco vacío debajo en pantallas cortas (código); ahora se centra verticalmente en escritorio.
- 03: el aviso «Podrás publicar…» se repetía en el formulario y en el panel; en escritorio queda solo en el panel (en el teléfono, en el formulario).
- 03 teléfono: «Ver pasos» partía en dos renglones con nombres de paso largos; ahora no se parte.

## Autorrevisión de UX

| Criterio | Cómo se cumple |
|---|---|
| Nunca revelar si el correo existe | «Correo o contraseña incorrectos.» para ambos casos, sin decir cuál falla; «Si hay una cuenta con ese correo, te enviamos un código.» al pedir el restablecimiento; el registro con un correo existente sigue igual al código (pregunta 1 para A3). «Cuenta sin verificar» solo aparece con la contraseña correcta |
| Errores ligados a sus campos | `aria-invalid` + `aria-describedby` al mensaje; el aviso general (credenciales, demasiados intentos, código) tiene `role="alert"` y `tabindex="-1"` y los campos o el fieldset lo citan; el foco va al aviso (credenciales), a la contraseña (correo social ya registrado), al primer campo con error (registro, Tu empresa) o a la primera casilla (código) |
| Orden de foco | sigue el orden visual; en Ingresar: correo → «¿Olvidaste tu contraseña?» → contraseña → mostrar → mantener sesión → Ingresar → proveedores → crear cuenta → otra audiencia → inicio (02: el selector y los proveedores van antes del correo, como se ven) |
| Al cambiar de pantalla | el foco va al `h1` (con `tabindex="-1"`) salvo los casos de arriba |
| Código | fieldset «Código de verificación», casillas «Dígito N de 6», la 1.ª con `autocomplete="one-time-code"`, `inputmode="numeric"`; pegar en cualquiera reparte los dígitos; ← → y Retroceso; no se envía solo al completar |
| Reenviar | espera de 60 s con el tiempo en el nombre del botón (`aria-disabled`, sigue enfocable); la cuenta regresiva no se anuncia; la confirmación sí (`role="status"`) |
| Requisitos de contraseña | visibles siempre, cumplidos con palomita y texto oculto «Cumplido: / Pendiente: »; un solo anuncio cuando se cumplen todos; tras enviar, los pendientes pasan a «x» roja |
| Enviando | botón con spinner y texto («Ingresando…», «Verificando…»), `aria-busy` en el formulario, campos de solo lectura y proveedores deshabilitados |
| Proveedores tras flags | cada botón es independiente; con todos apagados no queda separador ni hueco (estado «Sin proveedores»). «Marcar flags» dibuja el contorno y el nombre del flag (`social.google`, `social.microsoft`, `social.linkedin`, `social.linkedin.empresas`) |
| Teléfono | 390 px sin desborde; todos los objetivos ≥ 44 px; campos de 48 px; las seis casillas de 47 × 56 caben con 6 px de separación |
| Estados cubiertos | reposo, contraseña visible, enviando, sin proveedores, requisitos en vivo, errores de validación, Tu empresa (+ error), código recién enviado / verificando / incorrecto / vencido / reenvío disponible / reenviado / cambiar correo, contraseña 1–3 (+ código vencido o incorrecto), credenciales incorrectas, demasiados intentos, cuenta sin verificar, sin conexión, correo social ya registrado, sesión vencida |

## Autorrevisión del sistema (design/system.md)

- **Colores:** tokens del sistema (`--background`, `--foreground`, `--card`, `--muted`, `--muted-foreground`, `--border`, `--destructive`,
  `--status-info|review|success|danger`, `--pf-grid-dot-alpha`) en claro y oscuro con sus valores, más los **acentos locales del login**
  copiados tal cual de `login-screen.module.css` (`--pf-login-accent-link`, `--pf-login-cta-bg`, `--pf-login-cta-fg`, `--pf-login-visual-tint`,
  aquí `--acc-*`). Tintes por `color-mix` de un token. Sombras de tarjeta y telón como en el sistema.
- **Familias:** pila del sistema como respaldo de Inter; monoespaciada solo en el eyebrow (como `LoginScreen`, `font-mono`) y en las
  etiquetas de flag del artboard.
- **Componentes:** campo y botón del login actual, `Badge`-tinte para avisos, casilla de consentimiento (permitida por «Choice controls»),
  control segmentado (02), lista de pasos (03), `Spinner`.

### Desviaciones (para decidir)

1. **Acentos por audiencia** (violeta `#9336EA` empresa, cian `#22D3EE` candidato) en lugar de `--primary`: vienen del login actual, no del
   sistema. El candidato en cian es la mayor diferencia con el resto del producto; decidir si se queda o pasa a violeta.
2. **Campo y botón del login** (48 px, radio 10 px, borde `--border`, relleno `--background`) en lugar de `Input` (`rounded-2xl`, `bg-input/50`
   sin borde) y `Button` (18 px). Se respetó el login actual; si se pasa al sistema cambia la imagen de las tres.
3. **Contraste del borde del campo**: `#E4DFF0` sobre blanco no llega a 3:1 (WCAG 1.4.11). Heredado del login actual; axe no lo mide.
   El relleno `--background` ayuda, pero conviene un borde más fuerte (p. ej. `--control-edge` al 50 %) al implementar.
4. **Marcas de proveedor** con los colores de Google, Microsoft y LinkedIn (sus guías de marca lo piden); el login actual usa letras («G», «M»,
   «in»). En producto, los recursos oficiales de cada proveedor.
5. **FloatingLines** se dibuja como SVG estático con la paleta del shader (`floating-lines-shaders.ts`); el producto usa el shader OGL.
6. **Logotipo** como texto «people*flow*»; el producto usa la imagen. En 01 claro, el logotipo del panel se pinta oscuro: el blanco actual
   (`tone="onDark"`) queda casi invisible sobre `#F7F5FB`; revisar en producto.
7. **Casillas de código** (6 × 52 × 60 px, radio 12): componente nuevo.
8. **Lista de requisitos de contraseña**: componente nuevo (palomita `--status-success`, círculo, «x» `--status-danger`).
9. **Aviso de formulario** (tinte del tono al 9 %, borde al 40 %, icono del tono): receta del `Badge` semántico a tamaño de bloque; el sistema
   no tiene `Alert`.
10. **Texto de error** en `--status-danger` (no `--destructive`) para asegurar AA a 13 px; el borde del campo sí usa `--destructive`.
11. **Lista de pasos** (03, círculos de 36 px, conector de 2 px, insignias Hecho / Ahora / Después) y **barra segmentada** (02 y 03 teléfono):
    componentes nuevos.
12. **Selector Empresa · Candidato** (02): la piel del control segmentado, pero como `nav` con enlaces, a 44 px en el teléfono.

## Copia inventada (no está en el login actual, en la tarea ni en L1–L5)

Se conservó del login actual: los eyebrows, títulos y subtítulos de Ingresar, «Contraseña», «¿Olvidaste tu contraseña?», «Mantener sesión
iniciada», «Ingresar», «o continúa con», «Continuar con Google / Microsoft / LinkedIn», «¿No tienes cuenta? Registra tu empresa»,
«¿No tienes perfil? Crea tu perfil», «¿Eres candidato? / ¿Eres empresa? Ingresa aquí», «Volver al inicio», los placeholders
«tu@empresa.com» y «••••••••», y «Tu sesión venció. Vuelve a ingresar.» (EmployerAuthControls). De la tarea / L5: «Correo o contraseña
incorrectos.», «Ese correo ya tiene cuenta. Entra con tu contraseña.», «Tu empresa», «Verifica tu correo», «¿Olvidaste tu contraseña?»,
«Reenviar código», «podrás publicar cuando verifiquemos tu empresa».

Inventada:

- **Etiquetas cambiadas:** «Correo corporativo» y «Correo» (hoy «Email corporativo» y «Email», para coincidir con «Correo o contraseña
  incorrectos.»); placeholder «tu@correo.com» (hoy «tu@email.com»).
- **Crear cuenta:** títulos «Registra tu empresa» y «Crea tu perfil» (hoy son acciones); «Primero tu cuenta; después, los datos de tu empresa.»;
  «Postúlate en minutos y sigue cada proceso.»; «Nombre completo»; «De preferencia el de tu empresa; te ayudará cuando la verifiquemos.»;
  «Acepto los Términos y el Aviso de privacidad.»; «Léelos aquí: Términos · Aviso de privacidad»; «o regístrate con»; «Continuar»;
  «Crear perfil»; «¿Ya tienes cuenta? / ¿Ya tienes perfil? Ingresa»; «¿Buscas empleo? Crea tu perfil de candidato»; «¿Contratas para tu
  empresa? Registra tu empresa».
- **Requisitos y validación:** «8 caracteres o más», «Una mayúscula», «Una minúscula», «Un número», «Un símbolo (#, $, !…)», «Tu contraseña
  necesita:» (oculto), «Cumplido: / Pendiente: » (oculto), «Tu contraseña cumple todos los requisitos.», «Escribe tu nombre.», «Escribe un correo
  válido, como nombre@correo.com.», «Tu contraseña aún no cumple todos los requisitos.», «Acepta los Términos y el Aviso de privacidad para
  continuar.»
- **Tu empresa:** «Así te verán los candidatos. Podrás cambiarlo en Configuración.», «Nombre comercial», «El nombre que verán los candidatos.»,
  «Razón social (opcional)», «Como aparece en tu constancia fiscal. Puedes agregarla después.», «Sitio web (opcional)», «Podrás publicar vacantes
  cuando verifiquemos tu empresa. Mientras, ya puedes preparar tus vacantes.», «Crear empresa», «Ingresaste como … · Salir», «Escribe el nombre
  de tu empresa.», «Escribe un sitio válido, como grupoaltavista.mx.»
- **Código:** «Escribe el código de 6 dígitos que enviamos a …», «Cambiar correo», «Código de verificación», «Dígito N de 6», «Revisa también tu
  carpeta de spam. El código vence en 24 horas.», «Verificar», «Verificando…», «¿No te llegó?», «Reenviar código en 0:42», «El código no es
  correcto. Revísalo e inténtalo de nuevo.», «Este código ya venció. Pide uno nuevo; te llega en unos segundos.», «Enviar código nuevo», «Te enviamos
  un código nuevo. El anterior ya no sirve.», «Cambia tu correo», «Correo nuevo», «Te enviaremos un código nuevo; el anterior dejará de servir.»,
  «Enviar código», «Cancelar», «Tu cuenta aún no está verificada. Te enviamos un código nuevo para terminar.», «Volver a ingresar».
- **Contraseña:** «Restablece tu contraseña», «Escribe el correo de tu cuenta y te enviaremos un código.», «Crea una contraseña nueva», «Para … ·
  Usar otro correo», «Si hay una cuenta con ese correo, te enviamos un código. Vence en 1 hora.», «Nueva contraseña», «Cambiar contraseña», «El código
  no es correcto o ya venció. Pide uno nuevo con «Reenviar código».», «Cambiaste tu contraseña», «Ya puedes ingresar con tu nueva contraseña.»
- **Estados:** «Ingresando…», «Demasiados intentos. Espera unos minutos antes de volver a intentarlo o restablece tu contraseña.», «Restablecer
  contraseña», «No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo. Lo que escribiste sigue aquí.», «Intentaste entrar con Google
  como …», «Mostrar contraseña / Ocultar contraseña», «Cambiar a tema oscuro / claro».
- **02:** «Empresa · Candidato» (selector), «Tipo de cuenta» (nombre del selector), «o con tu correo», «Paso N de 3 · … / Sigue: …».
- **03:** «Tu recorrido», «Registra tu empresa en 3 pasos», «Crea tu perfil en 3 pasos», «Recupera tu acceso», «Termina de activar tu cuenta»,
  los nombres y descripciones de cada paso («Tu cuenta · Nombre, correo y contraseña.», «Un código de 6 dígitos.», «Nombre comercial y sitio web.»,
  «Tu perfil», «Listo · Explora vacantes y postúlate.», «Tu correo · Te enviamos un código.», «Código y nueva contraseña · El código vence en 1 hora.»,
  «Ingresa con tu nueva contraseña.», «Ingresa · Correo y contraseña.», «Entra · Te llevamos a tu cuenta.»), «Hecho / Ahora / Después»,
  «¿Primera vez en PeopleFlow?», «Publica vacantes y sigue tu pipeline con tu equipo.», «Postúlate con tu perfil y sigue el estado de cada proceso.»,
  «Ver pasos».

## Preguntas abiertas para A3 (técnicas)

1. **Registro con correo ya existente:** `SignUp` de Cognito responde `UsernameExistsException`, lo que revelaría la cuenta. Las pantallas
   asumen que se muestra igual el código y que al dueño le llega un correo «ya tienes cuenta» (necesita backend o Lambda).
2. **Cambiar correo de una cuenta sin confirmar:** ¿se borra y se vuelve a registrar, o se actualiza el atributo? Define si «Cambiar correo» existe.
3. **Política de contraseñas:** la lista usa la de Cognito por defecto (8, mayúscula, minúscula, número, símbolo).
4. **Vigencias y límites:** código de registro 24 h y de restablecimiento 1 h (Cognito); espera de reenvío de 60 s (nuestra); «Demasiados
   intentos» sin minutos exactos.
5. **«Mantener sesión iniciada»:** existe hoy sin efecto; decidir si cambia la duración de la sesión o se quita.
6. **Empresa por Google / Microsoft / LinkedIn:** tras el proveedor va a «Tu empresa»; el rol sale del endpoint de onboarding (L4), nunca del cliente.
7. **LinkedIn para empresas:** dibujado tras su propio flag (`social.linkedin.empresas`); se puede omitir sin tocar el diseño.

## Archivos

- `01-panel-dividido.html`, `02-tarjeta-centrada.html`, `03-recorrido-guiado.html`: artboards generados.
- `_src/style.css`, `_src/ui.js`, `_src/build.mjs`: fuentes; `_src/check.mjs`: revisión con Playwright y axe.
- `_src/shots/`: capturas de la revisión visual (≈12 MB, 30 PNG). Son de trabajo; se pueden borrar o ignorar antes de hacer commit.
