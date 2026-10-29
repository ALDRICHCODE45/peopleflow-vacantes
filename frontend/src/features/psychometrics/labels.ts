import type { ComparedCompetency, Competency, GuideQuestion, Invitation, Quality } from "./model";
export const bandLabels = { "band.low": "Bajo", "band.medium": "Medio", "band.high": "Alto" } as const;
export const importanceLabels = { "importance.clave": "Clave", "importance.importante": "Importante", "importance.no_relevante": "No relevante" } as const;
export const fitLabels = { "fit.alineado": "Alineado", "fit.explorar": "Por explorar", "fit.atencion": "Foco de atención" } as const;
export const tierLabels = { "tier.sin": "Sin señales", "tier.algunas": "Algunas señales", "tier.relevantes": "Señales relevantes" } as const;
export const statusLabels: Record<Invitation["status"], string> = { created: "Enviado", in_progress: "En curso", finished: "Finalizado", expired: "Vencido", revoked: "Revocado" };
export const competencyLabels: Record<Competency["competency_id"], string> = {
  "comp.organizacion": "Orden para avanzar", "comp.compromisos": "Cuidado de acuerdos", "comp.coordinacion": "Impulso para coordinar", "comp.colaboracion": "Apoyo entre pares", "comp.exploracion": "Apertura a probar", "comp.deliberacion": "Pausa para decidir", "comp.presion": "Manejo de la presión",
};
export const facetLabels = {
  "facet.c2": "Preferencia por el orden", "facet.c5": "Seguimiento de planes", "facet.c3": "Cumplimiento de compromisos", "facet.c4": "Esfuerzo por lograr objetivos", "facet.e3": "Iniciativa para dirigir", "facet.e1": "Acercamiento a otras personas", "facet.a3": "Disposición a ayudar", "facet.a4": "Trato sin confrontación", "facet.o4": "Preferencia por la variedad", "facet.o5": "Interés por ideas abstractas", "facet.c6": "Reflexión antes de actuar", "facet.e5": "Búsqueda de experiencias intensas", "facet.n1": "Anticipación de dificultades", "facet.n2": "Reacción ante contratiempos", "facet.n6": "Respuesta ante la presión",
} as const;
export const tierMessages: Record<Quality["tier"], string> = {
  "tier.sin": "No se detectaron patrones que requieran seguimiento con la información disponible. Esto no confirma por sí solo la calidad de las respuestas.",
  "tier.algunas": "Hay un patrón que conviene aclarar. Pregunta cómo fue la experiencia al responder y confirma ejemplos de trabajo antes de sacar conclusiones.",
  "tier.relevantes": "Hay patrones que requieren más contexto. Confirma cómo se respondió y contrasta lo declarado con ejemplos de trabajo; no los uses como motivo de descarte.",
};
export const focusMessages = {
  "focus.adjacent": "Lo declarado está a una banda de lo que requiere la vacante. Pide un ejemplo para precisar cómo se adapta a esa tarea.",
  "focus.distant": "Lo declarado está a dos bandas de lo que requiere la vacante. Contrasta un ejemplo de esa tarea y los apoyos que usa para realizarla.",
  "focus.quality": "Conviene aclarar cómo fue la experiencia al responder y confirmar lo declarado con ejemplos de trabajo.",
} as const;
export function signalReason(signal: Quality["signals"][number]): string | null {
  if (signal.severity !== "mild" && signal.severity !== "strong") return null;
  if (!signal.counts) return null;
  switch (signal.id) {
    case "signal.attention": return `No coincidieron ${signal.counts.misses} de 3 instrucciones de respuesta. Pregunta si las instrucciones fueron claras.`;
    case "signal.long_string": return `Se repitió la misma opción en ${signal.counts.run} frases seguidas. Confirma con ejemplos si las frases describen situaciones distintas.`;
    case "signal.fast": return `Se registraron menos de 2 segundos en ${signal.counts.fast_count} de 60 frases. El tiempo registrado puede ser incompleto o modificable; pregunta cómo se respondió.`;
    case "signal.changes": return `Se registraron ${signal.counts.value_changes} cambios de opción, ${signal.counts.clears} borrados y ${signal.counts.reanswers} respuestas después de borrar: ${signal.counts.total} interacciones. Cambiar una respuesta puede ser una reconsideración; pregunta qué motivó los ajustes.`;
  }
}
export function questionReason(q: GuideQuestion) {
  return `${importanceLabels[q.importance]} · banda ${bandLabels[q.observed_band]} · ${q.selector === "quality" ? "seguimiento de cómo se respondió" : q.fit ? fitLabels[q.fit] : "explorar con ejemplos de trabajo"}${q.desired_band ? ` · deseado: ${bandLabels[q.desired_band]}` : ""}`;
}
export function comparisonLabel(version: string | null) { return version === null ? "Perfil sin confirmar" : `Perfil versión ${version}`; }
/** fit is null for two causes (contract): the comparison has no confirmed profile, or the competency is no relevante. */
export function fitLabel(c: ComparedCompetency, confirmed: boolean) {
  if (c.fit) return fitLabels[c.fit];
  return confirmed ? "No se compara" : "sin perfil confirmado";
}
