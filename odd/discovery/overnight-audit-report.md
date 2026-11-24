# Informe de la auditoría nocturna — 24 nov 2026

Auditoría de diseño y funcionalidad como comprador empresarial, en el navegador (build de producción `pnpm start` en
:3000 contra el backend de dev :8080), con las cuentas de propietario, reclutador y stakeholder de Grupo Altavista.
Detalle por área: `overnight-audit-A.md` (vacantes y equipo), `overnight-audit-B.md` (pipeline y candidatos),
`overnight-audit-C.md` (lado público y candidato), `overnight-audit-D.md` (administración). Registro completo:
`odd/tasks/overnight-product-audit.md`.

## Preguntas de comprador

| Pregunta | Respuesta hoy |
| --- | --- |
| ¿Cómo creo una vacante con encargado? | «Nueva vacante» → editor de 5 pasos → «Guardar borrador» → «Publicar vacante». Quien la crea queda como responsable; no se elige otro al crear. |
| ¿Cómo cambio al responsable? | Desde «Configuración → Equipo» de la vacante (solo el dueño). **En producción esa página está apagada**; la rama `feat/vacancy-team-production` la enciende (decisión tuya, abajo). |
| ¿Puedo compartir la vacante por WhatsApp o correo? | **Sí, desde esta noche**: «Compartir» con Copiar enlace, WhatsApp, Correo y LinkedIn (más el menú del teléfono) en el detalle público, el sitio de empleo, la fila de la vacante y el menú de la lista. El enlace lleva `?origen=compartido`. |
| ¿Se ve bien al pegar el enlace? ¿Sale en Google Jobs? | Desde esta noche, sí: tarjeta OpenGraph/Twitter y datos JobPosting. |
| ¿Puedo editar una vacante publicada? | Desde esta noche: «Editar publicación» en la fila de la vacante y en el menú de la lista; el editor dice «Editar vacante». |
| ¿Pausar, cerrar, reabrir, reemplazar? | Sí, desde «Acciones», con confirmación y avisos claros; el reemplazo funciona completo (privado o público, retomados). |
| ¿Duplicar una vacante o usar plantillas? | No existe (pendiente, requiere backend). |
| ¿Cómo agrego un candidato a mano? ¿Lo muevo? ¿Lo descarto? | «Agregar candidato» con CV; se mueve por menú, ficha o arrastrando (también con teclado); descartar pide motivo; recuperar lo devuelve. |
| ¿Puedo buscar candidatos en el tablero? | Desde esta noche, por nombre (no por correo: el tablero no lo trae). |
| ¿Acciones masivas, notas, menciones, avisos al equipo o al candidato? | No existen (decisión de producto + backend). |
| ¿Documentos por vacante y por candidato? | Sí: pestaña Documentos con versiones, vínculos al original, y desde esta noche un bloque «Documentos (n)» en la ficha. |
| ¿Puedo invitar a un reclutador? | No: solo stakeholders (decisión tuya, abajo). |
| ¿Puedo cambiar nombre, industria o logo de la empresa? | No, y el sitio de empleo exige logo para publicar (decisión tuya, abajo). |
| ¿Qué ve un stakeholder? | Métricas y su lista «Vacantes» con Documentos de solo lectura; lo demás, «Sección no disponible». |
| ¿Hay auditoría de cambios? | Sí, para el dueño, con filtros y CSV. |
| ¿2FA, cambio de contraseña, avisos por correo? | No funcionan: desde esta noche se muestran como «Próximamente» en vez de interruptores falsos. |
| ¿Aviso de privacidad, términos, borrar cuenta, descargar datos? | No existen (legal y backend, abajo). |

## Lo que quedó en `main` (local, sin push)

`1dbb4350` (controles nuevos + lado público), `de0f914b` (resto de la auditoría) y el merge final de accesibilidad.
Backend: `102be62c` (error 500 al cambiar columnas), `cfaf90c7` (orden y total del listado), `44c15189` (carga del
equipo, conteos exactos del stakeholder, nota en invitaciones; migración 00065 aplicada en dev).

- **Controles:** listas con palomita y campo de archivo con tarjeta en toda la app; regla en `design/system.md`.
- **Público:** menú de compartir, OpenGraph y JobPosting, «Ingresa para postularte» + «Crear cuenta», contraste de
  enlaces en oscuro, chips Presencial/Híbrido/Remoto, títulos, «Ver vacantes de <empresa>» en vacantes cerradas, orden
  por salario y «N vacantes».
- **Vacantes:** editar/compartir/ver página pública desde la vacante y la lista; base bruto/neto obligatoria para mostrar
  el salario; editor honesto después de publicar; «Cubierta» bloqueada si falta cobertura; pestañas del editor que
  anuncian su estado; detalles en celular.
- **Pipeline:** búsqueda; descarte honesto para candidatos sin cuenta; CV validado al elegirlo; «Configurar
  subestados…»; documentos en la ficha; textos de psicometría; nombre completo en «No se sostuvo»; comparación en
  celular; «Guardar nota» en el checklist.
- **Administración:** «Próximamente» en ajustes sin efecto; equipo en celular, cuarto número de stakeholders, «Dueño»
  único; carga real por miembro; pestañas exactas del stakeholder; nota en invitaciones; visibilidad de talento con aviso
  de cambios sin guardar; exportar auditoría pide fechas; editor del sitio coherente; una sola pantalla de «sin acceso».
- **Accesibilidad:** foco visible con teclado; errores graves de axe corregidos; contraste ≥ 4.5:1 en badges, pestañas
  y campos con error. Último axe: 0 errores en las pantallas revisadas.

Verificación: suites completas en cada merge (la última, 641 archivos / 11 699 tests), tsc y lint sin errores, dos
revisiones independientes aprobadas (`review-4157357d02f219f6`, `review-9c2864f028aca702`) y chequeos en el navegador
sobre el build de producción.

## Decisiones tuyas

1. **Página de equipo en producción** (`feat/vacancy-team-production`, `bdcc5340`, suite completa verde): enciende
   «Equipo» en cada vacante (responsable, colaboradores, equipo compartido, historial), «Mi historial» y la baja de
   miembros. Sin esto, nadie puede cambiar al responsable en producción. Lista para mergear si decís que sí.
2. **Invitar reclutadores** (hoy solo stakeholders): quién invita, cuánto dura el enlace.
3. **Editar empresa y logo**: el backend propone solo PNG/JPG/WebP (no SVG).
4. **CSV de auditoría en español**: cambia un archivo que ya se descarga.
5. **«No aplica» al agregar columnas**: el backend marca las etapas anteriores que un candidato nunca pasó.
6. **Orden por salario**: primero pesos mensuales brutos; los netos y otras monedas van después.
7. **Cuenta candidata de prueba**: no hay ninguna; crearla necesita un código de tu Gmail. Sin ella no se auditó lo que
   hace un candidato con sesión.
8. **Privacidad y legal**: aviso de privacidad, términos, cookies, borrar cuenta y descargar datos (ley de protección de
   datos).
9. **Ajustes «Próximamente»**: 2FA, cambiar contraseña, avisos por correo, «Mantener sesión iniciada».
10. **Producto**: duplicar vacantes, acciones masivas, notas y menciones, agregar desde la Base de talento a otra
    vacante, avisos al equipo, que «Copiar enlace» de psicometría no rote el enlace.
11. **Cognito** (AWS, en pausa): la página de inicio de sesión está en inglés y ofrece «Create an account».

## Pendientes chicos

- Panel de etapas de psicometría en celular se corta 17 px si se abre abajo; «Ir al contenido» es la 5.ª parada en
  desktop; `/candidatos` repite «| PeopleFlow» en el título.
- El aviso de éxito al guardar columnas tapa el mensaje de abajo; el encabezado del tablero corta nombres largos de
  columna; el diálogo de impacto dice «Ningún candidato cambia de columna» y lista filas con «→».
- Título «No encontramos este borrador» cuando falta acceso (la descripción ya lo aclara); quien inicia un reemplazo
  aparece dos veces (falta un id de quien mira en el backend); sin vista previa del CV en la ficha.
- Observaciones no bloqueantes de las revisiones (región viva del guardado, etiquetas de psicometría en un solo lugar,
  etc.), listadas en el registro.

## Datos de prueba creados en Grupo Altavista

Vacantes «Auditoría A …» y «Auditoría B …» (con candidatos «Auditoría A/B …»), documentos «T3e/T5 …», la columna
«Auditoría B Validación», invitaciones de stakeholder revocadas, y la cuenta stakeholder de prueba.
