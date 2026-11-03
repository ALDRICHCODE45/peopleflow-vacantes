# Salida de miembros

La página Equipo conserva su diseño y sus acciones actuales.

| Entorno / `NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE` | «Quitar» |
| --- | --- |
| Desarrollo / `1` | Preview y salida en memoria; agrega los tres reclutadores de prueba. |
| Desarrollo / `api` | Preview real; sin miembros de prueba. |
| Producción, sin bandera u otro valor | Confirmación simple y DELETE existentes; sin preview. |

Para revisar fixtures, abre `/empresa/equipo?offboard=responsible`, `none` o
`collaborator` con una sesión de dueño. Para revisar la API de la rama, configura
`PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:8081` y la bandera `api`.

## Flujo real

Los endpoints usan **el ID de membresía**, no el ID de usuario, bajo
`/me/company/members/{membershipId}` (sin `/v2`). Las acciones del servidor obtienen
la sesión; el navegador no conoce el token.

- GET `offboard-preview`: sin vacantes pendientes, confirma y usa DELETE; muestra
  los otros equipos que dejará cuando el conteo no sea cero.
- Con vacantes pendientes: la misma confirmación permite elegir una persona para
  todas o cambiarla por vacante. `hand_over` distingue «Es responsable» de
  «Es la única persona del equipo»; el servidor decide la función del destino.
- POST `offboard`: envía `default_to_user_id?` y `reassignments?`. Una confirmación
  conserva cuerpo y UUID Idempotency-Key ante resultados inciertos. Una respuesta
  definitiva permite corregir el intento. Cerrar y volver a abrir inicia otro.
- Un DELETE que devuelve `member_is_responsible` cambia la misma confirmación al
  diálogo de salida con las vacantes devueltas. Un 422 conserva las selecciones;
  `offboard_unresolved_vacancies` marca cada fila pendiente.
- Al confirmar la salida, se vuelve a leer la lista. El resultado informa
  «{nombre} salió de la empresa.» y solo si hubo traspasos agrega
  «Pasaron {n} vacantes a otras personas.» (singular: «Pasó 1 vacante…»).

El contrato autoritativo está en `docs/contracts/vacancy-team-v1.md` del backend.
La revisión en navegador corresponde al orquestador.
