/**
 * Written definition of every metric (S5), the user-facing reading of contract §2 (catalog v1). Each entry is the
 * popover's title, one or two sentences, and a muted footer with the source and the time window.
 */
export type Definition = { title: string; description: string; footer: string };

export const DEFINITIONS = {
  assigned: {
    title: "Vacantes asignadas",
    description: "Vacantes publicadas al menos una vez con un tramo de asignación que se cruza con el periodo. Por reclutador, una vacante cuenta una vez aunque haya salido y vuelto; se separa por la función que tuvo (responsable, colaborador o miembro), así que la suma por función puede ser mayor que el total.",
    footer: "Fuente: tramos de asignación · Ventana: el tramo se cruza con el periodo",
  },
  closed: {
    title: "Vacantes cerradas por motivo",
    description: "Vacantes con un cierre registrado en el periodo, según su motivo: cubierta, cancelada u otro motivo. Los cierres de antes de que existiera el motivo aparecen como «Sin motivo». Terminar el proceso no es un cierre.",
    footer: "Fuente: historial de la vacante · Ventana: fecha del cierre",
  },
  time_to_close: {
    title: "Tiempo mediano a cierre",
    description: "Mediana de días hábiles entre la primera publicación y el cierre como cubierta, en las vacantes cubiertas en el periodo. Si una vacante se reabrió, se cuenta desde su primera publicación. Sin cierres no hay mediana.",
    footer: "Días hábiles: lunes a viernes, sin festivos · Hora del centro de México",
  },
  closing_target: {
    title: "Cierre en tiempo",
    description: "Vacantes cubiertas que cerraron en o antes de su fecha objetivo de cierre vigente, o después de ella. Las vacantes sin fecha objetivo se cuentan aparte como «sin objetivo de cierre».",
    footer: "La fecha objetivo de cierre es opcional en la configuración de la vacante",
  },
  delivery: {
    title: "Entregas de candidatos",
    description: "Se juzga con el día en que el candidato que completó la meta llegó a la etapa de corte, nunca con el momento en que se guardó la configuración. A tiempo: ese día es igual o anterior a la fecha compromiso vigente. Tarde: después. Vencida: sin cumplir y la fecha ya pasó. Pendiente: sin cumplir y la fecha aún no llega. Sin configurar: la vacante no tiene entrega configurada.",
    footer: "Ventana: las vacantes con entrega entran por su fecha compromiso; las demás, por su asignación en el periodo",
  },
  on_time_rate: {
    title: "Entregas a tiempo",
    description: "Entregas a tiempo entre las entregas ya juzgadas: a tiempo, tarde y vencidas. Las pendientes todavía no se juzgan y no cuentan.",
    footer: "Siempre se muestra con «N de M»",
  },
  configured_rate: {
    title: "Vacantes con entrega configurada",
    description: "Vacantes con entrega configurada (a tiempo, tarde, vencidas y pendientes) entre todas las vacantes del periodo, incluidas las que no tienen entrega configurada.",
    footer: "Siempre se muestra con «N de M»",
  },
  time_to_target: {
    title: "Mediana a la meta de entrega",
    description: "Mediana de días hábiles entre la primera publicación y el día en que el candidato que completó la meta llegó a la etapa de corte. Sin entregas cumplidas no hay mediana.",
    footer: "Días hábiles: lunes a viernes, sin festivos",
  },
  delivered: {
    title: "Candidatos entregados",
    description: "Candidatos que llegaron a la etapa de corte o a una posterior, por ingreso, movimiento o recuperación. El conteo nunca baja.",
    footer: "Fuente: registro de entrega de cada proceso",
  },
  delivered_in_tramo: {
    title: "Entregados en su tramo",
    description: "Candidatos que la persona movió a la etapa de corte mientras estaba asignada. Las postulaciones que llegan directo a la etapa de corte cuentan para la vacante, no para un reclutador.",
    footer: "Fuente: movimientos del pipeline durante el tramo",
  },
  placements: {
    title: "Placements",
    description: "Contrataciones con fecha en el periodo, activas o que no se sostuvieron; las anuladas no cuentan. Por reclutador se separan en crédito directo, participación y compartido; esos tres ya incluyen los que no se sostuvieron, que se muestran aparte sin sumarse de nuevo.",
    footer: "Ventana: fecha de contratación · El crédito va a quien tenía tramo al contratar",
  },
  coverage: {
    title: "Cobertura de posiciones",
    description: "Posiciones cubiertas con placements activos entre las posiciones a contratar, en las vacantes cerradas en el periodo. Deja ver coberturas parciales.",
    footer: "Fuente: créditos de placement y posiciones de la vacante",
  },
  conversion: {
    title: "Conversión a placement",
    description: "Vacantes con al menos un placement acreditado a la persona entre las vacantes que tuvo asignadas y que cerraron en el periodo. Si ninguna cerró, no hay porcentaje.",
    footer: "Siempre se muestra con «N de M»",
  },
  origin: {
    title: "Origen de las postulaciones",
    description: "Postulaciones creadas en el periodo según el canal: portal de vacantes, sitio de empleo de la empresa o registro manual. Las anteriores a este registro no distinguen el portal del sitio y aparecen como «Portal o sitio, sin distinguir».",
    footer: "El canal lo informa la página desde la que se postuló la persona",
  },
  closed_by_month: {
    title: "Vacantes cerradas por mes",
    description: "Vacantes distintas con al menos un cierre en cada mes, por motivo. Una vacante cerrada dos veces en el mismo mes cuenta una vez; si se cerró en dos meses, cuenta en cada uno. Los meses sin cierres aparecen en cero.",
    footer: "Mes calendario en hora del centro de México",
  },
  reassignments: {
    title: "Reasignaciones",
    description: "Cambios de responsable registrados en el periodo, por motivo. Sumar o quitar colaboradores no es una reasignación. Por reclutador: recibidas (pasó a ser responsable) y perdidas (dejó de serlo), incluidas las bajas de la empresa.",
    footer: "Ventana: fecha de la reasignación",
  },
  by_requester: {
    title: "Por cliente o área",
    description: "Cliente o área interna actual de cada vacante. Si una vacante cambió de solicitante, cuenta completa en el actual. «Sin especificar»: se eligió el tipo sin elegir cuál. «Sin solicitante»: la vacante no tiene uno.",
    footer: "El solicitante no guarda historial: es una aproximación",
  },
  business_days: {
    title: "Días hábiles en tramos",
    description: "Días hábiles que la persona estuvo asignada a vacantes dentro del periodo.",
    footer: "Fuente: tramos de asignación",
  },
} satisfies Record<string, Definition>;
export type DefinitionKey = keyof typeof DEFINITIONS;

/** «Qué mide cada columna»: the recruiter table's columns in their order, each with its definition. */
export const COLUMN_DEFINITIONS: { column: string; key: DefinitionKey }[] = [
  { column: "Asignadas", key: "assigned" },
  { column: "Entregas", key: "delivery" },
  { column: "Mediana a la meta", key: "time_to_target" },
  { column: "Entregados", key: "delivered_in_tramo" },
  { column: "Placements", key: "placements" },
  { column: "Conversión", key: "conversion" },
  { column: "Reasignaciones", key: "reassignments" },
  { column: "Días en tramos", key: "business_days" },
];
