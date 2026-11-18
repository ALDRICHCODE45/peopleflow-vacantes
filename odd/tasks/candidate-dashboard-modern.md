# Candidate dashboard: modern redesign and candidate mobile review

The candidate workspace (`/candidato/*`) needs a modern dashboard and a mobile review before the partners' demo.
The current dashboard comes from `design/candidate-dashboard-v2/02-tres-preguntas.html`. This document tracks
the audit, the research, the proposal artboards and, after the user chooses one, the implementation.

## Specs

- **S1** The dashboard charts are redesigned. User: «la primera grafica deja mucho que desear, se ve mal».
  User: «realmente no me gusta el diseno de las graficas, creo que no son modernas, creo que les falta ese
  "algo" que no se que es».
- **S2** The donut must draw without stutter. User: «carga muy lento y por "tramos" es decir, en la animacion
  inicial de la grafica se va cerrando el circulo y se para, avanza un poco y se para, avanza mas y se para y
  asi hasta que termina la animacion, eso no puede pasar».
- **S3** The whole dashboard is redesigned. User: «el dashboar en general mmmmmm la verdad es que es "pasableee"
  pero no es como me encantaria vender un dashboard a un candidato, hay cards que no me encantan como la de
  "estado de tus postulaciones"». The «Pendientes» banner too. User: «ese anuncio al principio de pendientes que
  se ve mal, no lo se.. lo siento como algo antiguo».
- **S4** The candidate screens are checked at mobile width in a real browser. Nothing may overflow the view.
  User: «quiero que pruebes todo en el navegador y lo mires por ti mismo, porque en mobile hay algunas cosas que
  se salen de la vista y parecen mal puestas, como en las postulaciones del candidato, por favor, revisa todo».
- **S5** Research and proposal come first; implementation follows only after the user approves a proposal. User:
  «investiga patrones para dashboards modernos, metodos, etc.. haz la propuestas y despues implementamos».

## Tasks

| ID | Specs | Task | Commit |
| --- | --- | --- | --- |
| T1 | S2, S4 | Browser audit of `/candidato/*` with Valeria's demo data at 1440 and 390 px, plus the cause of the donut stutter (verify, background) | — |
| T2 | S1, S3, S5 | Research modern candidate and personal dashboards and chart patterns; write `design/candidate-dashboard-modern/research.md` (explore, background) | — |
| T3 | S1–S5 | 2–3 proposal artboards in `design/candidate-dashboard-modern/`, desktop and 390 px, opened on the canvas | — |
| T4 | S1–S4 | Implement the artboard the user chooses (after approval) | — |
| T5 | S4 | Fix the mobile overflows the audit finds on the other candidate screens (after approval) | — |

## Log

- **L1** User request, verbatim (2026-11-18): «Bien hermano, me acaban de decir que la reunion se pospuso para
  manana, pero eso me sirve para ver todos los datos de las pantallas y poder hacer correcciones si es necesario, y
  creo que hace falta una revision del frontend en algunos aspectos, primero esto: [Image#1] el dashboar de el
  candidato no se ve del todo bien, creo que la primera grafica deja mucho que desear, se ve mal, la segunda grafica
  tiene un problema que yo pense que era de mi computadora, pero no, carga muy lento y por "tramos" es decir, en la
  animacion inicial de la grafica se va cerrando el circulo y se para, avanza  un poco y se para, avanza mas y se
  para y asi hasta que termina la animacion, eso no puede pasar, ademas que realmente no me gusta el diseno de las
  graficas, creo que no son modernas, creo que les falta ese "algo" que no se que es, pero que no me gusta a mi que
  lo estoy viendo, y sinceramente, el dashboar en general mmmmmm la verdad es que es "pasableee" pero no es como me
  encantaria vender un dashboard a un candidato, hay cards que no me encantan como la de "estado de tus
  postulaciones" ademas de las graficas que ya te comente, ese anuncio al principio de pendientes que se ve mal, no
  lo se.. lo siento como algo antiguo, me gustaria mejorarlo por favor y quiero que pruebes todo en el navegador y lo
  mires por ti mismo, porque en mobile hay algunas cosas que se salen de la vista y parecen mal puestas, como en las
  postulaciones del candidato, por favor, revisa todo, investiga patrones para dashboards modernos, metodos, etc..
  haz la propuestas y despues implementamos. gracias.» Image#1 shows the three chart cards «¿Estoy siendo
  constante?», «¿Está funcionando?» and «¿Cuánto tardan en responder?».
- **L2** Context: branch `feat/candidate-dashboard-redesign` from `main` `4771d3fe`. The demo runs on a production
  build on :3000 with Grupo Altavista data. Valeria Mendoza (nocheblanca92+demo-candidato) has 4 applications,
  3 saved vacancies and 1 unread message; all are dated today. `design/system.md` is older than
  `frontend/src/app/globals.css` (token drift from the metrics redesign).
