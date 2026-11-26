# Notifications system (idea to discuss — not started)

Captured from the user on 2026-11-26 while deciding the careers-site «Dejar mi CV» owner email; not a tracked feature yet.

## Log

- **L1** (2026-11-26) User, verbatim: «Esto hay que posponerlo.. porque estoy pensando en otra cosa, estoy pensando en un
  sistema de notificaciones completo, porque ahora viendolo bien, creo que hace falta eso, notificaciones reales robustas
  en el sistema, configurables par que lleguen por correo (hay que hablar esto tambien porque no toooodas las
  notificaciones InApp deben poder ser configuradas para llegar por correo, o al menos eso creo), yo creo que debe haber
  notificaciones InApp, algunas automaticas, algunas configurables para que lleguen por correo, algunas que se puedan
  desactivar, elegir a quien le llegue por usuario, por rol, me sigues?? quiero algo realmente usable y profesional, pero
  esto anotalo para tenerlo en mente y poder hablarlo despues.»

Topics to discuss later: catalogue of events (which are in-app only, which can also go by email, which can be turned off,
which are mandatory), recipients per user and per role, user preferences vs company defaults, digests vs immediate, the
first consumer («Dejar mi CV» from the careers site, slice C), delivery infrastructure (email provider, retries, unsubscribe).
- **L2** (2026-11-26) Agent's starting point: no notification system exists (backend nothing; Configuración shows it as
  «Próximamente»), no email provider. Model proposed: event → recipient rule (by relation to the object, by role, by
  person) → channel (in-app always; email only for events that allow it, immediate or digest) → preferences (company
  rules by the owner, personal within them); three kinds: mandatory (can't be turned off, always email), operational
  (can be turned off, email configurable), informative (in-app only). User answers: «Empresa y candidatos
  (recomendado)»; «Dueño define, persona ajusta (recomendado)»; vacancy events default to «Equipo de la vacante
  (recomendado)»; delivery «Por etapas (recomendado)» — 1) bell + inbox + 5–6 key events, 2) email + preferences,
  3) owner rules, digests and more events.
